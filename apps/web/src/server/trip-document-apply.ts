import 'server-only';

import { documents, fxRates, trips, tripLegs, tripTravelers } from '@app/database/schema';
import { toPlainDate, todayIn, type CurrencyCode } from '@app/domain';
import {
  COST_INDEX_BY_LEVEL,
  convertToBase,
  DEFAULT_TRAVELER_WEIGHT,
  TRIP_CATEGORIES,
} from '@app/trip-engine';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { plainDateString, positiveAmount, recordName } from './record-input';
import { rumboFromDocument } from './rumbo-documents';
import { bookingInput, upsertTripBooking } from './trip-booking-core';
import { syncFinancialChecklist } from './trip-checklist';
import { recordTripMovement, type Tx } from './trip-ledger';

/**
 * Confirming a travel document, without the request around it.
 *
 * The same transaction the review screen runs when a person taps «Confirmar»,
 * pulled out so the reader can run it too: a hotel or a flight that lands
 * cleanly on the trip — no clash with what is planned — is applied as soon as
 * it is read, and the family is told, with a way back. One body for both paths
 * means an automatic confirmation can never do something a manual one would
 * not.
 */

const legInput = z.object({
  city: recordName,
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullish(),
  arrivalDate: plainDateString,
  departureDate: plainDateString,
  localCurrency: z.string().regex(/^[A-Z]{3}$/),
  costLevel: z.enum(['low', 'medium', 'high', 'very_high']),
  timezone: z.string().min(1).max(64).default('America/Panama'),
  lodgingMode: z.enum(['undecided', 'prepaid', 'pay_on_site', 'none']),
});

