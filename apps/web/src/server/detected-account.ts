import 'server-only';

import type { Database } from '@app/database';
import { accounts, debts, documents } from '@app/database/schema';
import { computeFingerprint, type ParsedStatement } from '@app/transaction-engine';
import { and, eq, isNull, ne } from 'drizzle-orm';

import type { StatementHeader } from './statement-ocr';

/**
 * The account a statement uploaded without one belongs to.
 *
 * Uploading used to require creating the account first, by hand, with a
 * balance the person had to go and look up. Now a statement can arrive on its
 * own: it lands on a provisional account, and once it is read the printed
 * digits decide where it goes.
 *
 * - Digits that match an account the household already has: the statement is
 *   that account's, and the provisional one is put away. The rows were
 *   fingerprinted against the provisional account, so they are fingerprinted
 *   again against the real one — otherwise the duplicate engine would never
 *   recognise them against what that account already holds.
 * - No match: the provisional account becomes the real one, named and typed
 *   from what the header prints. On a card that prints its rate, the debt it
 *   carries is opened too, with the printed minimum and limit; a rate nobody
 *   printed is never invented, so without one the card stays an account.
 *
 * Every figure here was printed on the statement. Nothing is guessed.
 */
export async function settleDetectedAccount(
  db: Database,
  input: {
    readonly householdId: string;
    readonly accountId: string;
    readonly documentId: string;
    readonly parsed: ParsedStatement;
    readonly header: StatementHeader | null;
  },
): Promise<{ accountId: string; parsed: ParsedStatement }> {
  const [account] = await db
    .select({
      id: accounts.id,
      needsConfirmation: accounts.needsConfirmation,
      currency: accounts.currency,
      name: accounts.name,
    })
    .from(accounts)
    .where(eq(accounts.id, input.accountId))
    .limit(1);

  if (!account?.needsConfirmation) return { accountId: input.accountId, parsed: input.parsed };

  const digits = input.parsed.accountHint?.replace(/\D/g, '').slice(-4) ?? '';

  if (digits.length === 4) {
    const others = await db
      .select({
        id: accounts.id,
        maskedNumber: accounts.maskedNumber,
        aliases: accounts.cardAliasDigits,
      })
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, input.householdId),
          eq(accounts.status, 'active'),
          eq(accounts.needsConfirmation, false),
          ne(accounts.id, account.id),
          isNull(accounts.deletedAt),
        ),
      );
    const match = others.find(
      (other) =>
        other.maskedNumber?.replace(/\D/g, '').slice(-4) === digits ||
        other.aliases.includes(digits),
    );

    if (match) {
      await db
        .update(documents)
        .set({ accountId: match.id })
        .where(eq(documents.id, input.documentId));
      // Put away, not deleted: nothing was ever filed against it.
      await db
        .update(accounts)
        .set({ deletedAt: new Date(), status: 'closed', updatedAt: new Date() })
        .where(eq(accounts.id, account.id));
      return { accountId: match.id, parsed: retarget(input.parsed, match.id) };
    }
  }

  const card = input.header?.kind === 'card';
  const institution = input.header?.institution ?? null;
  // The provisional name was written in the household's language when the file
  // arrived; it stays when the header prints neither a bank nor digits.
  const name = [institution ?? account.name, digits ? `·${digits}` : null]
    .filter(Boolean)
    .join(' ');

  await db
    .update(accounts)
    .set({
      name,
      accountType: card ? 'credit_card' : 'checking',
      maskedNumber: digits.length === 4 ? digits : null,
      creditLimit: card ? (input.header?.creditLimit ?? null) : null,
      interestRate: card ? (input.header?.apr ?? null) : null,
      needsConfirmation: false,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, account.id));

  if (card && input.header?.apr) {
    await db.insert(debts).values({
      householdId: input.householdId,
      accountId: account.id,
      name,
      // What is owed arrives with the printed balance when the import is
      // saved; until then the debt opens at zero rather than at a guess.
      principal: '0',
      currentBalance: '0',
      currency: account.currency,
      apr: input.header.apr,
      minimumPayment: input.header.minimumPayment ?? '0',
      creditLimit: input.header.creditLimit ?? null,
      dueDay: input.header.dueDay,
      kind: 'credit_card',
      repayment: 'revolving',
    });
  }

  return { accountId: account.id, parsed: input.parsed };
}

/** The same statement, fingerprinted against another account. */
function retarget(parsed: ParsedStatement, accountId: string): ParsedStatement {
  return {
    ...parsed,
    transactions: parsed.transactions.map((candidate) => ({
      ...candidate,
      fingerprint: computeFingerprint({
        accountId,
        transactionDate: candidate.transactionDate,
        amount: candidate.amount,
        descriptionNormalized: candidate.descriptionNormalized,
      }),
    })),
  };
}
