import 'server-only';

import {
  accounts,
  currencies,
  documents,
  fxRates,
  goals,
  tripBookings,
  tripChecklistItems,
  trips,
  tripLegs,
  tripOverrides,
  tripScenarios,
  tripTravelers,
  transactions,
} from '@app/database/schema';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';
import {
  computeTripBudget,
  exchangeEffect,
  type Proposal,
  type TripBudget,
} from '@app/trip-engine';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { cache } from 'react';

import { isEnabled } from '../flags';
import { getDocumentUrl } from '../storage';
import type { Session } from '../session';
import { queryAsUser } from '../session';
import {
  goalDeadline,
  monthsUntil,
  planTripGoal,
  toEngineInput,
  type GoalPlan,
  type ScenarioParams,
} from '../trip-plan';

import { loadGoals } from './administration';
import { loadBaseline } from './baseline';

/**
 * Viajes: everything a trip screen reads, in a handful of queries.
 *
 * The budget is never stored. Each read loads the trip's inputs — legs,
 * travellers, bookings, overrides and the day-by-day spending — and the pure
 * engine computes the plan from them, so a new expense, a paid booking or a
 * moved rate is reflected on the very next render with nothing to invalidate.
 */

export const TRIPS_FLAG = 'trips_module';

/**
 * Whether the module is on for this household. Fails closed. Cached per
 * request, because the layout and the page both ask.
 */
export const tripsEnabled = cache(
  async (session: Session, householdId: string | null): Promise<boolean> => {
    try {
      return await isEnabled(TRIPS_FLAG, { userId: session.user.id, householdId });
    } catch {
      return false;
    }
  },
);

export type TripRecord = typeof trips.$inferSelect;
export type TripLegRecord = typeof tripLegs.$inferSelect;
export type TripTravelerRecord = typeof tripTravelers.$inferSelect;
export type TripBookingRecord = typeof tripBookings.$inferSelect;
export type TripScenarioRecord = typeof tripScenarios.$inferSelect;
export type TripChecklistRecord = typeof tripChecklistItems.$inferSelect;

export interface TripListItem {
  readonly id: string;
  readonly name: string;
  readonly status: TripRecord['status'];
  readonly startDate: string;
  readonly endDate: string;
  readonly coverEmoji: string | null;
  readonly cities: readonly string[];
  readonly countryCode: string | null;
  readonly baseCurrency: string;
  readonly totalBudget: string;
  readonly spent: string;
  readonly goal: { readonly current: string; readonly target: string } | null;
}

/** The household's trips, current first, then upcoming, then the rest by date. */
export async function loadTrips(
  session: Session,
  householdId: string,
): Promise<readonly TripListItem[]> {
  return queryAsUser(session, async (tx) => {
    const rows = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.householdId, householdId), isNull(trips.archivedAt)))
      .orderBy(desc(trips.startDate));
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);

    const [legs, spent, goalRows] = await Promise.all([
      tx
        .select({
          tripId: tripLegs.tripId,
          city: tripLegs.city,
          countryCode: tripLegs.countryCode,
          position: tripLegs.position,
        })
        .from(tripLegs)
        .where(inArray(tripLegs.tripId, ids))
        .orderBy(asc(tripLegs.position), asc(tripLegs.arrivalDate)),
      tx
        .select({
          tripId: transactions.tripId,
          spent: sql<string>`coalesce(sum(-${transactions.amount}), 0)::text`,
        })
        .from(transactions)
        .where(
          and(
            inArray(transactions.tripId, ids),
            isNull(transactions.deletedAt),
            sql`${transactions.status} <> 'transfer'`,
          ),
        )
        .groupBy(transactions.tripId),
      tx
        .select({ id: goals.id, current: goals.currentAmount, target: goals.targetAmount })
        .from(goals)
        .where(
          inArray(
            goals.id,
            rows.map((row) => row.goalId).filter((id): id is string => id !== null),
          ),
        ),
    ]);

    return rows.map((row) => {
      const goal = row.goalId ? goalRows.find((g) => g.id === row.goalId) : undefined;
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        startDate: row.startDate,
        endDate: row.endDate,
        coverEmoji: row.coverEmoji,
        cities: legs.filter((leg) => leg.tripId === row.id).map((leg) => leg.city),
        countryCode: legs.find((leg) => leg.tripId === row.id)?.countryCode ?? null,
        baseCurrency: row.baseCurrency.trim(),
        totalBudget: row.totalBudget,
        spent: spent.find((s) => s.tripId === row.id)?.spent ?? '0',
        goal: goal ? { current: goal.current, target: goal.target } : null,
      };
    });
  });
}

