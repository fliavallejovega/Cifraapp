import { Money, type CurrencyCode } from '@app/domain';

import type { Reconciliation, ReconciliationCandidate, TransactionRow } from './types.js';

/**
 * A bank statement against the system's own figure.
 *
 * The rule is absolute: **never silently adjust a balance.** A plug entry makes
 * the two numbers agree and destroys the only evidence of what was missing — and
 * what is missing is usually a transaction the household needs to see, not an
 * arithmetic error.
 *
 * So this reports the difference and offers explanations. A single unmatched
 * transaction of exactly the right size is the common case; a pair is the next
 * most common. Beyond that the honest answer is "we cannot account for this",
 * and saying so is more useful than a confident subset nobody can verify.
 */

/** Pair search is quadratic, so it is bounded. Beyond this, the answer is "look yourself". */
const MAX_ROWS_FOR_PAIR_SEARCH = 400;

export function reconcile(input: {
  accountId: string;
  statementBalance: Money;
  systemBalance: Money;
  /** Rows that could plausibly explain a gap: uncleared, pending, or late. */
  unmatched: readonly TransactionRow[];
  currency: CurrencyCode;
}): Reconciliation {
  const difference = input.statementBalance.subtract(input.systemBalance);

  return {
    currency: input.currency,
    accountId: input.accountId,
    statementBalance: input.statementBalance,
    systemBalance: input.systemBalance,
    difference,
    isReconciled: difference.isZero(),
    candidates: difference.isZero() ? [] : explain(difference, input.unmatched),
  };
}

function explain(
  difference: Money,
  unmatched: readonly TransactionRow[],
): ReconciliationCandidate[] {
  const candidates: ReconciliationCandidate[] = [];

  for (const row of unmatched) {
    if (row.amount.equals(difference)) {
      candidates.push({
        key: 'reconcile.singleTransaction',
        transactionIds: [row.id],
        amount: row.amount,
      });
    }
  }

  if (candidates.length === 0 && unmatched.length <= MAX_ROWS_FOR_PAIR_SEARCH) {
    outer: for (let i = 0; i < unmatched.length; i += 1) {
      for (let j = i + 1; j < unmatched.length; j += 1) {
        const first = unmatched[i];
        const second = unmatched[j];
        if (!first || !second) continue;

        if (first.amount.add(second.amount).equals(difference)) {
          candidates.push({
            key: 'reconcile.transactionPair',
            transactionIds: [first.id, second.id],
            amount: difference,
          });
          break outer;
        }
      }
    }
  }

  if (candidates.length === 0) {
    // Named rather than left blank. "We cannot account for this" is a finding,
    // and it points a person at the statement instead of at the software.
    candidates.push({ key: 'reconcile.unexplained', transactionIds: [], amount: difference });
  }

  return candidates;
}

/**
 * The rows worth offering as explanations.
 *
 * Anything dated after the statement closed, plus anything the import has not
 * cleared. Handing the search every transaction ever recorded would find a
 * coincidental pair eventually, and a coincidence presented as an explanation is
 * worse than no explanation.
 */
export function reconciliationCandidates(
  rows: readonly TransactionRow[],
  statementDate: string,
): readonly TransactionRow[] {
  return rows.filter((row) => row.date > statementDate);
}

/** Zero in the account's currency, for callers assembling an empty reconciliation. */
export function noDifference(currency: CurrencyCode): Money {
  return Money.zero(currency);
}
