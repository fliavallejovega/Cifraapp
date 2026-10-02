'use server';

import {
  accounts,
  fxRates,
  goals,
  tripBookings,
  tripChecklistItems,
  tripLegs,
  tripOverrides,
  tripReserveReleases,
  tripScenarios,
  trips,
  tripTravelers,
} from '@app/database/schema';
import { Money, toPlainDate, todayIn, type CurrencyCode, type PlainDate } from '@app/domain';
import {
  COST_INDEX_BY_LEVEL,
  convertToBase,
  divide,
  fromMinor,
  toScaled,
  DAILY_CATEGORIES,
  DEFAULT_TRAVELER_WEIGHT,
  TRIP_CATEGORIES,
  validateShares,
} from '@app/trip-engine';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { currencyOf } from './household-context';
import { optionalText, plainDateString, positiveAmount, recordName } from './record-input';
import { tripsEnabled } from './repositories/trips';
import { revalidateTrip } from './revalidate';
import { loadSession, queryAsUser, type Session } from './session';
import { bookingInput, upsertTripBooking, type TripBookingInput } from './trip-booking-core';
import {
  recordTripMovement,
  recordTripTransfer,
  removeTripMovement,
  syncGoalCredit,
  type Tx,
} from './trip-ledger';
import { goalDeadline } from './trip-plan';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Viajes: every write the module makes.
 *
 * Each action checks the session, the flag and its input, then does its whole
 * job in one database transaction under the person's own RLS context. The
 * budget is not written anywhere: the next read computes it from what these
 * actions stored, which is the recalculation the specification asks for.
 *
 * Actions return error keys, never prose; the screen picks the sentence in the
 * person's language.
 */

type Locale = 'en' | 'es';
type ActionResult = RecordActionResult;

const LODGING_MODES = ['undecided', 'prepaid', 'pay_on_site', 'none'] as const;
const COST_LEVELS = ['low', 'medium', 'high', 'very_high'] as const;
const PROFILES = ['economy', 'balanced', 'comfort', 'custom'] as const;
const TRAVELER_TYPES = ['adult', 'child', 'infant'] as const;
const STATUSES = [
  'idea',
  'planning',
  'saving',
  'booked',
  'in_progress',
  'completed',
  'cancelled',
] as const;

const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/);
const weight = z.string().regex(/^\d(\.\d{1,3})?$/);
const rate = z.string().regex(/^\d{1,9}(\.\d{1,10})?$/);
const timezone = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/);

const legInput = z.object({
  id: z.uuid().optional(),
  city: recordName,
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullish(),
  placeLabel: z.string().trim().max(120).nullish(),
  arrivalDate: plainDateString,
  departureDate: plainDateString,
  localCurrency: currencyCode,
  costLevel: z.enum(COST_LEVELS),
  costIndex: z
    .string()
    .regex(/^\d(\.\d{1,2})?$/)
    .nullish(),
  timezone: timezone.default('America/Panama'),
  lodgingMode: z.enum(LODGING_MODES),
});

const travelerInput = z.object({
  id: z.uuid().optional(),
  personId: z.uuid().nullish(),
  displayName: recordName,
  travelerType: z.enum(TRAVELER_TYPES),
  weight: weight.nullish(),
});

const settingsInput = z.object({
  name: recordName,
  startDate: plainDateString,
  endDate: plainDateString,
  totalBudget: positiveAmount,
  alreadySaved: positiveAmount.default('0'),
  contingencyType: z.enum(['percent', 'fixed']),
  contingencyValue: positiveAmount,
  profile: z.enum(PROFILES),
  customShares: z.record(z.string(), z.number().int()).nullish(),
  includeArrivalDay: z.boolean(),
  includeDepartureDay: z.boolean(),
  partialDayWeight: z.string().regex(/^(0(\.\d{1,3})?|1(\.0{1,3})?)$/),
  rollingPolicy: z.enum(['rolling', 'fixed']).default('rolling'),
  coverEmoji: z.string().max(16).nullish(),
  notes: optionalText,
  fundingAccountId: z.uuid().nullish(),
});

const createInput = settingsInput.extend({
  legs: z.array(legInput).min(1).max(12),
  travelers: z.array(travelerInput).max(20),
  createGoal: z.boolean().default(false),
  status: z.enum(STATUSES).optional(),
});

export type CreateTripInput = z.input<typeof createInput>;
export type TripSettingsInput = z.input<typeof settingsInput>;
export type TripLegInput = z.input<typeof legInput>;
export type TripTravelerInput = z.input<typeof travelerInput>;

interface Context {
  readonly session: Session;
  readonly householdId: string;
  readonly currency: CurrencyCode;
}