export interface TripExpense {
  readonly id: string;
  readonly date: string;
  readonly tripDay: string | null;
  readonly category: string | null;
  readonly description: string;
  readonly amount: string;
  readonly originalAmount: string | null;
  readonly originalCurrency: string | null;
  readonly legId: string | null;
  readonly paidByTravelerId: string | null;
  readonly accountId: string;
  readonly status: string;
  readonly fxRate: string | null;
  readonly direction: string;
}

export interface TripDashboard {
  readonly trip: TripRecord;
  readonly legs: readonly TripLegRecord[];
  readonly travelers: readonly TripTravelerRecord[];
  readonly bookings: readonly TripBookingRecord[];
  readonly scenarios: readonly TripScenarioRecord[];
  readonly checklist: readonly TripChecklistRecord[];
  readonly expenses: readonly TripExpense[];
  readonly budget: TripBudget;
  /** Budgets for each scenario, for side-by-side comparison. */
  readonly scenarioBudgets: readonly {
    readonly id: string;
    readonly name: string;
    readonly budget: TripBudget;
  }[];
  readonly goal: {
    readonly id: string;
    readonly name: string;
    readonly current: string;
    readonly target: string;
    readonly targetDate: string | null;
    readonly plan: GoalPlan | null;
  } | null;
  readonly accounts: readonly {
    readonly id: string;
    readonly name: string;
    readonly currency: string;
    readonly type: string;
  }[];
  readonly minorUnits: ReadonlyMap<string, number>;
  readonly rates: ReadonlyMap<string, string>;
  /** Base-currency cost of paying at real rates instead of the planning rates. Positive: more expensive. */
  readonly exchangeEffect: string;
  /** Cash bought for the trip: what came in, and the latest rate per currency. */
  readonly withdrawals: readonly TripExpense[];
  readonly cashRates: ReadonlyMap<string, string>;
}

