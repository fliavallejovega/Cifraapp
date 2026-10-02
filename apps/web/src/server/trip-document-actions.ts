'use server';

import { documents, fxRates, trips, tripLegs, tripTravelers } from '@app/database/schema';
import { toPlainDate, todayIn, type CurrencyCode } from '@app/domain';
import {
  COST_INDEX_BY_LEVEL,
  convertToBase,
  DEFAULT_TRAVELER_WEIGHT,
  TRIP_CATEGORIES,
} from '@app/trip-engine';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';

import { currencyOf } from './household-context';
import { runJobNow } from './jobs';
import { plainDateString, positiveAmount, recordName } from './record-input';
import { tripsEnabled } from './repositories/trips';
import { revalidateTrip } from './revalidate';
import { loadSession, queryAsUser } from './session';
import { bookingInput, upsertTripBooking } from './trip-booking-core';
import { syncFinancialChecklist } from './trip-checklist';
import { stageTripDocument } from './trip-documents';
import { recordTripMovement } from './trip-ledger';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Travel documents: upload, confirm, discard, retry.
 *
 * Confirming is the only path from a reading to the books, and it does its
 * whole job in one database transaction: the trip when the document starts
 * one, the leg a hotel implies, the booking, the payment movement, the goal
 * credit and the document's own status. A second confirm of the same document
 * finds it no longer waiting for review and does nothing.
 */

type Locale = 'en' | 'es';

async function context() {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' } as const;
  if (!(await tripsEnabled(session, session.activeHouseholdId)))
    return { error: 'moduleOff' } as const;
  return {
    session,
    householdId: session.activeHouseholdId,
    currency: currencyOf(session, session.activeHouseholdId) as CurrencyCode,
  } as const;
}

/** Uploads one or more files; each is read in the background and waits for review. */
export async function uploadTripDocuments(
  formData: FormData,
): Promise<RecordActionResult & { readonly documents?: readonly string[] }> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const tripIdRaw = formData.get('tripId');
  const tripId =
    typeof tripIdRaw === 'string' && z.uuid().safeParse(tripIdRaw).success ? tripIdRaw : null;
  const locale: Locale = formData.get('locale') === 'en' ? 'en' : 'es';
  const files = formData
    .getAll('files')
    .filter((f): f is File => f instanceof File && f.size > 0)
    .slice(0, 10);
  if (files.length === 0) return { error: 'noFile' };

  const ids: string[] = [];
  const jobs: string[] = [];
  let lastError: string | null = null;
  for (const file of files) {
    const staged = await stageTripDocument(ctx.session, {
      householdId: ctx.householdId,
      tripId,
      fileName: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    if (staged.ok) {
      ids.push(staged.documentId);
      if (staged.jobId) jobs.push(staged.jobId);
    } else lastError = staged.reason;
  }
  // Read after the response is sent: the person keeps using the app.
  after(async () => {
    for (const job of jobs) await runJobNow(job);
  });
  revalidateTrip(locale, tripId);
  if (ids.length === 0) return { error: lastError ?? 'uploadFailed' };
  return { created: ids[0] ?? '', documents: ids };
}

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

const confirmInput = z.object({
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

export async function confirmTripDocument(
  documentId: string,
  raw: ConfirmTripDocumentInput,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  if (!z.uuid().safeParse(documentId).success) return { error: 'notFound' };
  const parsed = confirmInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  if (!input.booking && !input.expense) return { error: 'invalid' };
  if (!input.tripId && !input.createTrip) return { error: 'tripRequired' };

  try {
    const result = await queryAsUser(ctx.session, async (tx) => {
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
            createdBy: ctx.session.user.id,
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
        }
      }

      let bookingId: string | null = null;
      if (input.booking) {
        const saved = await upsertTripBooking(
          tx,
          { householdId: ctx.householdId, userId: ctx.session.user.id, currency: ctx.currency },
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
        const rateUsed =
          e.currency === base ? null : (e.fxRate ?? trip.fx[e.currency]?.rate ?? null);
        if (e.currency !== base && !rateUsed) return { error: 'rateRequired' } as const;
        for (const [i, line] of e.lines.entries()) {
          const baseAmount = rateUsed
            ? convertToBase(line.amount, rateUsed, { minorUnits: 4 }, { minorUnits: 2 })
            : line.amount;
          const movement = await recordTripMovement(tx, {
            householdId: ctx.householdId,
            userId: ctx.session.user.id,
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
      return { tripId } as const;
    });
    if ('error' in result) return { error: result.error };
    revalidateTrip(locale, result.tripId);
    return { created: result.tripId };
  } catch {
    return { error: 'saveFailed' };
  }
}

export async function discardTripDocument(
  documentId: string,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const rows = await queryAsUser(ctx.session, (tx) =>
    tx
      .update(documents)
      .set({ tripStatus: 'discarded', tripReviewedAt: new Date() })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.householdId, ctx.householdId),
          sql`${documents.tripStatus} <> 'confirmed'`,
        ),
      )
      .returning({ tripId: documents.tripId }),
  );
  if (rows.length === 0) return { error: 'notFound' };
  revalidateTrip(locale, rows[0]?.tripId ?? null);
  return { ok: true };
}

/** Reads the document again: after a transport failure, or when the first reading was poor. */
export async function retryTripDocument(
  documentId: string,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const [doc] = await queryAsUser(ctx.session, (tx) =>
    tx
      .update(documents)
      .set({ tripStatus: 'pending', tripFailure: null })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.householdId, ctx.householdId),
          sql`${documents.tripStatus} in ('failed', 'needs_review', 'pending')`,
        ),
      )
      .returning({
        storageKey: documents.storageKey,
        mimeType: documents.mimeType,
        tripId: documents.tripId,
      }),
  );
  if (!doc) return { error: 'notFound' };
  const { enqueueJob } = await import('./jobs');
  const { TRIP_DOCUMENT_JOB } = await import('./trip-documents');
  const jobId = await enqueueJob(ctx.session, ctx.householdId, TRIP_DOCUMENT_JOB, {
    documentId,
    storageKey: doc.storageKey,
    mimeType: doc.mimeType,
    tripId: doc.tripId,
    userId: ctx.session.user.id,
    retry: Date.now(),
  });
  if (jobId) {
    after(async () => {
      await runJobNow(jobId);
    });
  }
  revalidateTrip(locale, doc.tripId);
  return { ok: true };
}
