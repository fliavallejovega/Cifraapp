import 'server-only';

import {
  accounts,
  categories,
  classificationLog,
  householdPeople,
  merchants,
  profiles,
  transactionSplits,
  transactions,
} from '@app/database/schema';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * The movements ledger.
 *
 * The product could import a statement, review it and confirm it — and then the
 * movements vanished into the system. No list, no search, no way to correct a
 * category or exclude a line. A bank without a statement.
 *
 * Two decisions shape this reader:
 *
 *   - Filtering happens in SQL, always. A household with three years of
 *     movements is tens of thousands of rows, and «load them all and filter in
 *     JavaScript» is a design that works on the demo account and falls over on
 *     the first real one.
 *   - The page total is a separate aggregate over the *same* predicate, not a
 *     sum of what this page happens to show. A footer that adds up one page and
 *     calls it the total is the kind of figure that destroys trust in every
 *     other figure on the screen.
 */

export const MOVEMENT_STATUSES = [
  'posted',
  'pending',
  'excluded',
  'transfer',
  'duplicate',
  'needs_review',
  'reconciled',
] as const;

export type MovementStatus = (typeof MOVEMENT_STATUSES)[number];

export const PAGE_SIZE = 50;

export interface MovementFilters {
  readonly query?: string;
  readonly accountId?: string;
  readonly categoryId?: string;
  readonly from?: PlainDate;
  readonly to?: PlainDate;
  readonly min?: string;
  readonly max?: string;
  readonly direction?: 'inflow' | 'outflow';
  readonly status?: MovementStatus;
  /** Movements with no category yet — the queue that has to reach zero. */
  readonly uncategorized?: boolean;
  readonly page?: number;
}

export interface MovementView {
  readonly id: string;
  readonly date: PlainDate;
  readonly description: string;
  readonly originalDescription: string;
  readonly amount: Money;
  readonly direction: 'inflow' | 'outflow';
  readonly status: MovementStatus;
  readonly accountId: string;
  readonly accountName: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly categorySource: string | null;
  readonly categoryConfidence: number | null;
  readonly merchantName: string | null;
  readonly notes: string | null;
  readonly source: string;
  readonly splitCount: number;
}