/** The session, the household and the flag, or the error key that stops the action. */
async function context(): Promise<Context | { error: string }> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };
  if (!(await tripsEnabled(session, session.activeHouseholdId))) return { error: 'moduleOff' };
  return {
    session,
    householdId: session.activeHouseholdId,
    currency: currencyOf(session, session.activeHouseholdId) as CurrencyCode,
  };
}

const isError = (value: Context | { error: string }): value is { error: string } =>
  'error' in value;

function datesOk(start: string, end: string): boolean {
  return start <= end;
}

function legsInside(
  legs: readonly { arrivalDate: string; departureDate: string }[],
  start: string,
  end: string,
): boolean {
  return legs.every(
    (leg) =>
      leg.arrivalDate <= leg.departureDate && leg.arrivalDate >= start && leg.departureDate <= end,
  );
}

/** The latest reference rates for some currencies, as planning rates. */
async function planningRatesFor(tx: Tx, base: string, codes: readonly string[]) {
  const wanted = [...new Set(codes)].filter((code) => code !== base);
  if (wanted.length === 0) return {};
  const rows = await tx
    .selectDistinctOn([fxRates.quote], {
      quote: fxRates.quote,
      rate: fxRates.rate,
      date: fxRates.rateDate,
    })
    .from(fxRates)
    .where(and(eq(fxRates.base, base), inArray(fxRates.quote, wanted)))
    .orderBy(fxRates.quote, desc(fxRates.rateDate));
  return Object.fromEntries(
    rows.map((row) => [row.quote.trim(), { rate: row.rate, date: row.date }]),
  );
}

function legValues(leg: z.infer<typeof legInput>, position: number) {
  return {
    position,
    city: leg.city,
    countryCode: leg.countryCode ?? null,
    placeLabel: leg.placeLabel ?? null,
    arrivalDate: leg.arrivalDate,
    departureDate: leg.departureDate,
    localCurrency: leg.localCurrency,
    costLevel: leg.costLevel,
    costIndex: leg.costIndex ?? COST_INDEX_BY_LEVEL[leg.costLevel],
    timezone: leg.timezone,
    lodgingMode: leg.lodgingMode,
  };
}

function travelerValues(traveler: z.infer<typeof travelerInput>) {
  return {
    personId: traveler.personId ?? null,
    displayName: traveler.displayName,
    travelerType: traveler.travelerType,
    weight: traveler.weight ?? DEFAULT_TRAVELER_WEIGHT[traveler.travelerType],
  };
}

function settingsValues(input: z.infer<typeof settingsInput>) {
  return {
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    totalBudget: input.totalBudget,
    alreadySaved: input.alreadySaved,
    contingencyType: input.contingencyType,
    contingencyValue: input.contingencyValue,
    profile: input.profile,
    customShares:
      input.profile === 'custom' && input.customShares && validateShares(input.customShares)
        ? input.customShares
        : null,
    includeArrivalDay: input.includeArrivalDay,
    includeDepartureDay: input.includeDepartureDay,
    partialDayWeight: input.partialDayWeight,
    rollingPolicy: input.rollingPolicy,
    coverEmoji: input.coverEmoji ?? null,
    notes: input.notes ?? null,
    fundingAccountId: input.fundingAccountId ?? null,
  };
}

/** The status a new trip starts in, from its dates and whether it saves. */
function initialStatus(
  start: string,
  end: string,
  today: PlainDate,
  saving: boolean,
): (typeof STATUSES)[number] {
  if (today >= start && today <= end) return 'in_progress';
  if (today > end) return 'completed';
  return saving ? 'saving' : 'planning';
}

/**
 * Creates a trip with its legs and travellers in one transaction, fixes the
 * planning exchange rates, and — when asked — creates its savings goal.
 */
