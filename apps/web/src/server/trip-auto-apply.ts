import 'server-only';

import type { Database } from '@app/database';
import {
  documents,
  households,
  tripAnchors,
  tripBookings,
  tripFlightSegments,
  tripLegs,
  tripPlaces,
  trips,
} from '@app/database/schema';
import { addDays, toPlainDate, type CurrencyCode } from '@app/domain';
import type { Proposal } from '@app/trip-engine';
import { and, eq, isNull, ne } from 'drizzle-orm';

import { catalogPlaceFor } from './rumbo-documents';
import { decideAutoApply, type TripFacts } from './trip-auto-apply-rules';
import { syncFinancialChecklist } from './trip-checklist';
import { applyTripDocument, confirmInput } from './trip-document-apply';
import type { Tx } from './trip-ledger';

/**
 * Applying a freshly read travel document to its trip, when it fits.
 *
 * Runs at the end of the reader's job, with the admin handle and the household
 * the job carries — a job has no session. The decision is `decideAutoApply`'s,
 * deterministic and tested; this file only gathers what it needs, runs the very
 * same transaction a person's «Confirmar» runs, and writes down what was done
 * so «Deshacer» can take it back.
 *
 * A failure here never fails the reading: the document simply stays waiting
 * for review, as every document did before this existed.
 */
export async function autoApplyTripDocument(
  db: Database,
  input: {
    readonly householdId: string;
    readonly userId: string;
    readonly tripId: string;
    readonly documentId: string;
    readonly proposal: Proposal;
  },
): Promise<'applied' | 'review'> {
  try {
    const facts = await loadTripFacts(db, input.householdId, input.tripId);
    if (!facts) return 'review';

    const decision = decideAutoApply(input.proposal, facts.trip);
    if (decision.kind === 'review') {
      if (decision.reason !== 'not_eligible' && decision.reason !== 'unsure') {
        await db
          .update(documents)
          .set({ tripConflict: { reason: decision.reason, ...(decision.conflict ?? {}) } })
          .where(
            and(eq(documents.id, input.documentId), eq(documents.householdId, input.householdId)),
          );
      }
      return 'review';
    }

    const parsed = confirmInput.safeParse(decision.input);
    if (!parsed.success) return 'review';

    await db.transaction(async (tx) => {
      const result = await applyTripDocument(
        tx,
        { householdId: input.householdId, userId: input.userId, currency: facts.currency },
        input.documentId,
        parsed.data,
      );
      if ('error' in result) throw new Error(result.error);
      await tx
        .update(documents)
        .set({
          tripAutoApplied: {
            at: new Date().toISOString(),
            bookingId: result.bookingId,
            createdLegId: result.createdLegId,
            unplaced: [...result.unplaced],
          },
          tripConflict: null,
        })
        .where(eq(documents.id, input.documentId));
    });
    return 'applied';
  } catch (error: unknown) {
    console.error('[trips] auto-apply skipped', { documentId: input.documentId, error });
    return 'review';
  }
}

async function loadTripFacts(
  db: Database,
  householdId: string,
  tripId: string,
): Promise<{ trip: TripFacts; currency: CurrencyCode } | null> {
  const [trip] = await db
    .select({
      start: trips.startDate,
      end: trips.endDate,
      base: trips.baseCurrency,
      fx: trips.planningFx,
      currency: households.baseCurrency,
    })
    .from(trips)
    .innerJoin(households, eq(households.id, trips.householdId))
    .where(and(eq(trips.id, tripId), eq(trips.householdId, householdId)))
    .limit(1);
  if (!trip) return null;

  const legs = await db
    .select({ city: tripLegs.city, from: tripLegs.arrivalDate, to: tripLegs.departureDate })
    .from(tripLegs)
    .where(eq(tripLegs.tripId, tripId));

  const stays = await db
    .select({
      from: tripAnchors.fromDate,
      to: tripAnchors.toDate,
      label: tripAnchors.label,
      city: tripPlaces.name,
      catalogId: tripPlaces.catalogId,
    })
    .from(tripAnchors)
    .innerJoin(tripPlaces, eq(tripPlaces.id, tripAnchors.placeId))
    .where(and(eq(tripAnchors.tripId, tripId), eq(tripAnchors.kind, 'stay')));

  return {
    currency: (trip.currency.trim() || 'USD') as CurrencyCode,
    trip: {
      tripId,
      start: toPlainDate(trip.start),
      end: toPlainDate(trip.end),
      base: trip.base.trim(),
      rates: Object.fromEntries(Object.entries(trip.fx).map(([code, fx]) => [code, fx.rate])),
      stays: [
        ...legs
          // A leg's last day is the day it leaves: its nights end the night before.
          .filter((leg) => leg.to > leg.from)
          .map((leg) => ({
            source: 'leg' as const,
            catalogId: catalogPlaceFor(leg.city),
            city: leg.city,
            from: toPlainDate(leg.from),
            to: addDays(toPlainDate(leg.to), -1),
            label: null,
          })),
        ...stays.map((stay) => ({
          source: 'anchor' as const,
          catalogId: stay.catalogId,
          city: stay.city,
          from: toPlainDate(stay.from),
          to: toPlainDate(stay.to),
          label: stay.label,
        })),
      ],
    },
  };
}

/**
 * Taking an automatic application back.
 *
 * Removes what the document added — its hotel nights and flights in Rumbo, its
 * booking, the city leg it had to create — and puts the document back in the
 * review queue, where a person decides. Nothing it touched had moved money:
 * an automatic application never records a payment.
 */
export async function undoAutoApplied(
  tx: Tx,
  householdId: string,
  documentId: string,
): Promise<{ tripId: string } | null> {
  const [doc] = await tx
    .select({ tripId: documents.tripId, applied: documents.tripAutoApplied })
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.householdId, householdId),
        eq(documents.tripStatus, 'confirmed'),
        isNull(documents.deletedAt),
      ),
    )
    .for('update')
    .limit(1);
  if (!doc?.tripId || !doc.applied) return null;

  await tx.delete(tripAnchors).where(eq(tripAnchors.documentId, documentId));
  await tx.delete(tripFlightSegments).where(eq(tripFlightSegments.documentId, documentId));
  if (doc.applied.bookingId) {
    await tx
      .update(tripBookings)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(tripBookings.id, doc.applied.bookingId), eq(tripBookings.householdId, householdId)),
      );
  }
  if (doc.applied.createdLegId) {
    // Only if nothing else hangs from it now.
    const [other] = await tx
      .select({ id: tripBookings.id })
      .from(tripBookings)
      .where(
        and(
          eq(tripBookings.legId, doc.applied.createdLegId),
          isNull(tripBookings.deletedAt),
          ...(doc.applied.bookingId ? [ne(tripBookings.id, doc.applied.bookingId)] : []),
        ),
      )
      .limit(1);
    if (!other) await tx.delete(tripLegs).where(eq(tripLegs.id, doc.applied.createdLegId));
  }

  await tx
    .update(documents)
    .set({
      tripStatus: 'needs_review',
      tripBookingId: null,
      tripReviewedAt: null,
      tripAutoApplied: null,
    })
    .where(eq(documents.id, documentId));
  await syncFinancialChecklist(tx, householdId, doc.tripId);
  return { tripId: doc.tripId };
}
