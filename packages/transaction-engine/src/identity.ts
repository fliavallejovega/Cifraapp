import { daysBetween, type Money, type PlainDate } from '@app/domain';

import { describesSameMerchant, descriptionSimilarity } from './normalize.js';
import type { CandidateTransaction, ExistingTransaction } from './types.js';

/**
 * The Transaction Identity Engine.
 *
 * The product's central promise is that it never knowingly creates a duplicate
 * expense. That promise is kept here, and it is kept deterministically: exact
 * matching first, probabilistic scoring second, AI never on its own (spec §10).
 *
 * The ladder, in order, stopping at the first rung that resolves:
 *
 *   1. Same external reference on the same account — the institution's own id.
 *   2. Same fingerprint — account, date, amount, normalized description.
 *   3. Same account, amount and date, with a similar description.
 *   4. Same account and amount within a date window, with a similar description.
 *   5. Same merchant and amount within a date window.
 *
 * Anything that clears the certain threshold is a duplicate. Anything between
 * the two thresholds is a candidate for human review — which is a correct
 * outcome, not a failure. Everything below is a genuinely new transaction.
 *
 * The hardest case is not the missed duplicate; it is the false one. Two
 * identical coffees at the same shop on the same day are two transactions, and
 * merging them steals money from the user's records. That is why an exact
 * amount-and-date match still requires description agreement, and why nothing
 * below the certain threshold is ever merged without asking.
 */

export const CERTAIN_THRESHOLD = 0.95;
export const REVIEW_THRESHOLD = 0.6;

/** How far apart the same purchase may appear across two sources. */
export const DEFAULT_DATE_WINDOW_DAYS = 4;

export type MatchSignal =
  | 'external_reference'
  | 'fingerprint'
  | 'exact_amount_and_date'
  | 'amount_within_window'
  | 'merchant_and_amount'
  | 'description_similarity'
  | 'same_document';

export type DuplicateVerdict = 'duplicate' | 'review' | 'new';

export interface DuplicateAssessment {
  readonly verdict: DuplicateVerdict;
  readonly confidence: number;
  readonly matchedTransactionId: string | null;
  readonly signals: readonly MatchSignal[];
  /** Human-readable, in the product's own register. Never "AI detected". */
  readonly explanation: string;
}

export interface DuplicateOptions {
  readonly dateWindowDays?: number;
  /** The document the candidate arrived in, if known. */
  readonly sourceDocumentId?: string;
}

interface ScoredMatch {
  readonly transaction: ExistingTransaction;
  readonly confidence: number;
  readonly signals: MatchSignal[];
}

function sameAmount(left: Money, right: Money): boolean {
  return left.currency === right.currency && left.scaledUnits === right.scaledUnits;
}

function withinWindow(left: PlainDate, right: PlainDate, days: number): boolean {
  return Math.abs(daysBetween(left, right)) <= days;
}

/**
 * Scores one existing transaction against the candidate. Returns null when the
 * pair shares nothing worth considering.
 */
/** A candidate plus the merchant the caller has already resolved, if any. */
type ScorableCandidate = CandidateTransaction & { readonly merchantIdHint?: string };

