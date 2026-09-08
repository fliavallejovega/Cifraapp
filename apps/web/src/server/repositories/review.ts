import 'server-only';

import {
  accounts,
  categories,
  duplicateCandidates,
  merchants,
  recurringSeries,
  transactions,
  transfers,
} from '@app/database/schema';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';
import { aliasedTable, and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * The four queues.
 *
 * Everything the engines proposed and nobody has decided yet. They are read
 * together because the only honest way to present them is as one obligation:
 * «there are eleven things waiting on you», not four screens a person has to
 * remember to visit.
 *
 * Each queue reads a proposal that carries its own evidence — the confidence,
 * the signals that fired, the two sides of a pair. A queue that asked «is this
 * a duplicate?» without showing why the system thinks so would be asking a
 * person to rubber-stamp a decision they cannot check.
 */

export interface QueueCounts {
  readonly duplicates: number;
  readonly transfers: number;
  readonly recurring: number;
  readonly categories: number;
  readonly total: number;
}

export async function loadQueueCounts(session: Session, householdId: string): Promise<QueueCounts> {
  return queryAsUser(session, async (tx) => {
    const [duplicates, transferRows, recurring, uncertain] = await Promise.all([
      tx
        .select({ total: count() })
        .from(duplicateCandidates)
        .where(
          and(
            eq(duplicateCandidates.householdId, householdId),
            isNull(duplicateCandidates.resolvedAt),
          ),
        ),
      tx
        .select({ total: count() })
        .from(transfers)
        .where(and(eq(transfers.householdId, householdId), isNull(transfers.confirmedAt))),
      tx
        .select({ total: count() })
        .from(recurringSeries)
        .where(
          and(
            eq(recurringSeries.householdId, householdId),
            eq(recurringSeries.detectedBy, 'system'),
            isNull(recurringSeries.confirmedAt),
            isNull(recurringSeries.deletedAt),
          ),
        ),
      tx
        .select({ total: count() })
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            eq(transactions.status, 'needs_review'),
            isNull(transactions.deletedAt),
          ),
        ),
    ]);

    const counts = {
      duplicates: duplicates[0]?.total ?? 0,
      transfers: transferRows[0]?.total ?? 0,
      recurring: recurring[0]?.total ?? 0,
      categories: uncertain[0]?.total ?? 0,
    };

    return { ...counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) };
  });
}

export interface DuplicateSideView {
  readonly id: string;
  readonly date: PlainDate;
  readonly description: string;
  readonly amount: Money;
  readonly direction: 'inflow' | 'outflow';
  readonly accountName: string;
  readonly source: string;
  readonly status: string;
}

export interface DuplicateCandidateView {
  readonly id: string;
  readonly confidence: number;
  readonly signals: readonly string[];
  readonly existing: DuplicateSideView;
  readonly incoming: DuplicateSideView | null;
}