export async function createTrip(
  raw: CreateTripInput,
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const parsed = createInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  if (!datesOk(input.startDate, input.endDate)) return { error: 'datesInvalid' };
  if (!legsInside(input.legs, input.startDate, input.endDate)) return { error: 'legsOutsideTrip' };

  const timeZone =
    ctx.session.households.find((h) => h.id === ctx.householdId)?.timeZone ?? 'America/Panama';
  const today = todayIn(timeZone);

  try {
    const id = await queryAsUser(ctx.session, async (tx) => {
      const planningFx = await planningRatesFor(
        tx,
        ctx.currency,
        input.legs.map((leg) => leg.localCurrency),
      );
      let goalId: string | null = null;
      if (input.createGoal && input.startDate > today) {
        const target = Money.fromDecimalString(input.totalBudget, ctx.currency);
        if (target.isPositive()) {
          const [goal] = await tx
            .insert(goals)
            .values({
              householdId: ctx.householdId,
              createdBy: ctx.session.user.id,
              name: input.name,
              targetAmount: input.totalBudget,
              currentAmount: input.alreadySaved,
              currency: ctx.currency,
              targetDate: goalDeadline(toPlainDate(input.startDate)),
              priority: 200,
              status: 'active',
              isCommitted: true,
            })
            .returning({ id: goals.id });
          goalId = goal?.id ?? null;
        }
      }

      const [trip] = await tx
        .insert(trips)
        .values({
          householdId: ctx.householdId,
          createdBy: ctx.session.user.id,
          baseCurrency: ctx.currency,
          status:
            input.status ?? initialStatus(input.startDate, input.endDate, today, goalId !== null),
          planningFx,
          goalId,
          ...settingsValues(input),
        })
        .returning({ id: trips.id });
      if (!trip) throw new Error('insert failed');

      await tx.insert(tripLegs).values(
        input.legs.map((leg, i) => ({
          householdId: ctx.householdId,
          tripId: trip.id,
          ...legValues(leg, i),
        })),
      );
      if (input.travelers.length > 0) {
        await tx.insert(tripTravelers).values(
          input.travelers.map((t) => ({
            householdId: ctx.householdId,
            tripId: trip.id,
            ...travelerValues(t),
          })),
        );
      }
      return trip.id;
    });
    revalidateTrip(locale, id);
    return { created: id };
  } catch (error) {
    return { error: constraintKey(error) };
  }
}

/** Updates a trip's money and dates. Legs and travellers have their own actions. */
export async function updateTripSettings(
  tripId: string,
  raw: TripSettingsInput,
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const parsed = settingsInput.safeParse(raw);
  if (!parsed.success || !z.uuid().safeParse(tripId).success) return { error: 'invalid' };
  if (!datesOk(parsed.data.startDate, parsed.data.endDate)) return { error: 'datesInvalid' };
  try {
    const updated = await queryAsUser(ctx.session, async (tx) => {
      const [row] = await tx
        .update(trips)
        .set({ ...settingsValues(parsed.data), updatedAt: new Date() })
        .where(and(eq(trips.id, tripId), eq(trips.householdId, ctx.householdId)))
        .returning({ id: trips.id, goalId: trips.goalId });
      return row ?? null;
    });
    if (!updated) return { error: 'notFound' };
    revalidateTrip(locale, tripId);
    return { ok: true };
  } catch (error) {
    return { error: constraintKey(error) };
  }
}

export async function setTripStatus(
  tripId: string,
  status: (typeof STATUSES)[number],
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  if (!(STATUSES as readonly string[]).includes(status)) return { error: 'invalid' };
  const rows = await queryAsUser(ctx.session, (tx) =>
    tx
      .update(trips)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(trips.id, tripId), eq(trips.householdId, ctx.householdId)))
      .returning({ id: trips.id }),
  );
  if (rows.length === 0) return { error: 'notFound' };
  revalidateTrip(locale, tripId);
  return { ok: true };
}

/** Archives a trip. Its movements stay, as household history. */
export async function archiveTrip(tripId: string, locale: Locale = 'es'): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const rows = await queryAsUser(ctx.session, (tx) =>
    tx
      .update(trips)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(trips.id, tripId), eq(trips.householdId, ctx.householdId)))
      .returning({ id: trips.id }),
  );
  if (rows.length === 0) return { error: 'notFound' };
  revalidateTrip(locale, tripId);
  return { ok: true };
}

export async function saveTripLeg(
  tripId: string,
  raw: TripLegInput,
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const parsed = legInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  try {
    const id = await queryAsUser(ctx.session, async (tx) => {
      const [trip] = await tx
        .select({ id: trips.id, base: trips.baseCurrency, fx: trips.planningFx })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.householdId, ctx.householdId)))
        .limit(1);
      if (!trip) return null;
      const position = parsed.data.id
        ? undefined
        : (await tx.select({ id: tripLegs.id }).from(tripLegs).where(eq(tripLegs.tripId, tripId)))
            .length;
      const values = legValues(parsed.data, position ?? 0);
      // A new local currency gets its planning rate fixed now.
      const code = parsed.data.localCurrency;
      if (code !== trip.base.trim() && !trip.fx[code]) {
        const fresh = await planningRatesFor(tx, trip.base.trim(), [code]);
        if (fresh[code]) {
          await tx
            .update(trips)
            .set({ planningFx: { ...trip.fx, ...fresh } })
            .where(eq(trips.id, tripId));
        }
      }
      if (parsed.data.id) {
        const { position: _ignored, ...rest } = values;
        const [row] = await tx
          .update(tripLegs)
          .set({ ...rest, updatedAt: new Date() })
          .where(and(eq(tripLegs.id, parsed.data.id), eq(tripLegs.tripId, tripId)))
          .returning({ id: tripLegs.id });
        return row?.id ?? null;
      }
      const [row] = await tx
        .insert(tripLegs)
        .values({ householdId: ctx.householdId, tripId, ...values })
        .returning({ id: tripLegs.id });
      return row?.id ?? null;
    });
    if (!id) return { error: 'notFound' };
    revalidateTrip(locale, tripId);
    return parsed.data.id ? { ok: true } : { created: id };
  } catch (error) {
    return { error: constraintKey(error) };
  }
}