/** One trip with its computed budget, or null when it is not this household's. */
export async function loadTripDashboard(
  session: Session,
  householdId: string,
  tripId: string,
  today: PlainDate,
  currency: CurrencyCode,
): Promise<TripDashboard | null> {
  const data = await queryAsUser(session, async (tx) => {
    const [trip] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.householdId, householdId)))
      .limit(1);
    if (!trip) return null;

    const [
      legs,
      travelers,
      bookings,
      overrides,
      scenarios,
      checklist,
      spent,
      expenses,
      currencyRows,
      accountRows,
    ] = await Promise.all([
      tx
        .select()
        .from(tripLegs)
        .where(eq(tripLegs.tripId, tripId))
        .orderBy(asc(tripLegs.arrivalDate), asc(tripLegs.position)),
      tx
        .select()
        .from(tripTravelers)
        .where(eq(tripTravelers.tripId, tripId))
        .orderBy(asc(tripTravelers.createdAt)),
      tx
        .select()
        .from(tripBookings)
        .where(and(eq(tripBookings.tripId, tripId), isNull(tripBookings.deletedAt)))
        .orderBy(asc(tripBookings.startsAt)),
      tx.select().from(tripOverrides).where(eq(tripOverrides.tripId, tripId)),
      tx
        .select()
        .from(tripScenarios)
        .where(eq(tripScenarios.tripId, tripId))
        .orderBy(asc(tripScenarios.position)),
      tx
        .select()
        .from(tripChecklistItems)
        .where(eq(tripChecklistItems.tripId, tripId))
        .orderBy(asc(tripChecklistItems.dueOn)),
      // Day-by-day spending, leaving out the transactions that pay a booking:
      // those are already commitments and counting them twice would halve the per diem.
      tx
        .select({
          day: sql<string>`coalesce(${transactions.tripDay}, ${transactions.transactionDate})::text`,
          category: transactions.tripCategory,
          spent: sql<string>`sum(-${transactions.amount})::text`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.tripId, tripId),
            isNull(transactions.deletedAt),
            sql`${transactions.status} <> 'transfer'`,
            sql`not exists (select 1 from app.trip_bookings b where b.transaction_id = ${transactions.id} and b.deleted_at is null)`,
          ),
        )
        .groupBy(sql`1`, transactions.tripCategory),
      tx
        .select({
          id: transactions.id,
          date: transactions.transactionDate,
          tripDay: transactions.tripDay,
          category: transactions.tripCategory,
          description: transactions.descriptionOriginal,
          amount: transactions.amount,
          originalAmount: transactions.originalAmount,
          originalCurrency: transactions.originalCurrency,
          legId: transactions.tripLegId,
          paidByTravelerId: transactions.paidByTravelerId,
          accountId: transactions.accountId,
          status: transactions.status,
          fxRate: transactions.fxRate,
          direction: transactions.direction,
        })
        .from(transactions)
        .where(and(eq(transactions.tripId, tripId), isNull(transactions.deletedAt)))
        .orderBy(desc(transactions.transactionDate), desc(transactions.createdAt))
        .limit(500),
      tx.select({ code: currencies.code, minorUnits: currencies.minorUnits }).from(currencies),
      tx
        .select({
          id: accounts.id,
          name: accounts.name,
          currency: accounts.currency,
          type: accounts.accountType,
        })
        .from(accounts)
        .where(
          and(
            eq(accounts.householdId, householdId),
            isNull(accounts.deletedAt),
            eq(accounts.status, 'active'),
          ),
        )
        .orderBy(asc(accounts.name)),
    ]);

    const codes = [...new Set(legs.map((leg) => leg.localCurrency.trim()))].filter(
      (code) => code !== trip.baseCurrency.trim(),
    );
    const rateRows =
      codes.length > 0
        ? await tx
            .selectDistinctOn([fxRates.quote], { quote: fxRates.quote, rate: fxRates.rate })
            .from(fxRates)
            .where(and(eq(fxRates.base, trip.baseCurrency), inArray(fxRates.quote, codes)))
            .orderBy(fxRates.quote, desc(fxRates.rateDate))
        : [];

    const [goal] = trip.goalId
      ? await tx
          .select({
            id: goals.id,
            name: goals.name,
            current: goals.currentAmount,
            target: goals.targetAmount,
            targetDate: goals.targetDate,
          })
          .from(goals)
          .where(eq(goals.id, trip.goalId))
          .limit(1)
      : [];

    return {
      trip,
      legs,
      travelers,
      bookings,
      overrides,
      scenarios,
      checklist,
      spent,
      expenses,
      currencyRows,
      accountRows,
      rateRows,
      goal,
    };
  });
  if (!data) return null;

  const minorUnits = new Map(data.currencyRows.map((row) => [row.code.trim(), row.minorUnits]));
  const rates = new Map(data.rateRows.map((row) => [row.quote.trim(), row.rate]));

  const goalView = data.goal
    ? await (async () => {
        const goal = data.goal;
        if (!goal) return null;
        let plan: GoalPlan | null = null;
        if (
          goal.targetDate &&
          data.trip.status !== 'completed' &&
          data.trip.status !== 'cancelled'
        ) {
          plan = await savingsPlan(session, householdId, currency, today, {
            id: goal.id,
            target: goal.target,
            current: goal.current,
            targetDate: goal.targetDate as PlainDate,
          });
        }
        return { ...goal, plan };
      })()
    : null;

  const engineFor = (scenario: ScenarioParams | null): TripBudget =>
    computeTripBudget(
      toEngineInput({
        trip: {
          ...data.trip,
          baseCurrency: data.trip.baseCurrency.trim(),
          customShares: data.trip.customShares ?? null,
        },
        legs: data.legs.map((leg) => ({ ...leg, localCurrency: leg.localCurrency.trim() })),
        travelers: data.travelers.map((t) => ({ id: t.id, weight: t.weight })),
        bookings: data.bookings.map((b) => ({ ...b, amount: b.amount })),
        overrides: data.overrides.map((o) => ({
          tripDay: o.tripDay,
          legId: o.legId,
          category: o.category,
          amount: o.amount,
        })),
        spent: data.spent,
        minorUnits,
        latestRates: rates,
        today,
        scenario,
        monthlySavingCapacity: null,
      }),
    );

  const active = data.scenarios.find((s) => s.id === data.trip.activeScenarioId) ?? null;
  const budget = engineFor(active ? active.params : null);
  const scenarioBudgets = data.scenarios.map((s) => ({
    id: s.id,
    name: s.name,
    budget: engineFor(s.params as ScenarioParams),
  }));

  const expenses = data.expenses.filter((e) => e.status !== 'transfer');
  const withdrawals = data.expenses.filter(
    (e) => e.status === 'transfer' && e.direction === 'inflow',
  );
  const cashRates = new Map<string, string>();
  for (const w of [...withdrawals].reverse()) {
    if (w.originalCurrency && w.fxRate) cashRates.set(w.originalCurrency.trim(), w.fxRate);
  }
  const magnitude = (v: string) => v.replace(/^-/, '');
  const exchange = exchangeEffect(
    [
      ...expenses
        .filter((e) => e.originalCurrency && e.originalAmount)
        .map((e) => ({
          localAmount: magnitude(e.originalAmount ?? '0'),
          localMinor: minorUnits.get(e.originalCurrency?.trim() ?? '') ?? 2,
          currency: e.originalCurrency?.trim() ?? '',
          baseAmount: magnitude(e.amount),
        })),
      ...data.bookings
        .filter((b) => b.currency.trim() !== data.trip.baseCurrency.trim())
        .map((b) => ({
          localAmount: b.amount,
          localMinor: minorUnits.get(b.currency.trim()) ?? 2,
          currency: b.currency.trim(),
          baseAmount: b.amountBase,
        })),
    ].map((x) => ({ ...x, localAmount: toTwo(x.localAmount), baseAmount: toTwo(x.baseAmount) })),
    data.trip.planningFx,
    2,
  );

  return {
    trip: data.trip,
    legs: data.legs,
    travelers: data.travelers,
    bookings: data.bookings,
    scenarios: data.scenarios,
    checklist: data.checklist,
    expenses,
    budget,
    scenarioBudgets,
    goal: goalView,
    accounts: data.accountRows,
    minorUnits,
    rates,
    exchangeEffect: exchange,
    withdrawals,
    cashRates,
  };
}

