import 'server-only';

import {
  accounts,
  categories,
  goalCredits,
  goals,
  transactions,
  transfers,
} from '@app/database/schema';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';
import { computeFingerprint, normalizeDescription } from '@app/transaction-engine';
import { CATEGORY_TEMPLATE, type TripCategory } from '@app/trip-engine';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { queryAsUser } from './session';

/**
 * Where a trip's money becomes household money.
 *
 * A trip expense is an ordinary `app.transactions` row with the trip columns
 * filled in: it moves its account's balance, it is fingerprinted like any other
 * movement so a later statement import recognises it, and it is filed under
 * the household category that its trip category maps to. Nothing here keeps a
 * second set of books.
 */

export type Tx = Parameters<Parameters<typeof queryAsUser>[1]>[0];

/** The household category for a trip category: its `travel-*` child, or `travel` itself. */
export async function categoryFor(
  tx: Tx,
  householdId: string,
  category: TripCategory,
): Promise<string | null> {
  const slugs = [CATEGORY_TEMPLATE[category], 'travel'];
  const rows = await tx
    .select({ id: categories.id, slug: categories.templateSlug })
    .from(categories)
    .where(
      and(
        eq(categories.householdId, householdId),
        inArray(categories.templateSlug, slugs),
        isNull(categories.archivedAt),
      ),
    );
  return (
    rows.find((row) => row.slug === slugs[0])?.id ??
    rows.find((row) => row.slug === 'travel')?.id ??
    null
  );
}

export interface TripMovement {
  readonly householdId: string;
  readonly userId: string;
  readonly accountId: string;
  readonly currency: CurrencyCode;
  readonly date: PlainDate;
  /** Positive, base currency. Stored as an outflow. */
  readonly baseAmount: string;
  readonly description: string;
  readonly tripId: string;
  readonly legId?: string | null;
  readonly category: TripCategory;
  readonly tripDay?: PlainDate | null;
  readonly paidByTravelerId?: string | null;
  readonly original?: {
    readonly amount: string;
    readonly currency: string;
    readonly rate: string;
    readonly rateDate: PlainDate;
    readonly source: 'ecb' | 'manual' | 'card_statement';
  } | null;
  readonly clientRef?: string | null;
  readonly notes?: string | null;
}

/**
 * Records a trip outflow and moves its account, in the caller's transaction.
 *
 * With a `clientRef` the insert is idempotent: a second call with the same
 * reference returns the first movement instead of creating another, which is
 * what makes an offline queue or a double tap safe.
 */
export async function recordTripMovement(
  tx: Tx,
  movement: TripMovement,
): Promise<{ id: string; created: boolean } | null> {
  if (movement.clientRef) {
    const [existing] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, movement.householdId),
          eq(transactions.clientRef, movement.clientRef),
        ),
      )
      .limit(1);
    if (existing) return { id: existing.id, created: false };
  }

  const [account] = await tx
    .select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, movement.accountId),
        eq(accounts.householdId, movement.householdId),
        isNull(accounts.deletedAt),
      ),
    )
    .limit(1);
  if (!account) return null;

  const magnitude = Money.fromDecimalString(movement.baseAmount, movement.currency).abs();
  const signed = magnitude.negate();
  const { normalized } = normalizeDescription(movement.description);
  const categoryId = await categoryFor(tx, movement.householdId, movement.category);
  const original = movement.original;

  const [row] = await tx
    .insert(transactions)
    .values({
      householdId: movement.householdId,
      accountId: movement.accountId,
      ownerId: movement.userId,
      transactionDate: movement.date,
      amount: signed.toDecimalString(),
      currency: movement.currency,
      direction: 'outflow',
      descriptionOriginal: movement.description,
      descriptionNormalized: normalized,
      status: 'posted',
      source: 'user',
      fingerprint: computeFingerprint({
        accountId: movement.accountId,
        transactionDate: movement.date,
        amount: signed,
        descriptionNormalized: normalized,
      }),
      ...(categoryId
        ? { categoryId, categorySource: 'user' as const, categoryConfidence: '1.000' }
        : {}),
      tripId: movement.tripId,
      tripLegId: movement.legId ?? null,
      tripCategory: movement.category,
      tripDay: movement.tripDay ?? null,
      paidByTravelerId: movement.paidByTravelerId ?? null,
      ...(original
        ? {
            originalAmount: `-${original.amount.replace(/^-/, '')}`,
            originalCurrency: original.currency,
            fxRate: original.rate,
            fxRateDate: original.rateDate,
            fxSource: original.source,
          }
        : {}),
      clientRef: movement.clientRef ?? null,
      notes: movement.notes ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: transactions.id });

  if (!row) {
    // Lost a race with the same client reference: return the winner.
    if (!movement.clientRef) return null;
    const [winner] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, movement.householdId),
          eq(transactions.clientRef, movement.clientRef),
        ),
      )
      .limit(1);
    return winner ? { id: winner.id, created: false } : null;
  }

  return { id: row.id, created: true };
}

/** Soft-deletes a trip movement; the account balance follows on its own (20261004200000). */
export async function removeTripMovement(
  tx: Tx,
  householdId: string,
  transactionId: string,
): Promise<boolean> {
  const [row] = await tx
    .update(transactions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.householdId, householdId),
        isNull(transactions.deletedAt),
      ),
    )
    .returning({ accountId: transactions.accountId, amount: transactions.amount });
  if (!row) return false;
  return true;
}

/**
 * Keeps a goal's automatic credit for a booking equal to what was paid.
 *
 * The credit row remembers where the progress came from; the goal's own
 * `current_amount` moves by the difference, so the household's manual edits
 * to it stay intact. A zero amount removes the credit.
 */
