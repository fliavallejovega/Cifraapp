import 'server-only';

import { accounts, categories, households, transactions, transfers } from '@app/database/schema';
import {
  Money,
  addMonths,
  endOfMonth,
  startOfMonth,
  todayIn,
  type CurrencyCode,
  type PlainDate,
} from '@app/domain';
import { incomeStatement, type TransactionRow } from '@app/reporting';
import { and, desc, eq, gte, isNull, notInArray } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * How the month is going, for the first screen.
 *
 * The position answers «how much is there»; this answers «what has been
 * happening» — what came in, what went out, and whether that is more or less
 * than usual. Without it a household can upload a hundred statements and see
 * the same screen it saw before the first, which is exactly how the product
 * felt broken.
 *
 * The month shown is this one. When nothing has been recorded in it yet — the
 * statements uploaded so far all end last month — the latest month with
 * movements is shown instead, named as what it is, rather than a row of zeros
 * that reads as «you spent nothing».
 *
 * Duplicates and excluded rows moved no money, and transfers between the
 * household's own accounts are neither income nor spending.
 */

/** Months before the shown one that make up «what is normal». */
const TYPICAL_MONTHS = 3;
const RECENT_ROWS = 5;
const NOT_MONEY = ['duplicate', 'excluded'] as const;

export interface RecentMovement {
  readonly id: string;
  readonly date: PlainDate;
  readonly description: string;
  readonly amount: Money;
  readonly accountName: string;
}

export interface BalanceNote {
  readonly accountName: string;
  /** Bank balance minus calculated balance. */
  readonly gap: Money;
  readonly asOf: PlainDate;
}

export interface MonthGlance {
  readonly currency: CurrencyCode;
  /** First day of the month shown. */
  readonly month: PlainDate;
  /** False when the month shown is an earlier one, because this one has nothing yet. */
  readonly isCurrentMonth: boolean;
  readonly income: Money;
  readonly expenses: Money;
  /** Average spending of the months before, when there are any. */
  readonly typicalExpenses: Money | null;
  readonly recent: readonly RecentMovement[];
  /** Accounts whose last statement did not agree with the calculation. */
  readonly mismatches: readonly BalanceNote[];
  /** Accounts with imported movements whose balance no bank statement has confirmed. */
  readonly unconfirmedAccounts: number;
  readonly hasMovements: boolean;
}

export async function loadMonthGlance(session: Session, householdId: string): Promise<MonthGlance> {
  return queryAsUser(session, async (tx) => {
    const [household] = await tx
      .select({ currency: households.baseCurrency, timeZone: households.timeZone })
      .from(households)
      .where(eq(households.id, householdId))
      .limit(1);

    const currency = household?.currency.trim() === 'PAB' ? 'PAB' : 'USD';
    const today = todayIn(household?.timeZone ?? 'America/Panama');
    const thisMonth = startOfMonth(today);

    const counted = and(
      eq(transactions.householdId, householdId),
      isNull(transactions.deletedAt),
      notInArray(transactions.status, [...NOT_MONEY]),
    );

    const [latest] = await tx
      .select({ date: transactions.transactionDate })
      .from(transactions)
      .where(counted)
      .orderBy(desc(transactions.transactionDate))
      .limit(1);

    const latestDate = (latest?.date ?? null) as PlainDate | null;
    const month =
      latestDate === null || latestDate >= thisMonth ? thisMonth : startOfMonth(latestDate);
    const from = startOfMonth(addMonths(month, -TYPICAL_MONTHS));

    const [rows, links, recent, accountRows, imported] = await Promise.all([
      tx
        .select({
          id: transactions.id,
          date: transactions.transactionDate,
          amount: transactions.amount,
          accountId: transactions.accountId,
          description: transactions.descriptionOriginal,
          categorySlug: categories.templateSlug,
          categoryLabel: categories.name,
          categoryKind: categories.kind,
        })
        .from(transactions)
        .leftJoin(categories, eq(categories.id, transactions.categoryId))
        .where(and(counted, gte(transactions.transactionDate, from))),
      tx
        .select({ from: transfers.fromTransactionId, to: transfers.toTransactionId })
        .from(transfers)
        .where(eq(transfers.householdId, householdId)),
      tx
        .select({
          id: transactions.id,
          date: transactions.transactionDate,
          description: transactions.descriptionOriginal,
          amount: transactions.amount,
          accountName: accounts.name,
        })
        .from(transactions)
        .innerJoin(accounts, eq(accounts.id, transactions.accountId))
        .where(counted)
        .orderBy(desc(transactions.transactionDate), desc(transactions.createdAt))
        .limit(RECENT_ROWS),
      tx
        .select({
          id: accounts.id,
          name: accounts.name,
          anchorSource: accounts.balanceAnchorSource,
          anchorDate: accounts.balanceAnchorDate,
          mismatch: accounts.balanceMismatch,
        })
        .from(accounts)
        .where(
          and(
            eq(accounts.householdId, householdId),
            eq(accounts.status, 'active'),
            isNull(accounts.deletedAt),
          ),
        ),
      tx
        .selectDistinct({ accountId: transactions.accountId })
        .from(transactions)
        .where(and(counted, eq(transactions.source, 'imported'))),
    ]);

    const transferIds = new Set(links.flatMap((link) => [link.from, link.to]));
    const asRows: TransactionRow[] = rows.map((row) => ({
      id: row.id,
      date: row.date as PlainDate,
      amount: Money.fromDecimalString(row.amount, currency),
      accountId: row.accountId,
      categorySlug: row.categorySlug,
      categoryLabel: row.categoryLabel,
      isTransfer: transferIds.has(row.id) || row.categoryKind === 'transfer',
      merchant: row.description,
      deductibleAmount: null,
    }));

    const shown = incomeStatement(asRows, { start: month, end: endOfMonth(month) }, currency);

    // «Normal» only counts months that had movements: a month before the first
    // statement is not a month of zero spending.
    const before: Money[] = [];
    for (let back = 1; back <= TYPICAL_MONTHS; back += 1) {
      const start = startOfMonth(addMonths(month, -back));
      const end = endOfMonth(start);
      if (!asRows.some((row) => row.date >= start && row.date <= end)) continue;
      before.push(incomeStatement(asRows, { start, end }, currency).expenses);
    }
    const typicalExpenses =
      before.length === 0 ? null : Money.sum(before, currency).divide(before.length);

    const importedIds = new Set(imported.map((row) => row.accountId));

    return {
      currency,
      month,
      isCurrentMonth: month === thisMonth,
      income: shown.income,
      expenses: shown.expenses,
      typicalExpenses,
      recent: recent.map((row) => ({
        id: row.id,
        date: row.date as PlainDate,
        description: row.description,
        amount: Money.fromDecimalString(row.amount, currency),
        accountName: row.accountName,
      })),
      mismatches: accountRows.flatMap((row) =>
        row.mismatch !== null && row.anchorDate !== null
          ? [
              {
                accountName: row.name,
                gap: Money.fromDecimalString(row.mismatch, currency),
                asOf: row.anchorDate as PlainDate,
              },
            ]
          : [],
      ),
      unconfirmedAccounts: accountRows.filter(
        (row) => row.anchorSource !== 'statement' && importedIds.has(row.id),
      ).length,
      hasMovements: latestDate !== null,
    };
  });
}