export const confirmInput = z.object({
  tripId: z.uuid().nullish(),
  createTrip: z
    .object({
      name: recordName,
      startDate: plainDateString,
      endDate: plainDateString,
      totalBudget: positiveAmount,
      legs: z.array(legInput).min(1).max(12),
      travelers: z
        .array(
          z.object({ displayName: recordName, travelerType: z.enum(['adult', 'child', 'infant']) }),
        )
        .max(20),
    })
    .nullish(),
  /** A hotel: the leg it belongs to, created when the trip does not have it yet. */
  lodging: z
    .object({
      city: recordName,
      checkIn: plainDateString,
      checkOut: plainDateString,
      lodgingMode: z.enum(['prepaid', 'pay_on_site']),
    })
    .nullish(),
  booking: bookingInput.nullish(),
  expense: z
    .object({
      accountId: z.uuid(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      fxRate: z
        .string()
        .regex(/^\d{1,9}(\.\d{1,10})?$/)
        .nullish(),
      tripDay: plainDateString,
      description: z.string().trim().max(200).nullish(),
      paidByTravelerId: z.uuid().nullish(),
      /** One line per category: a supermarket receipt can be food and shopping. */
      lines: z
        .array(z.object({ category: z.enum(TRIP_CATEGORIES), amount: positiveAmount }))
        .min(1)
        .max(6),
    })
    .nullish(),
});

export type ConfirmTripDocumentInput = z.input<typeof confirmInput>;
export type ConfirmedTripDocument = z.output<typeof confirmInput>;

export interface ApplyContext {
  readonly householdId: string;
  readonly userId: string;
  readonly currency: CurrencyCode;
}

export async function applyTripDocument(
  tx: Tx,
  ctx: ApplyContext,
  documentId: string,
  input: ConfirmedTripDocument,
): Promise<
  | {
      readonly tripId: string;
      /** A leg this confirmation had to create, so an undo can take it back. */
      readonly createdLegId: string | null;
      readonly bookingId: string | null;
      /** Cities the map does not know yet; Rumbo asks the family to place them. */
      readonly unplaced: readonly string[];
    }
  | { readonly error: string }
> {
  if (!input.booking && !input.expense) return { error: 'invalid' };
  if (!input.tripId && !input.createTrip) return { error: 'tripRequired' };

  // Locked, and only while it waits for review: a double tap confirms once.
  const [doc] = await tx
    .select({ id: documents.id, status: documents.tripStatus })
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.householdId, ctx.householdId),
        isNull(documents.deletedAt),
      ),
    )
    .for('update')
    .limit(1);
  if (!doc) return { error: 'notFound' } as const;
  if (doc.status === 'confirmed') return { error: 'alreadyConfirmed' } as const;

  let tripId = input.tripId ?? null;
  if (!tripId && input.createTrip) {
    const t = input.createTrip;
    const [trip] = await tx
      .insert(trips)
      .values({
        householdId: ctx.householdId,
        createdBy: ctx.userId,
        name: t.name,
        startDate: t.startDate,
        endDate: t.endDate,
        baseCurrency: ctx.currency,
        totalBudget: t.totalBudget,
        status: t.startDate > todayIn('America/Panama') ? 'booked' : 'in_progress',
      })
      .returning({ id: trips.id });
    if (!trip) return { error: 'createFailed' } as const;
    tripId = trip.id;
    // The planning rate is fixed now, as the wizard does.
    const codes = [...new Set(t.legs.map((leg) => leg.localCurrency))].filter(
      (code) => code !== ctx.currency,
    );
    if (codes.length > 0) {
      const latest = await tx
        .selectDistinctOn([fxRates.quote], {
          quote: fxRates.quote,
          rate: fxRates.rate,
          date: fxRates.rateDate,
        })
        .from(fxRates)
        .where(and(eq(fxRates.base, ctx.currency), inArray(fxRates.quote, codes)))
        .orderBy(fxRates.quote, desc(fxRates.rateDate));
      if (latest.length > 0) {
        await tx
          .update(trips)
          .set({
            planningFx: Object.fromEntries(
              latest.map((r) => [r.quote.trim(), { rate: r.rate, date: r.date }]),
            ),
          })
          .where(eq(trips.id, trip.id));
      }
    }
    await tx.insert(tripLegs).values(
      t.legs.map((leg, i) => ({
        householdId: ctx.householdId,
        tripId: trip.id,
        position: i,
        city: leg.city,
        countryCode: leg.countryCode ?? null,
        arrivalDate: leg.arrivalDate,
        departureDate: leg.departureDate,
        localCurrency: leg.localCurrency,
        costLevel: leg.costLevel,
        costIndex: COST_INDEX_BY_LEVEL[leg.costLevel],
        timezone: leg.timezone,
        lodgingMode: leg.lodgingMode,
      })),
    );
    if (t.travelers.length > 0) {
      await tx.insert(tripTravelers).values(
        t.travelers.map((tr) => ({
          householdId: ctx.householdId,
          tripId: trip.id,
          displayName: tr.displayName,
          travelerType: tr.travelerType,
          weight: DEFAULT_TRAVELER_WEIGHT[tr.travelerType],
        })),
      );
    }
  }
  if (!tripId) return { error: 'tripRequired' } as const;
  const [trip] = await tx
    .select({
      id: trips.id,
      base: trips.baseCurrency,
      fx: trips.planningFx,
      start: trips.startDate,
      end: trips.endDate,
    })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.householdId, ctx.householdId)))
    .limit(1);
  if (!trip) return { error: 'notFound' } as const;

  // A hotel lands on its leg: the one in that city, or a new one inside the trip.
  let legId: string | null = input.booking?.legId ?? null;
  let createdLegId: string | null = null;
  if (input.lodging) {
    const l = input.lodging;
    const [leg] = await tx
      .select({ id: tripLegs.id })
      .from(tripLegs)
      .where(and(eq(tripLegs.tripId, tripId), sql`lower(${tripLegs.city}) = lower(${l.city})`))
      .limit(1);
    if (leg) {
      legId = leg.id;
      await tx
        .update(tripLegs)
        .set({ lodgingMode: l.lodgingMode, updatedAt: new Date() })
        .where(eq(tripLegs.id, leg.id));
    } else if (l.checkIn >= trip.start && l.checkOut <= trip.end) {
      const [created] = await tx
        .insert(tripLegs)
        .values({
          householdId: ctx.householdId,
          tripId,
          city: l.city,
          arrivalDate: l.checkIn,
          departureDate: l.checkOut,
          localCurrency: trip.base,
          lodgingMode: l.lodgingMode,
          position: 99,
        })
        .returning({ id: tripLegs.id });
      legId = created?.id ?? null;
      createdLegId = legId;
    }
  }

  let bookingId: string | null = null;
  if (input.booking) {
    const saved = await upsertTripBooking(
      tx,
      { householdId: ctx.householdId, userId: ctx.userId, currency: ctx.currency },
      tripId,
      { ...input.booking, legId, documentId },
    );
    if ('error' in saved) return { error: saved.error } as const;
    bookingId = saved.id;
  }

  let transactionId: string | null = null;
  if (input.expense) {
    const e = input.expense;
    const base = trip.base.trim();
    const rateUsed = e.currency === base ? null : (e.fxRate ?? trip.fx[e.currency]?.rate ?? null);
    if (e.currency !== base && !rateUsed) return { error: 'rateRequired' } as const;
    for (const [i, line] of e.lines.entries()) {
      const baseAmount = rateUsed
        ? convertToBase(line.amount, rateUsed, { minorUnits: 4 }, { minorUnits: 2 })
        : line.amount;
      const movement = await recordTripMovement(tx, {
        householdId: ctx.householdId,
        userId: ctx.userId,
        accountId: e.accountId,
        currency: ctx.currency,
        date: toPlainDate(e.tripDay),
        baseAmount,
        description: e.description?.trim() ?? line.category,
        tripId,
        category: line.category,
        tripDay: toPlainDate(e.tripDay),
        paidByTravelerId: e.paidByTravelerId ?? null,
        original: rateUsed
          ? {
              amount: line.amount,
              currency: e.currency,
              rate: rateUsed,
              rateDate: toPlainDate(e.tripDay),
              source: 'manual',
            }
          : null,
        // The document is the idempotency key of its first line.
        clientRef: i === 0 ? documentId : null,
      });
      if (!movement) return { error: 'accountNotFound' } as const;
      transactionId ??= movement.id;
    }
  }

  // Rumbo takes its fixed points from the same confirmation.
  const placed = await rumboFromDocument(tx, ctx.householdId, tripId, documentId, bookingId);

  await tx
    .update(documents)
    .set({
      tripId,
      tripStatus: 'confirmed',
      tripReviewedAt: new Date(),
      tripBookingId: bookingId,
      tripTransactionId: transactionId,
    })
    .where(eq(documents.id, documentId));
  await syncFinancialChecklist(tx, ctx.householdId, tripId);
  return { tripId, createdLegId, bookingId, unplaced: placed.unplaced } as const;
}
