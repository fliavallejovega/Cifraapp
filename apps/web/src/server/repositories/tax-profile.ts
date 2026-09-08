import 'server-only';

import { accounts, taxProfiles, transactions } from '@app/database/schema';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * The household's own tax facts, and what it has actually set aside.
 *
 * Separate from `repositories/tax.ts`, which reads published rule sets and
 * computes estimates. This one reads only what the household stated and what is
 * sitting in its reserve accounts — figures that are true whether or not
 * anybody has ever reviewed a tax rule.
 */

export interface TaxProfileView {
  readonly taxpayerStatus: string;
  readonly ruc: string | null;
  readonly activity: string | null;
  readonly accountingMethod: 'cash' | 'accrual';
  readonly itbmsRegistered: boolean;
  readonly fiscalYearStart: string;
}

export async function loadTaxProfile(
  session: Session,
  householdId: string,
): Promise<TaxProfileView | null> {
  const [row] = await queryAsUser(session, (tx) =>
    tx
      .select({
        taxpayerStatus: taxProfiles.taxpayerStatus,
        ruc: taxProfiles.ruc,
        activity: taxProfiles.activity,
        accountingMethod: taxProfiles.accountingMethod,
        itbmsRegistered: taxProfiles.itbmsRegistered,
        fiscalYearStart: taxProfiles.fiscalYearStart,
      })
      .from(taxProfiles)
      .where(eq(taxProfiles.householdId, householdId))
      .limit(1),
  );

  return row ?? null;
}

export interface ReserveAccountView {
  readonly id: string;
  readonly name: string;
  readonly balance: Money;
}

export interface ReservePosition {
  /** Income received since the fiscal year began. */
  readonly incomeToDate: Money;
  /** What is actually sitting in accounts of type `tax_reserve`. */
  readonly held: Money;
  readonly accounts: readonly ReserveAccountView[];
}

/**
 * What the household has been paid, and what it has genuinely put aside.
 *
 * Held is read from reserve accounts rather than from a notional figure,
 * because separating the money for real is the only version of a reserve that
 * survives a bad month. A number in a column somebody can spend is not a
 * reserve; it is an intention.
 */
export async function loadReservePosition(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
  fiscalYearStart: PlainDate,
): Promise<ReservePosition> {
  return queryAsUser(session, async (tx) => {
    const [income] = await tx
      .select({
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.direction, 'inflow'),
          sql`${transactions.status} in ('posted', 'pending', 'reconciled')`,
          isNull(transactions.deletedAt),
          gte(transactions.transactionDate, fiscalYearStart),
        ),
      );

    const reserveAccounts = await tx
      .select({
        id: accounts.id,
        name: accounts.name,
        balance: accounts.currentBalance,
      })
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, householdId),
          eq(accounts.accountType, 'tax_reserve'),
          eq(accounts.status, 'active'),
          isNull(accounts.deletedAt),
        ),
      )
      .orderBy(accounts.name);

    const views = reserveAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      balance: Money.fromDecimalString(account.balance, currency),
    }));

    return {
      incomeToDate: Money.fromDecimalString(income?.total ?? '0', currency),
      held: Money.sum(
        views.map((account) => account.balance),
        currency,
      ),
      accounts: views,
    };
  });
}
