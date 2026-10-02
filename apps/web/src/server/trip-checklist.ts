import 'server-only';

import {
  tripBookings,
  tripChecklistItems,
  tripLegs,
  transactions,
  trips,
} from '@app/database/schema';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { Tx } from './trip-ledger';

/**
 * The money errands every trip abroad has: tell the bank, insure the trip,
 * carry some local cash. They are derived from the trip, not typed in — the
 * checklist adds them when they apply, moves their dates when the trip moves,
 * and ticks them off itself when the thing they ask for shows up (an
 * insurance booking, a cash withdrawal). An item someone ticked by hand is
 * never touched again.
 */

type AutoKind = 'notify_bank' | 'buy_insurance' | 'get_cash';

/** Days before departure each errand is due. */
const LEAD_DAYS: Readonly<Record<AutoKind, number>> = {
  buy_insurance: 14,
  notify_bank: 3,
  get_cash: 2,
};

/** USD and PAB circulate together: a dollar destination needs no exchange. */
const sameMoney = (a: string, b: string) => {
  const dollar = new Set(['USD', 'PAB']);
  return a === b || (dollar.has(a) && dollar.has(b));
};

const minusDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

export async function syncFinancialChecklist(
  tx: Tx,
  householdId: string,
  tripId: string,
): Promise<void> {
  const [trip] = await tx
    .select({ startDate: trips.startDate, base: trips.baseCurrency, status: trips.status })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.householdId, householdId)))
    .limit(1);
  if (!trip || trip.status === 'completed' || trip.status === 'cancelled') return;
  const base = trip.base.trim();

  const [legs, insurance, cash, existing] = await Promise.all([
    tx
      .select({ country: tripLegs.countryCode, currency: tripLegs.localCurrency })
      .from(tripLegs)
      .where(eq(tripLegs.tripId, tripId)),
    tx
      .select({ id: tripBookings.id })
      .from(tripBookings)
      .where(
        and(
          eq(tripBookings.tripId, tripId),
          eq(tripBookings.bookingType, 'insurance'),
          isNull(tripBookings.deletedAt),
        ),
      )
      .limit(1),
    tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.tripId, tripId),
          eq(transactions.status, 'transfer'),
          eq(transactions.direction, 'inflow'),
          isNull(transactions.deletedAt),
        ),
      )
      .limit(1),
    tx
      .select({
        id: tripChecklistItems.id,
        kind: tripChecklistItems.kind,
        doneAt: tripChecklistItems.doneAt,
        doneBy: tripChecklistItems.doneBy,
      })
      .from(tripChecklistItems)
      .where(
        and(
          eq(tripChecklistItems.tripId, tripId),
          inArray(tripChecklistItems.kind, ['notify_bank', 'buy_insurance', 'get_cash']),
        ),
      ),
  ]);

  const abroad = legs.some((l) => l.country !== null && l.country !== '');
  const foreignMoney = legs.some((l) => !sameMoney(l.currency.trim(), base));
  const wanted: Readonly<Record<AutoKind, boolean>> = {
    notify_bank: abroad,
    buy_insurance: abroad,
    get_cash: foreignMoney,
  };
  const satisfied: Readonly<Record<AutoKind, boolean>> = {
    notify_bank: false,
    buy_insurance: insurance.length > 0,
    get_cash: cash.length > 0,
  };

  for (const kind of Object.keys(LEAD_DAYS) as AutoKind[]) {
    const item = existing.find((row) => row.kind === kind);
    const dueOn = minusDays(trip.startDate, LEAD_DAYS[kind]);
    // Ticked by a person: theirs, not ours.
    if (item?.doneAt && item.doneBy) continue;
    if (!wanted[kind]) {
      if (item && !item.doneAt)
        await tx.delete(tripChecklistItems).where(eq(tripChecklistItems.id, item.id));
      continue;
    }
    if (!item) {
      await tx.insert(tripChecklistItems).values({
        householdId,
        tripId,
        kind,
        dueOn,
        doneAt: satisfied[kind] ? new Date() : null,
      });
      continue;
    }
    // Ticked by the checklist itself follows what it watches, both ways.
    await tx
      .update(tripChecklistItems)
      .set({
        dueOn,
        doneAt: satisfied[kind] ? (item.doneAt ?? new Date()) : null,
        updatedAt: new Date(),
      })
      .where(eq(tripChecklistItems.id, item.id));
  }
}
