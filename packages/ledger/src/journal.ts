import { Money, err, ok, type CurrencyCode, type PlainDate, type Result } from '@app/domain';

import { findAccount } from './accounts.js';
import type { AccountBalance, JournalEntry, JournalLine, LedgerProblem } from './types.js';

/**
 * Building and checking an entry.
 *
 * The database refuses an unbalanced entry with a deferred constraint trigger,
 * which is the guarantee. This is the same check, earlier — so a caller finds
 * out at the point they made the mistake rather than at commit, with a message
 * naming the two totals instead of a constraint name.
 *
 * Both exist deliberately. The application check is for the developer; the
 * database check is for every path that is not this application.
 */

export interface DraftLine {
  readonly accountCode: string;
  readonly side: JournalLine['side'];
  readonly amount: Money;
  readonly memo?: string | null;
}

export interface DraftEntry {
  readonly id: string;
  readonly occurredOn: PlainDate;
  readonly description: string;
  readonly sourceKind: string;
  readonly sourceRef?: string | null;
  readonly currency: CurrencyCode;
  readonly lines: readonly DraftLine[];
}

export function buildEntry(draft: DraftEntry): Result<JournalEntry, LedgerProblem> {
  if (draft.lines.length === 0) return err({ kind: 'no_lines' });

  for (const line of draft.lines) {
    if (!line.amount.isPositive()) {
      return err({ kind: 'non_positive_line', accountCode: line.accountCode });
    }
    if (line.amount.currency !== draft.currency) {
      return err({
        kind: 'currency_mismatch',
        expected: draft.currency,
        received: line.amount.currency,
      });
    }
    if (!findAccount(line.accountCode)) {
      return err({ kind: 'unknown_account', accountCode: line.accountCode });
    }
  }

  const debits = sumSide(draft.lines, 'debit', draft.currency);
  const credits = sumSide(draft.lines, 'credit', draft.currency);

  if (!debits.equals(credits)) {
    return err({ kind: 'unbalanced', debits, credits });
  }

  return ok({
    id: draft.id,
    occurredOn: draft.occurredOn,
    description: draft.description,
    sourceKind: draft.sourceKind,
    sourceRef: draft.sourceRef ?? null,
    currency: draft.currency,
    lines: draft.lines.map((line) => ({
      accountCode: line.accountCode,
      side: line.side,
      amount: line.amount,
      memo: line.memo ?? null,
    })),
  });
}

/**
 * Balances per account across a set of entries.
 *
 * Reported on the account's normal side, so a revenue account with credits
 * exceeding debits shows a positive figure. Reporting every account in raw
 * debit-minus-credit terms is correct and unreadable: half the chart would show
 * healthy months as negative numbers.
 */
export function balances(
  entries: readonly JournalEntry[],
  currency: CurrencyCode,
): AccountBalance[] {
  const totals = new Map<string, { debits: Money; credits: Money }>();
  const zero = Money.zero(currency);

  for (const entry of entries) {
    for (const line of entry.lines) {
      const running = totals.get(line.accountCode) ?? { debits: zero, credits: zero };
      totals.set(
        line.accountCode,
        line.side === 'debit'
          ? { debits: running.debits.add(line.amount), credits: running.credits }
          : { debits: running.debits, credits: running.credits.add(line.amount) },
      );
    }
  }

  return [...totals.entries()]
    .map(([accountCode, running]) => {
      const account = findAccount(accountCode);
      const balance =
        account?.normalBalance === 'credit'
          ? running.credits.subtract(running.debits)
          : running.debits.subtract(running.credits);

      return { accountCode, debits: running.debits, credits: running.credits, balance };
    })
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

/**
 * The trial balance: total debits against total credits across everything.
 *
 * If these ever differ, the ledger is broken and no report built on it means
 * anything. It is the first thing to check and the cheapest.
 */
export function trialBalance(
  entries: readonly JournalEntry[],
  currency: CurrencyCode,
): { debits: Money; credits: Money; isBalanced: boolean } {
  const lines = entries.flatMap((entry) => entry.lines);
  const debits = sumSide(lines, 'debit', currency);
  const credits = sumSide(lines, 'credit', currency);

  return { debits, credits, isBalanced: debits.equals(credits) };
}

function sumSide(
  lines: readonly { side: JournalLine['side']; amount: Money }[],
  side: JournalLine['side'],
  currency: CurrencyCode,
): Money {
  return Money.sum(
    lines.filter((line) => line.side === side).map((line) => line.amount),
    currency,
  );
}