export async function syncGoalCredit(
  tx: Tx,
  input: {
    householdId: string;
    goalId: string | null;
    bookingId: string;
    paidBase: string;
    userId: string;
  },
): Promise<void> {
  const [existing] = await tx
    .select({ id: goalCredits.id, goalId: goalCredits.goalId, amount: goalCredits.amount })
    .from(goalCredits)
    .where(
      and(eq(goalCredits.sourceKind, 'trip_booking'), eq(goalCredits.sourceId, input.bookingId)),
    )
    .limit(1);

  const toUnits = (value: string): bigint => Money.fromDecimalString(value, 'USD').scaledUnits;
  const wanted = input.goalId ? toUnits(input.paidBase) : 0n;
  const had = existing ? toUnits(existing.amount) : 0n;

  // A credit on a different goal (the trip's goal changed) is taken back first.
  if (existing && existing.goalId !== input.goalId) {
    await tx.delete(goalCredits).where(eq(goalCredits.id, existing.id));
    await tx
      .update(goals)
      .set({
        currentAmount: sql`greatest(0, ${goals.currentAmount} - ${existing.amount}::numeric)`,
        updatedAt: new Date(),
      })
      .where(eq(goals.id, existing.goalId));
  } else if (existing && wanted === had) {
    return;
  }

  const sameGoal = existing?.goalId === input.goalId && existing !== undefined;
  const delta = wanted - (sameGoal ? had : 0n);
  if (!input.goalId) return;

  if (wanted === 0n) {
    if (sameGoal) await tx.delete(goalCredits).where(eq(goalCredits.id, existing.id));
  } else if (sameGoal) {
    await tx
      .update(goalCredits)
      .set({ amount: input.paidBase })
      .where(eq(goalCredits.id, existing.id));
  } else {
    await tx.insert(goalCredits).values({
      householdId: input.householdId,
      goalId: input.goalId,
      sourceKind: 'trip_booking',
      sourceId: input.bookingId,
      amount: input.paidBase,
      createdBy: input.userId,
    });
  }
  if (delta !== 0n) {
    const deltaText = Money.fromScaledUnits(delta, 'USD').toDecimalString();
    await tx
      .update(goals)
      .set({
        currentAmount: sql`greatest(0, ${goals.currentAmount} + ${deltaText}::numeric)`,
        updatedAt: new Date(),
      })
      .where(eq(goals.id, input.goalId));
  }
}

/**
 * Buying local currency or withdrawing cash for a trip: a transfer, not an
 * expense. Two linked movements — out of the bank, into the trip's cash
 * account — both in the household currency, with the local amount and the
 * rate actually obtained kept beside the cash side. The bank's fee, when
 * there is one, is a separate trip expense under «other».
 */
export async function recordTripTransfer(
  tx: Tx,
  input: {
    readonly householdId: string;
    readonly userId: string;
    readonly tripId: string;
    readonly currency: CurrencyCode;
    readonly fromAccountId: string;
    readonly toAccountId: string;
    readonly date: PlainDate;
    /** What left the bank, base currency, positive. */
    readonly baseAmount: string;
    /** For a currency purchase: what was received and at what rate. Absent for a plain transfer. */
    readonly localAmount?: string | null;
    readonly localCurrency?: string | null;
    /** Local units per base unit, as obtained. */
    readonly rate?: string | null;
    readonly description: string;
  },
): Promise<{ fromId: string; toId: string } | null> {
  const [from] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, input.fromAccountId),
        eq(accounts.householdId, input.householdId),
        isNull(accounts.deletedAt),
      ),
    )
    .limit(1);
  if (!from) return null;

  const magnitude = Money.fromDecimalString(input.baseAmount, input.currency).abs();
  const { normalized } = normalizeDescription(input.description);
  const legs = [
    { accountId: input.fromAccountId, signed: magnitude.negate(), direction: 'outflow' as const },
    { accountId: input.toAccountId, signed: magnitude, direction: 'inflow' as const },
  ];
  const ids: string[] = [];
  for (const leg of legs) {
    const [row] = await tx
      .insert(transactions)
      .values({
        householdId: input.householdId,
        accountId: leg.accountId,
        ownerId: input.userId,
        transactionDate: input.date,
        amount: leg.signed.toDecimalString(),
        currency: input.currency,
        direction: leg.direction,
        descriptionOriginal: input.description,
        descriptionNormalized: normalized,
        status: 'transfer',
        source: 'user',
        fingerprint: computeFingerprint({
          accountId: leg.accountId,
          transactionDate: input.date,
          amount: leg.signed,
          descriptionNormalized: normalized,
        }),
        tripId: input.tripId,
        ...(input.localAmount && input.localCurrency && input.rate
          ? {
              originalAmount:
                leg.direction === 'outflow' ? `-${input.localAmount}` : input.localAmount,
              originalCurrency: input.localCurrency,
              fxRate: input.rate,
              fxRateDate: input.date,
              fxSource: 'manual',
            }
          : {}),
      })
      .returning({ id: transactions.id });
    if (!row) return null;
    ids.push(row.id);
  }
  const [fromId, toId] = ids;
  if (!fromId || !toId) return null;
  await tx.insert(transfers).values({
    householdId: input.householdId,
    fromTransactionId: fromId,
    toTransactionId: toId,
    amount: magnitude.toDecimalString(),
    currency: input.currency,
    confidence: '1.000',
    detectedBy: 'user',
    confirmedBy: input.userId,
    confirmedAt: new Date(),
  });
  return { fromId, toId };
}