export async function loadDuplicateQueue(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<readonly DuplicateCandidateView[]> {
  return queryAsUser(session, async (tx) => {
    const rows = await tx
      .select({
        id: duplicateCandidates.id,
        confidence: duplicateCandidates.confidence,
        signals: duplicateCandidates.matchedSignals,
        existingId: duplicateCandidates.existingTransactionId,
        incomingId: duplicateCandidates.incomingTransactionId,
      })
      .from(duplicateCandidates)
      .where(
        and(
          eq(duplicateCandidates.householdId, householdId),
          isNull(duplicateCandidates.resolvedAt),
        ),
      )
      .orderBy(desc(duplicateCandidates.confidence))
      .limit(100);

    if (rows.length === 0) return [];

    // Both sides are the same table, so they are fetched once by id rather than
    // self-joined twice. One extra round trip, and a query anybody can read.
    const wanted = [
      ...new Set(
        rows
          .flatMap((row) => [row.existingId, row.incomingId])
          .filter((id): id is string => id !== null),
      ),
    ];

    const sides = await tx
      .select({
        id: transactions.id,
        date: transactions.transactionDate,
        description: transactions.descriptionOriginal,
        amount: transactions.amount,
        direction: transactions.direction,
        source: transactions.source,
        status: transactions.status,
        accountName: accounts.name,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(and(eq(transactions.householdId, householdId), inArray(transactions.id, wanted)));

    const byId = new Map<string, DuplicateSideView>(
      sides.map((side) => [
        side.id,
        {
          id: side.id,
          date: side.date as PlainDate,
          description: side.description,
          amount: Money.fromDecimalString(side.amount, currency),
          direction: side.direction,
          accountName: side.accountName,
          source: side.source,
          status: side.status,
        },
      ]),
    );

    const views: DuplicateCandidateView[] = [];

    for (const row of rows) {
      const existing = byId.get(row.existingId);
      // A candidate whose surviving side was deleted is not a decision anybody
      // can still make, and is skipped rather than rendered half-empty.
      if (!existing) continue;

      views.push({
        id: row.id,
        confidence: Number(row.confidence),
        signals: Array.isArray(row.signals) ? row.signals.map((signal) => String(signal)) : [],
        existing,
        incoming: row.incomingId === null ? null : (byId.get(row.incomingId) ?? null),
      });
    }

    return views;
  });
}

export interface TransferCandidateView {
  readonly id: string;
  readonly amount: Money;
  readonly confidence: number;
  readonly isCardPayment: boolean;
  readonly from: DuplicateSideView;
  readonly to: DuplicateSideView;
}

export async function loadTransferQueue(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<readonly TransferCandidateView[]> {
  const toTransactions = aliasedTable(transactions, 'to_transaction');
  const toAccounts = aliasedTable(accounts, 'to_account');

  const rows = await queryAsUser(session, async (tx) =>
    tx
      .select({
        id: transfers.id,
        amount: transfers.amount,
        confidence: transfers.confidence,
        isCardPayment: transfers.isCardPayment,

        fromId: transactions.id,
        fromDate: transactions.transactionDate,
        fromDescription: transactions.descriptionOriginal,
        fromAmount: transactions.amount,
        fromDirection: transactions.direction,
        fromStatus: transactions.status,
        fromSource: transactions.source,
        fromAccount: accounts.name,

        toId: toTransactions.id,
        toDate: toTransactions.transactionDate,
        toDescription: toTransactions.descriptionOriginal,
        toAmount: toTransactions.amount,
        toDirection: toTransactions.direction,
        toStatus: toTransactions.status,
        toSource: toTransactions.source,
        toAccount: toAccounts.name,
      })
      .from(transfers)
      .innerJoin(transactions, eq(transactions.id, transfers.fromTransactionId))
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .innerJoin(toTransactions, eq(toTransactions.id, transfers.toTransactionId))
      .innerJoin(toAccounts, eq(toAccounts.id, toTransactions.accountId))
      .where(and(eq(transfers.householdId, householdId), isNull(transfers.confirmedAt)))
      .orderBy(desc(transfers.confidence))
      .limit(100),
  );

  return rows.map((row) => ({
    id: row.id,
    amount: Money.fromDecimalString(row.amount, currency),
    confidence: Number(row.confidence),
    isCardPayment: row.isCardPayment,
    from: {
      id: row.fromId,
      date: row.fromDate as PlainDate,
      description: row.fromDescription,
      amount: Money.fromDecimalString(row.fromAmount, currency),
      direction: row.fromDirection,
      accountName: row.fromAccount,
      source: row.fromSource,
      status: row.fromStatus,
    },
    to: {
      id: row.toId,
      date: row.toDate as PlainDate,
      description: row.toDescription,
      amount: Money.fromDecimalString(row.toAmount, currency),
      direction: row.toDirection,
      accountName: row.toAccount,
      source: row.toSource,
      status: row.toStatus,
    },
  }));
}

export interface DetectedSeriesView {
  readonly id: string;
  readonly name: string;
  readonly direction: 'inflow' | 'outflow';
  readonly expectedAmount: Money;
  readonly frequency: string;
  readonly nextExpectedDate: PlainDate;
  readonly confidence: number;
  readonly occurrenceCount: number;
  readonly amountVariation: number;
  readonly categoryName: string | null;
}

export async function loadRecurringQueue(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<readonly DetectedSeriesView[]> {
  const rows = await queryAsUser(session, async (tx) =>
    tx
      .select({
        id: recurringSeries.id,
        name: recurringSeries.name,
        direction: recurringSeries.direction,
        expectedAmount: recurringSeries.expectedAmount,
        frequency: recurringSeries.frequency,
        nextExpectedDate: recurringSeries.nextExpectedDate,
        confidence: recurringSeries.confidence,
        occurrenceCount: recurringSeries.occurrenceCount,
        amountVariation: recurringSeries.amountVariation,
        categoryName: categories.name,
      })
      .from(recurringSeries)
      .leftJoin(categories, eq(categories.id, recurringSeries.categoryId))
      .where(
        and(
          eq(recurringSeries.householdId, householdId),
          eq(recurringSeries.detectedBy, 'system'),
          isNull(recurringSeries.confirmedAt),
          isNull(recurringSeries.deletedAt),
        ),
      )
      .orderBy(desc(recurringSeries.confidence))
      .limit(100),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    direction: row.direction,
    expectedAmount: Money.fromDecimalString(row.expectedAmount, currency),
    frequency: row.frequency,
    nextExpectedDate: row.nextExpectedDate as PlainDate,
    confidence: Number(row.confidence),
    occurrenceCount: row.occurrenceCount,
    amountVariation: Number(row.amountVariation),
    categoryName: row.categoryName,
  }));
}

export interface UncertainCategoryView {
  readonly id: string;
  readonly date: PlainDate;
  readonly description: string;
  readonly amount: Money;
  readonly direction: 'inflow' | 'outflow';
  readonly accountName: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly confidence: number | null;
  readonly source: string | null;
}

export async function loadCategoryQueue(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<readonly UncertainCategoryView[]> {
  const rows = await queryAsUser(session, async (tx) =>
    tx
      .select({
        id: transactions.id,
        date: transactions.transactionDate,
        description: transactions.descriptionOriginal,
        amount: transactions.amount,
        direction: transactions.direction,
        accountName: accounts.name,
        categoryId: transactions.categoryId,
        categoryName: categories.name,
        confidence: transactions.categoryConfidence,
        source: transactions.categorySource,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.status, 'needs_review'),
          isNull(transactions.deletedAt),
        ),
      )
      // Least confident first: the ones the engine was most unsure about are the
      // ones a person's judgement is worth the most on.
      .orderBy(transactions.categoryConfidence, desc(transactions.transactionDate))
      .limit(100),
  );

  return rows.map((row) => ({
    id: row.id,
    date: row.date as PlainDate,
    description: row.description,
    amount: Money.fromDecimalString(row.amount, currency),
    direction: row.direction,
    accountName: row.accountName,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    confidence: row.confidence === null ? null : Number(row.confidence),
    source: row.source,
  }));
}

export interface MerchantView {
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly defaultCategoryId: string | null;
  readonly defaultCategoryName: string | null;
  readonly transactionCount: number;
  readonly total: Money;
}

/**
 * Where the money actually went, gathered by merchant.
 *
 * The count and the total are what make the screen worth opening: «Super 99,
 * 34 movements, $1,204» is a fact about a household's life, and setting the
 * category once here is what stops the same question being asked 34 times.
 */
export async function loadMerchants(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<readonly MerchantView[]> {
  const rows = await queryAsUser(session, async (tx) =>
    tx
      .select({
        id: merchants.id,
        name: merchants.name,
        normalizedName: merchants.normalizedName,
        defaultCategoryId: merchants.defaultCategoryId,
        defaultCategoryName: categories.name,
        transactionCount: sql<number>`(
          select count(*)::int from app.transactions t
          where t.merchant_id = ${merchants.id} and t.deleted_at is null
        )`,
        // What was spent here, as a magnitude. Netting a refund against the
        // purchases would answer a different question than «how much does this
        // merchant cost us», which is the one the screen asks.
        total: sql<string>`(
          select abs(coalesce(sum(t.amount), 0))::text from app.transactions t
          where t.merchant_id = ${merchants.id}
            and t.direction = 'outflow' and t.deleted_at is null
        )`,
      })
      .from(merchants)
      .leftJoin(categories, eq(categories.id, merchants.defaultCategoryId))
      .where(eq(merchants.householdId, householdId))
      .orderBy(merchants.name),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    normalizedName: row.normalizedName,
    defaultCategoryId: row.defaultCategoryId,
    defaultCategoryName: row.defaultCategoryName,
    transactionCount: row.transactionCount,
    total: Money.fromDecimalString(row.total, currency),
  }));
}