export async function deleteTripLeg(
  tripId: string,
  legId: string,
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const rows = await queryAsUser(ctx.session, async (tx) => {
    const remaining = await tx
      .select({ id: tripLegs.id })
      .from(tripLegs)
      .where(eq(tripLegs.tripId, tripId));
    // A trip keeps at least one place: without it there is nowhere to spend.
    if (remaining.length <= 1) return 'last';
    return tx
      .delete(tripLegs)
      .where(
        and(
          eq(tripLegs.id, legId),
          eq(tripLegs.tripId, tripId),
          eq(tripLegs.householdId, ctx.householdId),
        ),
      )
      .returning({ id: tripLegs.id });
  });
  if (rows === 'last') return { error: 'lastLeg' };
  if (rows.length === 0) return { error: 'notFound' };
  revalidateTrip(locale, tripId);
  return { ok: true };
}

export async function saveTripTraveler(
  tripId: string,
  raw: TripTravelerInput,
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const parsed = travelerInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  try {
    const id = await queryAsUser(ctx.session, async (tx) => {
      if (parsed.data.id) {
        const [row] = await tx
          .update(tripTravelers)
          .set({ ...travelerValues(parsed.data), updatedAt: new Date() })
          .where(and(eq(tripTravelers.id, parsed.data.id), eq(tripTravelers.tripId, tripId)))
          .returning({ id: tripTravelers.id });
        return row?.id ?? null;
      }
      const [row] = await tx
        .insert(tripTravelers)
        .values({ householdId: ctx.householdId, tripId, ...travelerValues(parsed.data) })
        .returning({ id: tripTravelers.id });
      return row?.id ?? null;
    });
    if (!id) return { error: 'notFound' };
    revalidateTrip(locale, tripId);
    return parsed.data.id ? { ok: true } : { created: id };
  } catch (error) {
    return { error: constraintKey(error) };
  }
}

