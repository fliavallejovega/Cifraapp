import 'server-only';

import { accounts, debts, imports } from '@app/database/schema';
import { Money } from '@app/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { queryAsUser } from './session';

type Tx = Parameters<Parameters<typeof queryAsUser<unknown>>[1]>[0];

/** Account kinds whose balance is money owed: a printed balance is a debt, stored negative. */
const OWED = new Set(['credit_card', 'loan', 'mortgage', 'other_liability']);

/**
 * The balance a statement prints becomes the account's balance.
 *
 * The account balance is derived in the database — the last stated balance
 * plus every movement after its date (20261004200000). A printed balance is the
 * bank's own statement of it, so it replaces the anchor when it is newer than
 * the one on file, or when the one on file is only what somebody typed and no
 * statement ever confirmed it. The household decided (2026-10-04) that the
 * printed figure wins over the calculated one.
 *
 * When both are comparable — the anchor on file is older than the printed date
 * — the difference between the bank and the calculation is kept. It is almost
 * always a statement that has not been uploaded yet, and the household is told.
 *
 * Returns true when the balance was applied.
 */
export async function applyStatementBalance(tx: Tx, importId: string): Promise<boolean> {
  const [row] = await tx
    .select({
      accountId: imports.accountId,
      printed: imports.printedBalance,
      printedDate: imports.printedBalanceDate,
      type: accounts.accountType,
      currency: accounts.currency,
      current: accounts.currentBalance,
      anchor: accounts.balanceAnchor,
      anchorDate: accounts.balanceAnchorDate,
      anchorSource: accounts.balanceAnchorSource,
    })
    .from(imports)
    .innerJoin(accounts, eq(accounts.id, imports.accountId))
    .where(eq(imports.id, importId))
    .limit(1);

  if (!row?.accountId || row.printed === null || row.printedDate === null) return false;

  const currency = row.currency.trim() === 'PAB' ? 'PAB' : 'USD';
  const printed = Money.fromDecimalString(row.printed, currency);
  const stated = OWED.has(row.type) ? printed.abs().negate() : printed;

  const newer = row.anchorDate === null || row.printedDate >= row.anchorDate;
  const onlyTyped = row.anchorSource !== 'statement';
  if (!newer && !onlyTyped) return false;
  const unchanged =
    row.anchor !== null &&
    row.anchorDate === row.printedDate &&
    stated.equals(Money.fromDecimalString(row.anchor, currency));
  if (unchanged) return false;

  // What the ledger says the balance was on the printed date, when the anchor
  // on file is old enough to say it.
  let mismatch: string | null = null;
  if (newer && row.anchorDate !== null) {
    const [after] = await tx.execute<{ total: string }>(
      sql`select app.account_movements_after(${row.accountId}::uuid, ${row.printedDate}::date)::text as total`,
    );
    const calculated = Money.fromDecimalString(row.current, currency).subtract(
      Money.fromDecimalString(after?.total ?? '0', currency),
    );
    const gap = stated.subtract(calculated);
    mismatch = gap.isZero() ? null : gap.toDecimalString();
  }

  await tx
    .update(accounts)
    .set({
      balanceAnchor: stated.toDecimalString(),
      balanceAnchorDate: row.printedDate,
      balanceAnchorSource: 'statement',
      balanceMismatch: mismatch,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, row.accountId));

  // A card's debt is the same number seen from the other side: what the bank
  // says is owed is what the debt carries.
  if (OWED.has(row.type) && newer) {
    await tx
      .update(debts)
      .set({ currentBalance: stated.abs().toDecimalString(), updatedAt: new Date() })
      .where(and(eq(debts.accountId, row.accountId), isNull(debts.deletedAt)));
  }

  return true;
}
