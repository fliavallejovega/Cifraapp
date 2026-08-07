import { daysBetween, type Money, type PlainDate } from '@app/domain';

/**
 * Transfer detection.
 *
 * Moving $500 from checking to savings is not income and not spending. Recorded
 * naively it becomes both: a $500 expense and a $500 income, which inflates a
 * month's spending and its earnings by the same amount and makes every
 * derived figure — savings rate, budget adherence, safe-to-spend — wrong.
 *
 * The credit card case is worse. A $1,200 card payment recorded as an expense
 * double-counts, because the purchases that produced the balance were already
 * counted when they happened. A household that pays its card in full every
 * month would appear to spend twice what it does (spec §11).
 *
 * So: two legs, opposite directions, same amount, different accounts of the
 * same household, within a short window. One transfer, never two entries.
 */

export const DEFAULT_TRANSFER_WINDOW_DAYS = 3;

export interface TransferLeg {
  readonly id: string;
  readonly accountId: string;
  readonly accountType: string;
  readonly transactionDate: PlainDate;
  readonly amount: Money;
  readonly descriptionNormalized: string;
}

export interface TransferMatch {
  /** The account money left. */
  readonly from: TransferLeg;
  /** The account money arrived in. */
  readonly to: TransferLeg;
  readonly confidence: number;
  readonly isCardPayment: boolean;
  readonly explanation: string;
}

export interface TransferOptions {
  readonly windowDays?: number;
}

const LIABILITY_ACCOUNTS = new Set(['credit_card', 'loan', 'mortgage']);

/** Words that name the movement itself rather than a merchant. */
const TRANSFER_HINTS = [
  'transferencia',
  'traspaso',
  'transfer',
  'pago tarjeta',
  'pago de tarjeta',
  'card payment',
  'payment thank you',
  'abono',
  'deposito',
  'retiro',
];

function looksLikeTransfer(description: string): boolean {
  return TRANSFER_HINTS.some((hint) => description.includes(hint));
}

/**
 * Pairs opposing legs into transfers.
 *
 * Each transaction is matched at most once. Without that, a household with
 * three $500 movements on the same day produces nine candidate pairs and the
 * caller has to guess which are real.
 */
export function detectTransfers(
  legs: readonly TransferLeg[],
  options: TransferOptions = {},
): TransferMatch[] {
  const windowDays = options.windowDays ?? DEFAULT_TRANSFER_WINDOW_DAYS;

  const outflows = legs
    .filter((leg) => leg.amount.isNegative())
    .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
  const inflows = legs
    .filter((leg) => leg.amount.isPositive())
    .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

  const claimed = new Set<string>();
  const matches: TransferMatch[] = [];

  for (const outflow of outflows) {
    if (claimed.has(outflow.id)) continue;

    let best: { inflow: TransferLeg; confidence: number } | null = null;

    for (const inflow of inflows) {
      if (claimed.has(inflow.id)) continue;

      // A transfer moves money between two accounts. Same account is a
      // correction or a reversal, not a transfer.
      if (inflow.accountId === outflow.accountId) continue;

      if (
        inflow.amount.currency !== outflow.amount.currency ||
        inflow.amount.scaledUnits !== -outflow.amount.scaledUnits
      ) {
        continue;
      }

      const gap = Math.abs(daysBetween(outflow.transactionDate, inflow.transactionDate));
      if (gap > windowDays) continue;

      // Same day is the common case; a settlement lag weakens the claim but
      // does not disqualify it.
      let confidence = gap === 0 ? 0.85 : 0.85 - gap * 0.1;

      if (looksLikeTransfer(outflow.descriptionNormalized)) confidence += 0.07;
      if (looksLikeTransfer(inflow.descriptionNormalized)) confidence += 0.07;

      confidence = Math.min(confidence, 0.99);

      if (!best || confidence > best.confidence) {
        best = { inflow, confidence };
      }
    }

    if (!best) continue;

    claimed.add(outflow.id);
    claimed.add(best.inflow.id);

    // Money arriving at a liability reduces what is owed — that is a card or
    // loan payment, and it must never be counted as spending.
    const isCardPayment = LIABILITY_ACCOUNTS.has(best.inflow.accountType);

    matches.push({
      from: outflow,
      to: best.inflow,
      confidence: best.confidence,
      isCardPayment,
      explanation: isCardPayment
        ? 'A payment toward a card or loan balance. The purchases it settles were already counted as spending.'
        : 'A movement between your own accounts. It is neither income nor spending.',
    });
  }

  return matches;
}

/**
 * Whether a transaction should be excluded from spending totals.
 *
 * The single question every report, budget and safe-to-spend calculation asks.
 * Wrong here means wrong everywhere downstream.
 */
export function countsAsSpending(status: string): boolean {
  return status === 'posted' || status === 'reconciled' || status === 'pending';
}