export interface MovementsView {
  readonly rows: readonly MovementView[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  readonly inflow: Money;
  readonly outflow: Money;
  /** True when the household has no movements at all, filters aside. */
  readonly isEmpty: boolean;
  readonly uncategorizedCount: number;
}

function predicateFor(householdId: string, filters: MovementFilters) {
  const clauses = [eq(transactions.householdId, householdId), isNull(transactions.deletedAt)];

  if (filters.accountId) clauses.push(eq(transactions.accountId, filters.accountId));
  if (filters.categoryId) clauses.push(eq(transactions.categoryId, filters.categoryId));
  if (filters.uncategorized) clauses.push(isNull(transactions.categoryId));
  if (filters.from) clauses.push(gte(transactions.transactionDate, filters.from));
  if (filters.to) clauses.push(lte(transactions.transactionDate, filters.to));
  if (filters.direction) clauses.push(eq(transactions.direction, filters.direction));
  if (filters.status) clauses.push(eq(transactions.status, filters.status));

  // Compared as numerics, not as text. `'9' > '10'` is true for strings and
  // false for money, and the column is the one that should decide.
  if (filters.min !== undefined) {
    clauses.push(sql`${transactions.amount} >= ${filters.min}::numeric`);
  }
  if (filters.max !== undefined) {
    clauses.push(sql`${transactions.amount} <= ${filters.max}::numeric`);
  }

  if (filters.query) {
    const pattern = `%${filters.query}%`;
    // Both descriptions: the normalized one is what search usually wants, and
    // the original is what a person remembers seeing on the statement.
    const match = or(
      ilike(transactions.descriptionNormalized, pattern),
      ilike(transactions.descriptionOriginal, pattern),
      ilike(transactions.notes, pattern),
    );
    if (match) clauses.push(match);
  }

  return and(...clauses);
}

export async function loadMovements(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
  filters: MovementFilters,
): Promise<MovementsView> {
  const page = Math.max(1, filters.page ?? 1);
  const where = predicateFor(householdId, filters);

  return queryAsUser(session, async (tx) => {
    const [rows, [totals], [everything], [uncategorized]] = await Promise.all([
      tx
        .select({
          id: transactions.id,
          date: transactions.transactionDate,
          description: transactions.descriptionNormalized,
          originalDescription: transactions.descriptionOriginal,
          amount: transactions.amount,
          direction: transactions.direction,
          status: transactions.status,
          accountId: transactions.accountId,
          accountName: accounts.name,
          categoryId: transactions.categoryId,
          categoryName: categories.name,
          categorySource: transactions.categorySource,
          categoryConfidence: transactions.categoryConfidence,
          merchantName: merchants.name,
          notes: transactions.notes,
          source: transactions.source,
          splitCount: sql<number>`(
            select count(*)::int from app.transaction_splits s
            where s.transaction_id = ${transactions.id}
          )`,
        })
        .from(transactions)
        .innerJoin(accounts, eq(accounts.id, transactions.accountId))
        .leftJoin(categories, eq(categories.id, transactions.categoryId))
        .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
        .where(where)
        // Newest first, and the id breaks ties. UUIDv7 sorts by creation, so
        // two movements on the same day keep the order they arrived in rather
        // than shuffling between page loads.
        .orderBy(desc(transactions.transactionDate), desc(transactions.id))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),

      tx
        .select({
          total: count(),
          inflow: sql<string>`coalesce(sum(${transactions.amount})
            filter (where ${transactions.direction} = 'inflow'), 0)::text`,
          outflow: sql<string>`coalesce(sum(${transactions.amount})
            filter (where ${transactions.direction} = 'outflow'), 0)::text`,
        })
        .from(transactions)
        .where(where),

      tx
        .select({ total: count() })
        .from(transactions)
        .where(and(eq(transactions.householdId, householdId), isNull(transactions.deletedAt))),

      tx
        .select({ total: count() })
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            isNull(transactions.deletedAt),
            isNull(transactions.categoryId),
          ),
        ),
    ]);

    const matching = totals?.total ?? 0;

    return {
      rows: rows.map((row) => ({
        id: row.id,
        date: row.date as PlainDate,
        description: row.description,
        originalDescription: row.originalDescription,
        amount: Money.fromDecimalString(row.amount, currency),
        direction: row.direction,
        status: row.status,
        accountId: row.accountId,
        accountName: row.accountName,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        categorySource: row.categorySource,
        categoryConfidence: row.categoryConfidence === null ? null : Number(row.categoryConfidence),
        merchantName: row.merchantName,
        notes: row.notes,
        source: row.source,
        splitCount: row.splitCount,
      })),
      total: matching,
      page,
      pageCount: Math.max(1, Math.ceil(matching / PAGE_SIZE)),
      inflow: Money.fromDecimalString(totals?.inflow ?? '0', currency),
      outflow: Money.fromDecimalString(totals?.outflow ?? '0', currency),
      isEmpty: (everything?.total ?? 0) === 0,
      uncategorizedCount: uncategorized?.total ?? 0,
    };
  });
}

export interface MovementSplitView {
  readonly id: string;
  readonly amount: Money;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly personId: string | null;
  readonly personName: string | null;
  readonly note: string | null;
}

export interface MovementHistoryEntry {
  readonly id: string;
  readonly at: Date;
  readonly from: string | null;
  readonly to: string | null;
  readonly source: string;
  readonly reason: string;
  readonly actor: string | null;
}

export interface MovementDetailView {
  readonly movement: MovementView;
  readonly splits: readonly MovementSplitView[];
  readonly history: readonly MovementHistoryEntry[];
}

