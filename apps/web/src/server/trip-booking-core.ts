import 'server-only';

import { tripBookings, tripChecklistItems, trips } from '@app/database/schema';
import { Money, toPlainDate, todayIn, type CurrencyCode } from '@app/domain';
import { convertToBase } from '@app/trip-engine';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { plainDateString, positiveAmount } from './record-input';
import { recordTripMovement, syncGoalCredit, type Tx } from './trip-ledger';
import { BOOKING_CATEGORY } from './trip-plan';

/**
 * Saving a booking, shared by the booking form and the travel-document review:
 * the booking, its payment as a real movement, the goal credit and the
 * checklist item for a balance owed, all in the caller's transaction.
 */

const BOOKING_TYPES = [
  'flight',
  'lodging',
  'insurance',
  'tour',
  'transport',
  'visa',
  'other',
] as const;
const PAYMENT_STATUSES = ['paid', 'deposit_paid', 'pay_later', 'pay_on_site'] as const;
const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/);
const rate = z.string().regex(/^\d{1,9}(\.\d{1,10})?$/);

export const bookingInput = z.object({
  id: z.uuid().optional(),
  legId: z.uuid().nullish(),
  bookingType: z.enum(BOOKING_TYPES),
  provider: z.string().trim().max(120).nullish(),
  referenceCode: z.string().trim().max(60).nullish(),
  startsAt: z.iso.datetime({ offset: true }).nullish(),
  endsAt: z.iso.datetime({ offset: true }).nullish(),
  amount: positiveAmount,
  currency: currencyCode,
  /** Local units per base unit, when the booking is not in the base currency. */
  fxRate: rate.nullish(),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  paidAmount: positiveAmount.default('0'),
  dueDate: plainDateString.nullish(),
  details: z.record(z.string(), z.unknown()).default({}),
  documentId: z.uuid().nullish(),
  /** Paying it: the account it left and the day, to record the real movement. */
  payment: z
    .object({ accountId: z.uuid(), paidOn: plainDateString, linkTransactionId: z.uuid().nullish() })
    .nullish(),
});

export type TripBookingInput = z.input<typeof bookingInput>;

/** Keys a booking's details must never carry: card and passport numbers are not ours to keep. */
const FORBIDDEN_DETAIL_KEYS = /card|pan|cvv|passport|document_number|numero_de_tarjeta|pasaporte/i;

function scrubDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).filter(([key]) => !FORBIDDEN_DETAIL_KEYS.test(key)),
  );
}

export async function upsertTripBooking(
  tx: Tx,
  ctx: { readonly householdId: string; readonly userId: string; readonly currency: CurrencyCode },
  tripId: string,
  input: z.infer<typeof bookingInput>,
): Promise<{ id: string; created: boolean } | { error: string }> {
  const [trip] = await tx
    .select({
      id: trips.id,
      goalId: trips.goalId,
      base: trips.baseCurrency,
      fx: trips.planningFx,
    })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.householdId, ctx.householdId)))
    .limit(1);
  if (!trip) return { error: 'notFound' };
  const base = trip.base.trim();

  const rateUsed =
    input.currency === base ? null : (input.fxRate ?? trip.fx[input.currency]?.rate ?? null);
  if (input.currency !== base && !rateUsed) return { error: 'rateRequired' };
  const toBase = (value: string) =>
    rateUsed ? convertToBase(value, rateUsed, { minorUnits: 4 }, { minorUnits: 2 }) : value;
  const amountBase = toBase(input.amount);
  const paidLocal = input.paymentStatus === 'paid' ? input.amount : input.paidAmount;
  const paidBase = toBase(paidLocal);

  const values = {
    legId: input.legId ?? null,
    bookingType: input.bookingType,
    provider: input.provider ?? null,
    referenceCode: input.referenceCode ?? null,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    amount: input.amount,
    currency: input.currency,
    amountBase,
    fxRate: rateUsed,
    fxRateDate: rateUsed ? (trip.fx[input.currency]?.date ?? todayIn('UTC')) : null,
    paymentStatus: input.paymentStatus,
    paidAmount: input.paymentStatus === 'paid' ? input.amount : input.paidAmount,
    dueDate: input.dueDate ?? null,
    details: scrubDetails(input.details),
    documentId: input.documentId ?? null,
  };

  let bookingId = input.id ?? null;
  let transactionId: string | null = null;
  if (bookingId) {
    const [row] = await tx
      .update(tripBookings)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(tripBookings.id, bookingId),
          eq(tripBookings.tripId, tripId),
          isNull(tripBookings.deletedAt),
        ),
      )
      .returning({ id: tripBookings.id, transactionId: tripBookings.transactionId });
    if (!row) return { error: 'notFound' };
    transactionId = row.transactionId;
  } else {
    const [row] = await tx
      .insert(tripBookings)
      .values({
        householdId: ctx.householdId,
        tripId,
        createdBy: ctx.userId,
        ...values,
      })
      .returning({ id: tripBookings.id });
    bookingId = row?.id ?? null;
  }
  if (!bookingId) return { error: 'createFailed' };

  // The payment, as a real movement — linked when it was already recorded.
  if (input.payment && !transactionId && Money.fromDecimalString(paidBase, 'USD').isPositive()) {
    let movementId = input.payment.linkTransactionId ?? null;
    if (!movementId) {
      const movement = await recordTripMovement(tx, {
        householdId: ctx.householdId,
        userId: ctx.userId,
        accountId: input.payment.accountId,
        currency: ctx.currency,
        date: toPlainDate(input.payment.paidOn),
        baseAmount: paidBase,
        description: input.provider ?? input.bookingType,
        tripId,
        legId: input.legId ?? null,
        category: BOOKING_CATEGORY[input.bookingType],
        tripDay: null,
        original: rateUsed
          ? {
              amount: paidLocal,
              currency: input.currency,
              rate: rateUsed,
              rateDate: toPlainDate(input.payment.paidOn),
              source: 'manual',
            }
          : null,
      });
      if (!movement) return { error: 'accountNotFound' };
      movementId = movement.id;
    }
    await tx
      .update(tripBookings)
      .set({ transactionId: movementId })
      .where(eq(tripBookings.id, bookingId));
  }

  await syncGoalCredit(tx, {
    householdId: ctx.householdId,
    goalId: trip.goalId,
    bookingId,
    paidBase,
    userId: ctx.userId,
  });

  // A balance still owed becomes a dated item on the checklist.
  const owes = input.paymentStatus !== 'paid' && input.dueDate;
  if (owes) {
    await tx
      .insert(tripChecklistItems)
      .values({
        householdId: ctx.householdId,
        tripId,
        bookingId,
        kind: 'pay_balance',
        titleParams: { provider: input.provider ?? '' },
        dueOn: input.dueDate,
      })
      .onConflictDoUpdate({
        target: [tripChecklistItems.bookingId, tripChecklistItems.kind],
        targetWhere: sql`booking_id is not null`,
        set: { dueOn: input.dueDate, updatedAt: new Date() },
      });
  }
  return { id: bookingId, created: !input.id };
}
