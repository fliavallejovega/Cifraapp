import 'server-only';

import { accounts, households, householdSettings, obligations } from '@app/database/schema';
import { addDays, Money, todayIn, type PlainDate } from '@app/domain';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * The household's financial position.
 *
 * This is the query behind the first viewport, and its whole job is to answer
 * two of the five questions the product exists for: how much is there, and what
 * is already spoken for.
 *
 * `available` is deliberately not the account balance. A balance says what
 * cleared; it says nothing about the rent due on the first. Reporting the
 * balance as spendable is the single most common way personal finance software
 * misleads people (spec §18).
 *
 * This is the honest partial version. The full safe-to-spend — minimum debt
 * payments, tax reserves, goal allocations — arrives with the budget engine in
 * Phase 7. What is here is computed from real rows, and the interface says
 * which components it accounts for rather than implying completeness.
 */

/** Account types whose balance is money the household can actually spend. */
const LIQUID_ACCOUNT_TYPES = ['checking', 'savings', 'cash', 'digital_wallet'] as const;

export const OBLIGATION_HORIZON_DAYS = 30;

export interface Claim {
  readonly id: string;
  readonly name: string;
  readonly due: PlainDate;
  readonly amount: Money;
  readonly isEssential: boolean;
}

export interface Position {
  readonly currency: 'USD' | 'PAB';
  readonly liquid: Money;
  readonly committed: Money;
  readonly available: Money;
  readonly bufferMinimum: Money;
  readonly claims: readonly Claim[];
  readonly accountCount: number;
  /** True when the household has no accounts yet, so the screen can teach. */
  readonly isEmpty: boolean;
}

export async function loadPosition(session: Session, householdId: string): Promise<Position> {
  return queryAsUser(session, async (tx) => {
    const [household] = await tx
      .select({ currency: households.baseCurrency, timeZone: households.timeZone })
      .from(households)
      .where(eq(households.id, householdId))
      .limit(1);

    const currency = (household?.currency.trim() ?? 'USD') as 'USD' | 'PAB';
    const timeZone = household?.timeZone ?? 'America/Panama';

    // "Today" is a property of where the user stands, not of the server.
    const today = todayIn(timeZone);
    const horizon = addDays(today, OBLIGATION_HORIZON_DAYS);

    const accountRows = await tx
      .select({ balance: accounts.currentBalance, type: accounts.accountType })
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, householdId),
          eq(accounts.status, 'active'),
          isNull(accounts.deletedAt),
        ),
      );

    const liquid = Money.sum(
      accountRows
        .filter((row) => (LIQUID_ACCOUNT_TYPES as readonly string[]).includes(row.type))
        .map((row) => Money.fromDecimalString(row.balance, currency)),
      currency,
    );

    const obligationRows = await tx
      .select({
        id: obligations.id,
        name: obligations.name,
        due: obligations.dueDate,
        amount: obligations.expectedAmount,
        isEssential: obligations.isEssential,
      })
      .from(obligations)
      .where(
        and(
          eq(obligations.householdId, householdId),
          isNull(obligations.deletedAt),
          // Unsettled only: an obligation already paid is a transaction, and
          // counting it twice would understate what is available.
          isNull(obligations.settledTransactionId),
          gte(obligations.dueDate, today),
          lte(obligations.dueDate, horizon),
        ),
      )
      .orderBy(obligations.dueDate);

    const claims: Claim[] = obligationRows.map((row) => ({
      id: row.id,
      name: row.name,
      due: row.due as PlainDate,
      amount: Money.fromDecimalString(row.amount, currency),
      isEssential: row.isEssential,
    }));

    const committed = Money.sum(
      claims.map((claim) => claim.amount),
      currency,
    );

    const [settings] = await tx
      .select({ bufferMinimum: householdSettings.bufferMinimum })
      .from(householdSettings)
      .where(eq(householdSettings.householdId, householdId))
      .limit(1);

    return {
      currency,
      liquid,
      committed,
      available: liquid.subtract(committed),
      bufferMinimum: Money.fromDecimalString(settings?.bufferMinimum ?? '0', currency),
      claims,
      accountCount: accountRows.length,
      isEmpty: accountRows.length === 0,
    };
  });
}

void inArray;