/** A scale-4 database figure trimmed to the two decimals the conversion expects. */
function toTwo(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole}.${(fraction + '00').slice(0, 2)}`;
}

/**
 * The trip goal's traffic light: the household's monthly capacity (income
 * less commitments) against what the other dated goals need each month.
 */
export async function savingsPlan(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
  today: PlainDate,
  goal: { id: string | null; target: string; current: string; targetDate: PlainDate },
): Promise<GoalPlan> {
  const [{ baseline }, allGoals] = await Promise.all([
    loadBaseline(session, householdId, currency, today),
    loadGoals(session, householdId, currency),
  ]);
  const capacity = Money.max(
    Money.zero(currency),
    baseline.monthlyIncome.subtract(baseline.monthlyExpenses),
  );
  const others = Money.sum(
    allGoals
      .filter((g) => g.id !== goal.id && g.status === 'active' && g.targetDate)
      .map((g) => {
        const remaining = Money.max(Money.zero(currency), g.targetAmount.subtract(g.currentAmount));
        return remaining.divide(monthsUntil(today, g.targetDate ?? today), 'half-up');
      }),
    currency,
  );
  return planTripGoal({
    target: Money.fromDecimalString(goal.target, currency),
    saved: Money.fromDecimalString(goal.current, currency),
    today,
    deadline: goal.targetDate,
    monthlyCapacity: capacity,
    otherGoalsMonthly: others,
  });
}

export { goalDeadline };

/** Trips whose dates include `today`, for the «on the road» entry point. */
export async function loadTripsInProgress(session: Session, householdId: string, today: PlainDate) {
  return queryAsUser(session, (tx) =>
    tx
      .select({ id: trips.id, name: trips.name })
      .from(trips)
      .where(
        and(
          eq(trips.householdId, householdId),
          isNull(trips.archivedAt),
          sql`${trips.startDate} <= ${today}::date and ${trips.endDate} >= ${today}::date`,
          isNotNull(trips.id),
        ),
      ),
  );
}

/** Latest reference rate for every currency, as local units per one of `base`. */
export async function loadLatestRates(
  session: Session,
  base: string,
): Promise<Record<string, string>> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .selectDistinctOn([fxRates.quote], { quote: fxRates.quote, rate: fxRates.rate })
      .from(fxRates)
      .where(eq(fxRates.base, base))
      .orderBy(fxRates.quote, desc(fxRates.rateDate)),
  );
  return Object.fromEntries(rows.map((row) => [row.quote.trim(), row.rate]));
}

export interface TripDocumentRow {
  readonly id: string;
  readonly fileName: string;
  readonly kind: string;
  readonly status: string | null;
  readonly confidence: string | null;
  readonly failure: string | null;
  readonly createdAt: Date;
  readonly summary: {
    provider: string | null;
    amount: string | null;
    currency: string | null;
  } | null;
}

/** Documents of one trip, or the household's documents still without a trip. */
export async function loadTripDocuments(
  session: Session,
  householdId: string,
  tripId: string | null,
): Promise<readonly TripDocumentRow[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: documents.id,
        fileName: documents.fileName,
        kind: documents.kind,
        status: documents.tripStatus,
        confidence: documents.tripConfidence,
        failure: documents.tripFailure,
        createdAt: documents.createdAt,
        extraction: documents.tripExtraction,
      })
      .from(documents)
      .where(
        and(
          eq(documents.householdId, householdId),
          isNull(documents.deletedAt),
          isNotNull(documents.tripStatus),
          tripId
            ? eq(documents.tripId, tripId)
            : and(isNull(documents.tripId), sql`${documents.tripStatus} <> 'discarded'`),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(50),
  );
  return rows.map(({ extraction, ...row }) => {
    const p = extraction as {
      provider?: string | null;
      amount?: string | null;
      currency?: string;
    } | null;
    return {
      ...row,
      summary: p
        ? { provider: p.provider ?? null, amount: p.amount ?? null, currency: p.currency ?? null }
        : null,
    };
  });
}

export interface TripDocumentReview {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly status: string | null;
  readonly failure: string | null;
  readonly tripId: string | null;
  readonly url: string | null;
  readonly proposal: Proposal | null;
  readonly trips: readonly { id: string; name: string; startDate: string; endDate: string }[];
  readonly accounts: readonly { id: string; name: string }[];
  readonly legs: readonly { id: string; city: string; tripId: string; localCurrency: string }[];
  readonly travelers: readonly { id: string; displayName: string; tripId: string }[];
  /** Earlier records that look like this document: same reference, or same amount around the same day. */
  readonly possibleDuplicates: readonly {
    kind: 'booking' | 'expense';
    label: string;
    date: string | null;
  }[];
  readonly rates: Readonly<Record<string, string>>;
}

export async function loadTripDocumentReview(
  session: Session,
  householdId: string,
  documentId: string,
  currency: CurrencyCode,
): Promise<TripDocumentReview | null> {
  const data = await queryAsUser(session, async (tx) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.householdId, householdId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (!doc) return null;
    const [tripRows, accountRows, legRows, travelerRows] = await Promise.all([
      tx
        .select({
          id: trips.id,
          name: trips.name,
          startDate: trips.startDate,
          endDate: trips.endDate,
        })
        .from(trips)
        .where(and(eq(trips.householdId, householdId), isNull(trips.archivedAt)))
        .orderBy(desc(trips.startDate))
        .limit(20),
      tx
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts)
        .where(
          and(
            eq(accounts.householdId, householdId),
            isNull(accounts.deletedAt),
            eq(accounts.status, 'active'),
            eq(accounts.currency, currency),
          ),
        )
        .orderBy(asc(accounts.name)),
      tx
        .select({
          id: tripLegs.id,
          city: tripLegs.city,
          tripId: tripLegs.tripId,
          localCurrency: tripLegs.localCurrency,
        })
        .from(tripLegs)
        .where(eq(tripLegs.householdId, householdId)),
      tx
        .select({
          id: tripTravelers.id,
          displayName: tripTravelers.displayName,
          tripId: tripTravelers.tripId,
        })
        .from(tripTravelers)
        .where(eq(tripTravelers.householdId, householdId)),
    ]);
    const proposal = doc.tripExtraction as Proposal | null;
    const duplicates: { kind: 'booking' | 'expense'; label: string; date: string | null }[] = [];
    if (proposal?.referenceCode) {
      const same = await tx
        .select({ provider: tripBookings.provider, ref: tripBookings.referenceCode })
        .from(tripBookings)
        .where(
          and(
            eq(tripBookings.householdId, householdId),
            isNull(tripBookings.deletedAt),
            eq(tripBookings.referenceCode, proposal.referenceCode),
          ),
        )
        .limit(3);
      duplicates.push(
        ...same.map((b) => ({
          kind: 'booking' as const,
          label: `${b.provider ?? ''} ${b.ref ?? ''}`.trim(),
          date: null,
        })),
      );
    }
    if (proposal?.amount && proposal.day && proposal.currency === currency) {
      const near = await tx
        .select({
          description: transactions.descriptionOriginal,
          date: transactions.transactionDate,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            isNull(transactions.deletedAt),
            sql`abs(${transactions.amount}) = ${proposal.amount}::numeric`,
            sql`${transactions.transactionDate} between ${proposal.day}::date - 2 and ${proposal.day}::date + 2`,
          ),
        )
        .limit(3);
      duplicates.push(
        ...near.map((n) => ({ kind: 'expense' as const, label: n.description, date: n.date })),
      );
    }
    return { doc, tripRows, accountRows, legRows, travelerRows, proposal, duplicates };
  });
  if (!data) return null;
  const url = await getDocumentUrl(data.doc.storageKey).catch(() => null);
  return {
    id: data.doc.id,
    fileName: data.doc.fileName,
    mimeType: data.doc.mimeType,
    status: data.doc.tripStatus,
    failure: data.doc.tripFailure,
    tripId: data.doc.tripId,
    url,
    proposal: data.proposal,
    trips: data.tripRows,
    accounts: data.accountRows,
    legs: data.legRows.map((l) => ({ ...l, localCurrency: l.localCurrency.trim() })),
    travelers: data.travelerRows,
    possibleDuplicates: data.duplicates,
    rates: await loadLatestRates(session, currency),
  };
}