export async function deleteTripTraveler(
  tripId: string,
  travelerId: string,
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const rows = await queryAsUser(ctx.session, (tx) =>
    tx
      .delete(tripTravelers)
      .where(
        and(
          eq(tripTravelers.id, travelerId),
          eq(tripTravelers.tripId, tripId),
          eq(tripTravelers.householdId, ctx.householdId),
        ),
      )
      .returning({ id: tripTravelers.id }),
  );
  if (rows.length === 0) return { error: 'notFound' };
  revalidateTrip(locale, tripId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

/**
 * Saves a booking. When it is paid and an account is given, the payment
 * becomes a real movement (or links to one already recorded), and the trip's
 * goal is credited with what was paid — all in one transaction.
 */
export async function saveTripBooking(
  tripId: string,
  raw: TripBookingInput,
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const parsed = bookingInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  if (
    Money.fromDecimalString(input.paidAmount, 'USD').greaterThan(
      Money.fromDecimalString(input.amount, 'USD'),
    )
  ) {
    return { error: 'paidExceedsAmount' };
  }

  try {
    const result = await queryAsUser(ctx.session, (tx) =>
      upsertTripBooking(
        tx,
        { householdId: ctx.householdId, userId: ctx.session.user.id, currency: ctx.currency },
        tripId,
        input,
      ),
    );
    if ('error' in result) return { error: result.error ?? 'invalid' };
    revalidateTrip(locale, tripId);
    return result.created ? { created: result.id } : { ok: true };
  } catch (error) {
    return { error: constraintKey(error) };
  }
}

/**
 * Removes a booking. Its goal credit is taken back; its payment movement is
 * removed too unless `keepMovement` — a refund that did not happen should not
 * erase money that did leave the account.
 */
export async function deleteTripBooking(
  tripId: string,
  bookingId: string,
  options: { keepMovement?: boolean } = {},
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const done = await queryAsUser(ctx.session, async (tx) => {
    const [row] = await tx
      .update(tripBookings)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(tripBookings.id, bookingId),
          eq(tripBookings.tripId, tripId),
          eq(tripBookings.householdId, ctx.householdId),
          isNull(tripBookings.deletedAt),
        ),
      )
      .returning({ id: tripBookings.id, transactionId: tripBookings.transactionId });
    if (!row) return false;
    await syncGoalCredit(tx, {
      householdId: ctx.householdId,
      goalId: null,
      bookingId,
      paidBase: '0',
      userId: ctx.session.user.id,
    });
    if (row.transactionId && !options.keepMovement)
      await removeTripMovement(tx, ctx.householdId, row.transactionId);
    await tx.delete(tripChecklistItems).where(eq(tripChecklistItems.bookingId, bookingId));
    return true;
  });
  if (!done) return { error: 'notFound' };
  revalidateTrip(locale, tripId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

const expenseInput = z.object({
  tripId: z.uuid(),
  /** Generated on the device: the same expense sent twice is filed once. */
  clientRef: z.uuid(),
  accountId: z.uuid(),
  /** In the currency it was paid in. */
  amount: positiveAmount,
  currency: currencyCode,
  fxRate: rate.nullish(),
  fxSource: z.enum(['ecb', 'manual', 'card_statement']).default('manual'),
  category: z.enum(TRIP_CATEGORIES),
  tripDay: plainDateString,
  legId: z.uuid().nullish(),
  description: z.string().trim().max(200).nullish(),
  paidByTravelerId: z.uuid().nullish(),
  notes: optionalText,
});

export type TripExpenseInput = z.input<typeof expenseInput>;

/**
 * Records a trip expense: a real household movement in the base currency,
 * with the amount as paid at the destination and the rate kept beside it.
 */
export async function recordTripExpense(
  raw: TripExpenseInput,
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const parsed = expenseInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;

  try {
    const result = await queryAsUser(ctx.session, async (tx) => {
      const [trip] = await tx
        .select({
          id: trips.id,
          base: trips.baseCurrency,
          fx: trips.planningFx,
          start: trips.startDate,
          end: trips.endDate,
        })
        .from(trips)
        .where(and(eq(trips.id, input.tripId), eq(trips.householdId, ctx.householdId)))
        .limit(1);
      if (!trip) return { error: 'notFound' };
      const base = trip.base.trim();

      let rateUsed: {
        rate: string;
        date: string;
        source: 'ecb' | 'manual' | 'card_statement';
      } | null = null;
      if (input.currency !== base) {
        if (input.fxRate)
          rateUsed = { rate: input.fxRate, date: input.tripDay, source: input.fxSource };
        else {
          const latest = await planningRatesFor(tx, base, [input.currency]);
          const found = latest[input.currency] ?? trip.fx[input.currency];
          if (found)
            rateUsed = {
              rate: found.rate,
              date: found.date,
              source: latest[input.currency] ? 'ecb' : 'manual',
            };
        }
        if (!rateUsed) return { error: 'rateRequired' };
      }

      const baseAmount = rateUsed
        ? convertToBase(input.amount, rateUsed.rate, { minorUnits: 4 }, { minorUnits: 2 })
        : input.amount;
      if (!Money.fromDecimalString(baseAmount, 'USD').isPositive())
        return { error: 'amountInvalid' };

      // The leg from the day, when the screen did not say.
      let legId = input.legId ?? null;
      if (!legId) {
        const legs = await tx
          .select({
            id: tripLegs.id,
            arrival: tripLegs.arrivalDate,
            departure: tripLegs.departureDate,
          })
          .from(tripLegs)
          .where(eq(tripLegs.tripId, input.tripId));
        legId =
          [...legs]
            .sort((a, b) => (a.arrival < b.arrival ? 1 : -1))
            .find((leg) => leg.arrival <= input.tripDay && input.tripDay <= leg.departure)?.id ??
          null;
      }

      const movement = await recordTripMovement(tx, {
        householdId: ctx.householdId,
        userId: ctx.session.user.id,
        accountId: input.accountId,
        currency: ctx.currency,
        date: toPlainDate(input.tripDay),
        baseAmount,
        description:
          input.description && input.description.trim() !== ''
            ? input.description.trim()
            : input.category,
        tripId: input.tripId,
        legId,
        category: input.category,
        tripDay: toPlainDate(input.tripDay),
        paidByTravelerId: input.paidByTravelerId ?? null,
        original: rateUsed
          ? {
              amount: input.amount,
              currency: input.currency,
              rate: rateUsed.rate,
              rateDate: toPlainDate(rateUsed.date),
              source: rateUsed.source,
            }
          : null,
        clientRef: input.clientRef,
        notes: input.notes ?? null,
      });
      if (!movement) return { error: 'accountNotFound' };
      return { id: movement.id };
    });
    if ('error' in result) return { error: result.error ?? 'invalid' };
    revalidateTrip(locale, input.tripId);
    return { created: result.id };
  } catch (error) {
    return { error: constraintKey(error) };
  }
}

export async function deleteTripExpense(
  tripId: string,
  transactionId: string,
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const done = await queryAsUser(ctx.session, (tx) =>
    removeTripMovement(tx, ctx.householdId, transactionId),
  );
  if (!done) return { error: 'notFound' };
  revalidateTrip(locale, tripId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reserve, overrides, scenarios, goal, checklist
// ---------------------------------------------------------------------------

/** Moves part of the contingency reserve to the days, and records that it did. */
export async function releaseReserve(
  tripId: string,
  raw: { amount: string; tripDay: string; note?: string | null },
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const parsed = z
    .object({ amount: positiveAmount, tripDay: plainDateString, note: optionalText })
    .safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const rows = await queryAsUser(ctx.session, async (tx) => {
    const [trip] = await tx
      .update(trips)
      .set({
        reserveReleased: sql`${trips.reserveReleased} + ${parsed.data.amount}::numeric`,
        updatedAt: new Date(),
      })
      .where(and(eq(trips.id, tripId), eq(trips.householdId, ctx.householdId)))
      .returning({ id: trips.id });
    if (!trip) return [];
    return tx
      .insert(tripReserveReleases)
      .values({
        householdId: ctx.householdId,
        tripId,
        tripDay: parsed.data.tripDay,
        amount: parsed.data.amount,
        note: parsed.data.note ?? null,
        createdBy: ctx.session.user.id,
      })
      .returning({ id: tripReserveReleases.id });
  });
  if (rows.length === 0) return { error: 'notFound' };
  revalidateTrip(locale, tripId);
  return { ok: true };
}

export async function saveTripOverride(
  tripId: string,
  raw: {
    category: string;
    amount: string;
    tripDay?: string | null;
    legId?: string | null;
    scenarioId?: string | null;
  },
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const parsed = z
    .object({
      category: z.enum(DAILY_CATEGORIES),
      amount: positiveAmount,
      tripDay: plainDateString.nullish(),
      legId: z.uuid().nullish(),
      scenarioId: z.uuid().nullish(),
    })
    .safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const p = parsed.data;
  try {
    await queryAsUser(ctx.session, async (tx) => {
      await tx
        .delete(tripOverrides)
        .where(
          and(
            eq(tripOverrides.tripId, tripId),
            eq(tripOverrides.category, p.category),
            p.tripDay ? eq(tripOverrides.tripDay, p.tripDay) : isNull(tripOverrides.tripDay),
            p.legId ? eq(tripOverrides.legId, p.legId) : isNull(tripOverrides.legId),
            p.scenarioId
              ? eq(tripOverrides.scenarioId, p.scenarioId)
              : isNull(tripOverrides.scenarioId),
          ),
        );
      await tx.insert(tripOverrides).values({
        householdId: ctx.householdId,
        tripId,
        category: p.category,
        amount: p.amount,
        tripDay: p.tripDay ?? null,
        legId: p.legId ?? null,
        scenarioId: p.scenarioId ?? null,
        createdBy: ctx.session.user.id,
      });
    });
    revalidateTrip(locale, tripId);
    return { ok: true };
  } catch (error) {
    return { error: constraintKey(error) };
  }
}

export async function clearTripOverride(
  tripId: string,
  overrideId: string,
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  await queryAsUser(ctx.session, (tx) =>
    tx
      .delete(tripOverrides)
      .where(and(eq(tripOverrides.id, overrideId), eq(tripOverrides.tripId, tripId))),
  );
  revalidateTrip(locale, tripId);
  return { ok: true };
}

const scenarioParams = z.object({
  totalBudget: positiveAmount.optional(),
  contingencyType: z.enum(['percent', 'fixed']).optional(),
  contingencyValue: positiveAmount.optional(),
  profile: z.enum(PROFILES).optional(),
  customShares: z.record(z.string(), z.number().int()).optional(),
  fxShiftPercent: z
    .string()
    .regex(/^-?\d{1,2}(\.\d{1,2})?$/)
    .optional(),
});

export async function saveTripScenario(
  tripId: string,
  raw: { id?: string; name: string; params: z.input<typeof scenarioParams> },
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const parsed = z
    .object({ id: z.uuid().optional(), name: recordName.max(80), params: scenarioParams })
    .safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const id = await queryAsUser(ctx.session, async (tx) => {
    if (parsed.data.id) {
      const [row] = await tx
        .update(tripScenarios)
        .set({ name: parsed.data.name, params: parsed.data.params, updatedAt: new Date() })
        .where(and(eq(tripScenarios.id, parsed.data.id), eq(tripScenarios.tripId, tripId)))
        .returning({ id: tripScenarios.id });
      return row?.id ?? null;
    }
    const count = (
      await tx
        .select({ id: tripScenarios.id })
        .from(tripScenarios)
        .where(eq(tripScenarios.tripId, tripId))
    ).length;
    if (count >= 3) return 'limit';
    const [row] = await tx
      .insert(tripScenarios)
      .values({
        householdId: ctx.householdId,
        tripId,
        name: parsed.data.name,
        params: parsed.data.params,
        position: count,
      })
      .returning({ id: tripScenarios.id });
    return row?.id ?? null;
  });
  if (id === 'limit') return { error: 'scenarioLimit' };
  if (!id) return { error: 'notFound' };
  revalidateTrip(locale, tripId);
  return parsed.data.id ? { ok: true } : { created: id };
}

/**
 * Makes a scenario the plan: its parameters are written onto the trip and the
 * scenario stays for comparison. `null` returns to the trip's own figures.
 */
export async function activateTripScenario(
  tripId: string,
  scenarioId: string | null,
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const rows = await queryAsUser(ctx.session, (tx) =>
    tx
      .update(trips)
      .set({ activeScenarioId: scenarioId, updatedAt: new Date() })
      .where(and(eq(trips.id, tripId), eq(trips.householdId, ctx.householdId)))
      .returning({ id: trips.id }),
  );
  if (rows.length === 0) return { error: 'notFound' };
  revalidateTrip(locale, tripId);
  return { ok: true };
}

export async function deleteTripScenario(
  tripId: string,
  scenarioId: string,
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  await queryAsUser(ctx.session, (tx) =>
    tx
      .delete(tripScenarios)
      .where(and(eq(tripScenarios.id, scenarioId), eq(tripScenarios.tripId, tripId))),
  );
  revalidateTrip(locale, tripId);
  return { ok: true };
}

/**
 * Creates the trip's savings goal, or links an existing one. The target is
 * what is still to be saved; the deadline a week before departure. Bookings
 * already paid are credited to it at once.
 */
export async function linkTripGoal(
  tripId: string,
  options: { goalId?: string | null; create?: boolean },
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  try {
    const goalId = await queryAsUser(ctx.session, async (tx) => {
      const [trip] = await tx
        .select()
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.householdId, ctx.householdId)))
        .limit(1);
      if (!trip) return null;
      let id = options.goalId ?? null;
      if (options.create) {
        const [goal] = await tx
          .insert(goals)
          .values({
            householdId: ctx.householdId,
            createdBy: ctx.session.user.id,
            name: trip.name,
            targetAmount: Money.max(
              Money.fromDecimalString(trip.totalBudget, ctx.currency),
              Money.fromDecimalString('0.01', ctx.currency),
            ).toDecimalString(),
            currentAmount: trip.alreadySaved,
            currency: ctx.currency,
            targetDate: goalDeadline(toPlainDate(trip.startDate)),
            priority: 200,
            status: 'active',
            isCommitted: true,
          })
          .returning({ id: goals.id });
        id = goal?.id ?? null;
      }
      await tx
        .update(trips)
        .set({
          goalId: id,
          status: id && trip.status === 'planning' ? 'saving' : trip.status,
          updatedAt: new Date(),
        })
        .where(eq(trips.id, tripId));
      const bookings = await tx
        .select()
        .from(tripBookings)
        .where(and(eq(tripBookings.tripId, tripId), isNull(tripBookings.deletedAt)));
      for (const booking of bookings) {
        const paidBase =
          booking.paymentStatus === 'paid'
            ? booking.amountBase
            : booking.amount === '0' || booking.amount === '0.0000'
              ? '0'
              : convertToBase(
                  booking.paidAmount,
                  booking.fxRate ?? '1',
                  { minorUnits: 4 },
                  { minorUnits: 2 },
                );
        await syncGoalCredit(tx, {
          householdId: ctx.householdId,
          goalId: id,
          bookingId: booking.id,
          paidBase,
          userId: ctx.session.user.id,
        });
      }
      return id ?? 'unlinked';
    });
    if (!goalId) return { error: 'notFound' };
    revalidateTrip(locale, tripId);
    return goalId === 'unlinked' ? { ok: true } : { created: goalId };
  } catch (error) {
    return { error: constraintKey(error) };
  }
}

export async function toggleChecklistItem(
  tripId: string,
  itemId: string,
  done: boolean,
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const rows = await queryAsUser(ctx.session, (tx) =>
    tx
      .update(tripChecklistItems)
      .set({
        doneAt: done ? new Date() : null,
        doneBy: done ? ctx.session.user.id : null,
        updatedAt: new Date(),
      })
      .where(and(eq(tripChecklistItems.id, itemId), eq(tripChecklistItems.tripId, tripId)))
      .returning({ id: tripChecklistItems.id }),
  );
  if (rows.length === 0) return { error: 'notFound' };
  revalidateTrip(locale, tripId);
  return { ok: true };
}

export async function addChecklistItem(
  tripId: string,
  raw: { title: string; dueOn?: string | null },
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const parsed = z
    .object({ title: z.string().trim().min(1).max(160), dueOn: plainDateString.nullish() })
    .safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const [row] = await queryAsUser(ctx.session, (tx) =>
    tx
      .insert(tripChecklistItems)
      .values({
        householdId: ctx.householdId,
        tripId,
        kind: 'custom',
        customTitle: parsed.data.title,
        dueOn: parsed.data.dueOn ?? null,
      })
      .returning({ id: tripChecklistItems.id }),
  );
  if (!row) return { error: 'createFailed' };
  revalidateTrip(locale, tripId);
  return { created: row.id };
}

/** A database refusal as an error key the screen can say in words. */
function constraintKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('within its trip')) return 'legsOutsideTrip';
  if (message.includes('transition day')) return 'legsOverlap';
  if (/trips_dates|trip_legs_dates/.test(message)) return 'datesInvalid';
  if (message.includes('paid_le_amount')) return 'paidExceedsAmount';
  return 'saveFailed';
}