function score(
  candidate: ScorableCandidate,
  existing: ExistingTransaction,
  options: Required<Pick<DuplicateOptions, 'dateWindowDays'>> & { sourceDocumentId?: string },
): ScoredMatch | null {
  const signals: MatchSignal[] = [];

  // Rung 1. The institution's own identifier. Nothing beats it.
  if (
    candidate.externalReference &&
    existing.externalReference &&
    candidate.externalReference === existing.externalReference
  ) {
    return { transaction: existing, confidence: 1, signals: ['external_reference'] };
  }

  // Rung 2. Identical facts across every channel.
  if (candidate.fingerprint === existing.fingerprint) {
    return { transaction: existing, confidence: 1, signals: ['fingerprint'] };
  }

  // Below this point the amount must agree exactly. A duplicate with a
  // different amount is a different transaction, not a fuzzy match.
  if (!sameAmount(candidate.amount, existing.amount)) {
    return null;
  }

  const similarity = descriptionSimilarity(
    candidate.descriptionNormalized,
    existing.descriptionNormalized,
  );

  const sameDay = candidate.transactionDate === existing.transactionDate;
  const inWindow =
    withinWindow(candidate.transactionDate, existing.transactionDate, options.dateWindowDays) ||
    (existing.postedDate !== null &&
      withinWindow(candidate.transactionDate, existing.postedDate, options.dateWindowDays));

  if (!inWindow) {
    return null;
  }

  // Rung 3. Same account, same amount, same day.
  if (sameDay) {
    signals.push('exact_amount_and_date');
  } else {
    signals.push('amount_within_window');
  }

  if (similarity >= 0.5) {
    signals.push('description_similarity');
  }

  if (
    options.sourceDocumentId &&
    existing.sourceDocumentId &&
    options.sourceDocumentId === existing.sourceDocumentId
  ) {
    // Already imported from this very document. Re-importing a statement must
    // be a no-op (spec §67).
    return { transaction: existing, confidence: 1, signals: [...signals, 'same_document'] };
  }

  // Confidence is built from agreement, not asserted. Same-day plus a strongly
  // similar description is near-certain; a window match with a weak description
  // lands in review, which is where it belongs.
  let confidence = sameDay ? 0.55 : 0.4;
  confidence += similarity * 0.45;

  // One channel abbreviating what another spells out is the common case, not
  // the exception, and trigram overlap alone underrates it badly enough to push
  // a certain match into review.
  if (describesSameMerchant(candidate.descriptionNormalized, existing.descriptionNormalized)) {
    signals.push('merchant_and_amount');
    confidence += 0.25;
  }

  if (candidate.merchantIdHint && existing.merchantId === candidate.merchantIdHint) {
    if (!signals.includes('merchant_and_amount')) signals.push('merchant_and_amount');
    confidence += 0.1;
  }

  return { transaction: existing, confidence: Math.min(confidence, 0.99), signals };
}

/**
 * Assesses a candidate against everything already stored for its account.
 *
 * `existing` should be pre-filtered by the caller to the candidate's account and
 * a date range around it — the database indexes exist for exactly that probe.
 */
export function assessDuplicate(
  candidate: ScorableCandidate,
  existing: readonly ExistingTransaction[],
  options: DuplicateOptions = {},
): DuplicateAssessment {
  const dateWindowDays = options.dateWindowDays ?? DEFAULT_DATE_WINDOW_DAYS;

  let best: ScoredMatch | null = null;

  for (const row of existing) {
    const scored = score(candidate, row, {
      dateWindowDays,
      ...(options.sourceDocumentId ? { sourceDocumentId: options.sourceDocumentId } : {}),
    });
    if (!scored) continue;
    if (!best || scored.confidence > best.confidence) {
      best = scored;
    }
  }

  if (!best) {
    return {
      verdict: 'new',
      confidence: 0,
      matchedTransactionId: null,
      signals: [],
      explanation: 'No existing transaction explains this one.',
    };
  }

  if (best.confidence >= CERTAIN_THRESHOLD) {
    return {
      verdict: 'duplicate',
      confidence: best.confidence,
      matchedTransactionId: best.transaction.id,
      signals: best.signals,
      explanation: explain(best.signals),
    };
  }

  if (best.confidence >= REVIEW_THRESHOLD) {
    return {
      verdict: 'review',
      confidence: best.confidence,
      matchedTransactionId: best.transaction.id,
      signals: best.signals,
      explanation: `${explain(best.signals)} The match is close but not certain.`,
    };
  }

  return {
    verdict: 'new',
    confidence: best.confidence,
    matchedTransactionId: null,
    signals: best.signals,
    explanation: 'No existing transaction explains this one.',
  };
}

function explain(signals: readonly MatchSignal[]): string {
  if (signals.includes('external_reference')) {
    return 'The institution reports the same reference number for both.';
  }
  if (signals.includes('same_document')) {
    return 'This row was already imported from the same statement.';
  }
  if (signals.includes('fingerprint')) {
    return 'Same account, date, amount and description.';
  }
  if (signals.includes('exact_amount_and_date')) {
    return signals.includes('description_similarity')
      ? 'Same amount and date, with a matching description.'
      : 'Same amount and date.';
  }
  return 'Same amount within a few days, with a similar description.';
}