export async function loadMovement(
  session: Session,
  householdId: string,
  movementId: string,
  currency: CurrencyCode,
): Promise<MovementDetailView | null> {
  return queryAsUser(session, async (tx) => {
    const [row] = await tx
      .select({
        id: transactions.id,
        date: transactions.transactionDate,
        description: transactions.descriptionNormalized,
        originalDescription: transactions.descriptionOriginal,
        amount: transactions.amount,
        direction: transactions.direction,
        status: transactions.status,
        accountId: transactions.accountId,
        accountName: accounts.name,
        categoryId: transactions.categoryId,
        categoryName: categories.name,
        categorySource: transactions.categorySource,
        categoryConfidence: transactions.categoryConfidence,
        merchantName: merchants.name,
        notes: transactions.notes,
        source: transactions.source,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
      .where(
        and(
          eq(transactions.id, movementId),
          eq(transactions.householdId, householdId),
          isNull(transactions.deletedAt),
        ),
      )
      .limit(1);

    if (!row) return null;

    const [splitRows, historyRows] = await Promise.all([
      tx
        .select({
          id: transactionSplits.id,
          amount: transactionSplits.amount,
          categoryId: transactionSplits.categoryId,
          categoryName: categories.name,
          personId: transactionSplits.personId,
          personName: householdPeople.displayName,
          note: transactionSplits.note,
        })
        .from(transactionSplits)
        .leftJoin(categories, eq(categories.id, transactionSplits.categoryId))
        .leftJoin(householdPeople, eq(householdPeople.id, transactionSplits.personId))
        .where(eq(transactionSplits.transactionId, movementId))
        .orderBy(asc(transactionSplits.position), asc(transactionSplits.id)),

      tx
        .select({
          id: classificationLog.id,
          at: classificationLog.createdAt,
          previousCategoryId: classificationLog.previousCategoryId,
          categoryId: classificationLog.categoryId,
          source: classificationLog.source,
          reason: classificationLog.reason,
          actor: profiles.displayName,
          actorEmail: profiles.email,
        })
        .from(classificationLog)
        .leftJoin(profiles, eq(profiles.id, classificationLog.actorId))
        .where(eq(classificationLog.transactionId, movementId))
        .orderBy(desc(classificationLog.createdAt))
        .limit(20),
    ]);

    // One query for every category the history mentions, rather than one per
    // entry. A movement re-categorized eight times should not cost eight round
    // trips to a database a continent away.
    const referenced = [
      ...new Set(
        historyRows
          .flatMap((entry) => [entry.previousCategoryId, entry.categoryId])
          .filter((value): value is string => value !== null),
      ),
    ];

    const names = new Map<string, string>();
    if (referenced.length > 0) {
      const found = await tx
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(inArray(categories.id, referenced));
      for (const entry of found) names.set(entry.id, entry.name);
    }

    return {
      movement: {
        id: row.id,
        date: row.date as PlainDate,
        description: row.description,
        originalDescription: row.originalDescription,
        amount: Money.fromDecimalString(row.amount, currency),
        direction: row.direction,
        status: row.status,
        accountId: row.accountId,
        accountName: row.accountName,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        categorySource: row.categorySource,
        categoryConfidence: row.categoryConfidence === null ? null : Number(row.categoryConfidence),
        merchantName: row.merchantName,
        notes: row.notes,
        source: row.source,
        splitCount: splitRows.length,
      },
      splits: splitRows.map((split) => ({
        id: split.id,
        amount: Money.fromDecimalString(split.amount, currency),
        categoryId: split.categoryId,
        categoryName: split.categoryName,
        personId: split.personId,
        personName: split.personName,
        note: split.note,
      })),
      history: historyRows.map((entry) => ({
        id: entry.id,
        at: entry.at,
        from: entry.previousCategoryId ? (names.get(entry.previousCategoryId) ?? null) : null,
        to: entry.categoryId ? (names.get(entry.categoryId) ?? null) : null,
        source: entry.source,
        reason: entry.reason,
        actor: entry.actor ?? entry.actorEmail ?? null,
      })),
    };
  });
}