const withdrawalInput = z.object({
  fromAccountId: z.uuid(),
  /** What was received, in local currency. */
  localAmount: positiveAmount,
  localCurrency: currencyCode,
  /** What the bank charged for it, in the household currency. */
  baseAmount: positiveAmount,
  fee: positiveAmount.nullish(),
  day: plainDateString,
});

export type CashWithdrawalInput = z.input<typeof withdrawalInput>;

/**
 * Buying local currency or taking cash out abroad: a transfer into the trip's
 * cash account at the rate actually obtained, which the cash expenses then
 * use. The fee, if any, is a trip expense.
 */
export async function recordCashWithdrawal(
  tripId: string,
  raw: CashWithdrawalInput,
  locale: Locale = 'es',
): Promise<ActionResult> {
  const ctx = await context();
  if (isError(ctx)) return ctx;
  const parsed = withdrawalInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  if (
    !Money.fromDecimalString(input.baseAmount, 'USD').isPositive() ||
    !Money.fromDecimalString(input.localAmount, 'USD').isPositive()
  ) {
    return { error: 'amountInvalid' };
  }
  try {
    const result = await queryAsUser(ctx.session, async (tx) => {
      const [trip] = await tx
        .select({ id: trips.id, name: trips.name, cash: trips.cashAccountId })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.householdId, ctx.householdId)))
        .limit(1);
      if (!trip) return { error: 'notFound' };
      let cashAccountId = trip.cash;
      if (!cashAccountId) {
        const [created] = await tx
          .insert(accounts)
          .values({
            householdId: ctx.householdId,
            name: `${trip.name} · efectivo`.slice(0, 120),
            accountType: 'cash',
            currency: ctx.currency,
          })
          .returning({ id: accounts.id });
        cashAccountId = created?.id ?? null;
        if (!cashAccountId) return { error: 'createFailed' };
        await tx
          .update(trips)
          .set({ cashAccountId, updatedAt: new Date() })
          .where(eq(trips.id, tripId));
      }
      const rate = fromMinor(
        divide(toScaled(input.localAmount, 4) * 10n ** 10n, toScaled(input.baseAmount, 4)),
        10,
      );
      const moved = await recordTripTransfer(tx, {
        householdId: ctx.householdId,
        userId: ctx.session.user.id,
        tripId,
        currency: ctx.currency,
        fromAccountId: input.fromAccountId,
        toAccountId: cashAccountId,
        date: toPlainDate(input.day),
        baseAmount: input.baseAmount,
        localAmount: input.localAmount,
        localCurrency: input.localCurrency,
        rate,
        description: `${input.localCurrency} · ${trip.name}`.slice(0, 200),
      });
      if (!moved) return { error: 'accountNotFound' };
      if (input.fee && Money.fromDecimalString(input.fee, 'USD').isPositive()) {
        const fee = await recordTripMovement(tx, {
          householdId: ctx.householdId,
          userId: ctx.session.user.id,
          accountId: input.fromAccountId,
          currency: ctx.currency,
          date: toPlainDate(input.day),
          baseAmount: input.fee,
          description: locale === 'en' ? 'Exchange fee' : 'Comisión de cambio',
          tripId,
          category: 'other',
          tripDay: toPlainDate(input.day),
        });
        if (!fee) return { error: 'accountNotFound' };
      }
      return { ok: true as const };
    });
    if ('error' in result) return { error: result.error ?? 'invalid' };
    revalidateTrip(locale, tripId);
    return { ok: true };
  } catch (error) {
    return { error: constraintKey(error) };
  }
}
