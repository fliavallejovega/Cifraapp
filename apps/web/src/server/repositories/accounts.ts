import 'server-only';

import { accounts } from '@app/database/schema';
import { Money, type CurrencyCode } from '@app/domain';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * The household's accounts.
 *
 * The list a person manages directly: what exists, what each one holds, and how
 * many movements have been filed against it. The movement count is what makes
 * an account answerable — an account with a balance and no movements is a
 * number somebody typed, and the interface should not let that pass for a
 * reconciled position.
 *
 * Liability balances are stored positive, meaning "what is owed" (see
 * `netWorth` in `@app/reporting`). The sign convention lives in one place and
 * the forms teach it rather than guessing at it.
 */

/** Balances that are money the household can actually spend. */
export const LIQUID_TYPES = ['checking', 'savings', 'cash', 'digital_wallet'] as const;

/** Balances that are owed rather than held. */
export const LIABILITY_TYPES = ['credit_card', 'loan', 'mortgage', 'other_liability'] as const;

/**
 * Every type the database accepts, in the order the form offers them: what a
 * household opens first, then what it owes, then the rest.
 */
export const ACCOUNT_TYPES = [
  'checking',
  'savings',
  'cash',
  'digital_wallet',
  'credit_card',
  'loan',
  'mortgage',
  'investment',
  'business',
  'tax_reserve',
  'other_asset',
  'other_liability',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

// Membership tests, as sets of plain strings: the column's union is wider than
// either list, and a set says "is it one of these" without an assertion.
const LIQUID_SET = new Set<string>(LIQUID_TYPES);
const LIABILITY_SET = new Set<string>(LIABILITY_TYPES);

export const ACCOUNT_TYPE_GROUPS: readonly {
  readonly key: 'liquid' | 'debt' | 'other';
  readonly types: readonly AccountType[];
}[] = [
  { key: 'liquid', types: ['checking', 'savings', 'cash', 'digital_wallet'] },
  { key: 'debt', types: ['credit_card', 'loan', 'mortgage'] },
  {
    key: 'other',
    types: ['investment', 'business', 'tax_reserve', 'other_asset', 'other_liability'],
  },
];

export interface AccountView {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly maskedNumber: string | null;
  readonly balance: Money;
  readonly status: 'active' | 'closed' | 'archived';
  readonly isLiability: boolean;
  readonly isLiquid: boolean;
  readonly transactionCount: number;
}

export interface AccountsView {
  readonly currency: CurrencyCode;
  readonly accounts: readonly AccountView[];
  readonly liquid: Money;
  readonly liabilities: Money;
  /** True when nothing has ever been created, so the screen can teach. */
  readonly isEmpty: boolean;
}

export async function loadAccounts(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<AccountsView> {
  return queryAsUser(session, async (tx) => {
    const rows = await tx
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.accountType,
        maskedNumber: accounts.maskedNumber,
        balance: accounts.currentBalance,
        status: accounts.status,
        // Counted in the same query rather than per row: a household with
        // twenty accounts should not cost twenty round trips.
        transactionCount: sql<number>`(
          select count(*)::int from app.transactions t
          where t.account_id = ${accounts.id} and t.deleted_at is null
        )`,
      })
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), isNull(accounts.deletedAt)))
      .orderBy(desc(accounts.status), accounts.createdAt);

    const views: AccountView[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      maskedNumber: row.maskedNumber,
      balance: Money.fromDecimalString(row.balance, currency),
      status: row.status,
      isLiability: LIABILITY_SET.has(row.type),
      isLiquid: LIQUID_SET.has(row.type),
      transactionCount: row.transactionCount,
    }));

    const active = views.filter((view) => view.status === 'active');

    return {
      currency,
      accounts: views,
      liquid: Money.sum(
        active.filter((view) => view.isLiquid).map((view) => view.balance),
        currency,
      ),
      liabilities: Money.sum(
        active.filter((view) => view.isLiability).map((view) => view.balance.abs()),
        currency,
      ),
      isEmpty: views.length === 0,
    };
  });
}

/** Whether the household has at least one account an import could file against. */
export async function hasActiveAccount(session: Session, householdId: string): Promise<boolean> {
  const [row] = await queryAsUser(session, (tx) =>
    tx
      .select({ total: count() })
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, householdId),
          eq(accounts.status, 'active'),
          isNull(accounts.deletedAt),
        ),
      ),
  );

  return (row?.total ?? 0) > 0;
}
