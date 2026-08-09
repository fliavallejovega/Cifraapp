import type { PlainDate } from '@app/domain';

import { findMatchingRule } from './rules.js';
import type {
  ClassificationLogEntry,
  ClassificationSource,
  MatchKind,
  MerchantRule,
} from './types.js';

/**
 * Learning from corrections.
 *
 * This is the whole point of Phase 6: when a person fixes a category, the system
 * should stop asking. But it must learn the way a careful colleague does — by
 * noticing a settled habit, not by generalizing from one instance.
 *
 * Two guards keep it honest. A single correction proposes nothing, because
 * people re-file a one-off purchase all the time and a rule built from that will
 * be wrong every month afterwards. And a proposal is a proposal: it is written
 * with `source: 'ai'` and low authority until the household confirms it, at
 * which point it becomes a user rule and outranks everything the system infers.
 *
 * Nothing here writes. It returns what should be written, and the caller records
 * it inside the same transaction as the correction itself.
 */

/** One correction is a preference. Two is a pattern. */
export const CORRECTIONS_BEFORE_PROPOSAL = 2;

/** Tokens shorter than this identify nothing — `de`, `la`, `sa` are everywhere. */
const MEANINGFUL_TOKEN_LENGTH = 3;

export interface Correction {
  readonly transactionId: string;
  readonly descriptionNormalized: string;
  readonly merchantId: string | null;
  readonly categoryId: string;
  readonly previousCategoryId: string | null;
  readonly previousSource: ClassificationSource | null;
  readonly actorId: string;
  /** Only a person may correct. A model proposing a change is a suggestion. */
  readonly source: 'user' | 'accountant';
  readonly at: PlainDate;
}

export interface RuleProposal {
  readonly matchKind: MatchKind;
  readonly pattern: string;
  readonly categoryId: string;
  readonly merchantId: string | null;
  readonly source: ClassificationSource;
  readonly confidence: number;
  readonly priority: number;
  readonly supportingCorrections: number;
  readonly explanation: string;
}

/**
 * Turns a correction into the row that records it.
 *
 * Every classification change is logged, including the one the system made
 * itself. Without the previous value a correction cannot be undone, and without
 * the previous source it cannot be explained why the system had it wrong.
 */
export function recordCorrection(correction: Correction): ClassificationLogEntry {
  return {
    transactionId: correction.transactionId,
    previousCategoryId: correction.previousCategoryId,
    categoryId: correction.categoryId,
    previousSource: correction.previousSource,
    source: correction.source,
    confidence: 1,
    appliedRuleId: null,
    actorId: correction.actorId,
    reason:
      correction.source === 'accountant'
        ? 'Recategorized by your accountant.'
        : 'Recategorized by you.',
  };
}

/**
 * Proposes a rule when a household's corrections have settled into a habit.
 *
 * `corrections` should already be scoped to one merchant or one description
 * family by the caller — the database indexes make that probe cheap, and doing
 * the scoping here would mean loading a household's entire correction history to
 * answer a question about one shop.
 */
export function proposeRule(
  corrections: readonly Correction[],
  existingRules: readonly MerchantRule[],
  on: PlainDate,
): RuleProposal | null {
  if (corrections.length < CORRECTIONS_BEFORE_PROPOSAL) return null;

  // Newest first, so the streak that matters is the household's current habit
  // rather than what it used to do a year ago.
  const ordered = [...corrections].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const target = ordered[0];
  if (!target) return null;

  const agreeing = takeLeadingAgreement(ordered, target.categoryId);
  if (agreeing.length < CORRECTIONS_BEFORE_PROPOSAL) return null;

  const pattern = derivePattern(agreeing.map((correction) => correction.descriptionNormalized));
  if (!pattern) return null;

  // If a rule already sends this description to the same category, the habit is
  // recorded and proposing a second rule would only create a conflict to resolve.
  const existing = findMatchingRule(agreeing[0]?.descriptionNormalized ?? '', existingRules, on);
  if (existing?.categoryId === target.categoryId) return null;

  const byAccountant = agreeing.some((correction) => correction.source === 'accountant');

  return {
    matchKind: pattern.matchKind,
    pattern: pattern.pattern,
    categoryId: target.categoryId,
    merchantId: target.merchantId,
    // Proposed, not adopted. It carries the lowest authority until confirmed,
    // so it can never quietly override a rule a person wrote.
    source: 'ai',
    confidence: 0.7,
    priority: 100,
    supportingCorrections: agreeing.length,
    explanation: byAccountant
      ? `Your accountant filed this the same way ${String(agreeing.length)} times. Make it a rule?`
      : `You filed this the same way ${String(agreeing.length)} times. Make it a rule?`,
  };
}

/**
 * Confirms a proposal into a rule the household owns.
 *
 * The source changes from `ai` to `user`, and the confidence to 1. That is not
 * cosmetic: it moves the rule above every inference in the authority ordering.
 */
export function confirmProposal(
  proposal: RuleProposal,
  confirmedBy: 'user' | 'accountant',
): Omit<MerchantRule, 'id'> {
  return {
    matchKind: proposal.matchKind,
    pattern: proposal.pattern,
    merchantId: proposal.merchantId,
    categoryId: proposal.categoryId,
    taxClassification: null,
    businessPercentage: null,
    source: confirmedBy,
    confidence: 1,
    priority: proposal.priority,
    isActive: true,
    effectiveFrom: null,
    effectiveTo: null,
  };
}

function takeLeadingAgreement(ordered: readonly Correction[], categoryId: string): Correction[] {
  const agreeing: Correction[] = [];
  for (const correction of ordered) {
    if (correction.categoryId !== categoryId) break;
    agreeing.push(correction);
  }
  return agreeing;
}

/**
 * Finds the narrowest pattern that covers every corrected description.
 *
 * Identical descriptions produce an exact match. Otherwise the shared meaningful
 * tokens do — `uber trip 8fk2` and `uber trip 91xx` become `tokens: "uber trip"`.
 * When nothing meaningful is shared, no rule is proposed; a pattern that matches
 * more than it should is worse than no pattern at all.
 */
function derivePattern(
  descriptions: readonly string[],
): { matchKind: MatchKind; pattern: string } | null {
  const first = descriptions[0];
  if (!first) return null;

  if (descriptions.every((description) => description === first)) {
    return { matchKind: 'equals', pattern: first };
  }

  let shared = meaningfulTokens(first);
  for (const description of descriptions.slice(1)) {
    const tokens = meaningfulTokens(description);
    shared = shared.filter((token) => tokens.includes(token));
    if (shared.length === 0) return null;
  }

  return { matchKind: 'tokens', pattern: shared.join(' ') };
}

function meaningfulTokens(value: string): string[] {
  return value.split(' ').filter((token) => token.length >= MEANINGFUL_TOKEN_LENGTH);
}
