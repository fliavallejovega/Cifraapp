import { resolveMerchant } from './merchants.js';
import { findMatchingRule } from './rules.js';
import type {
  ClassifiableTransaction,
  Classification,
  ClassificationContext,
  MerchantRule,
} from './types.js';

/**
 * The categorization ladder.
 *
 * Four rungs, tried in order, stopping at the first that resolves:
 *
 *   1. A rule the household (or its accountant) wrote.
 *   2. The merchant's own established category.
 *   3. A model's suggestion — capped, and never applied without review.
 *   4. Nothing, which routes to review.
 *
 * Rung 3 is deliberately last and deliberately weak. A model is good at reading
 * `ADOBE INC 800-833-6687` and saying "probably software"; it is not entitled to
 * overrule a person who already said "Adobe is always Business / Software"
 * (spec §26). The ordering here is what makes that true structurally rather than
 * by convention.
 *
 * The engine never calls a model. A suggestion is passed in if one was obtained,
 * and `shouldConsultAi` decides beforehand whether obtaining one is even
 * warranted — paying a provider to re-derive an answer a rule already gives is
 * both wasteful and slower than the deterministic path (spec §102).
 */

/** At or above this, a classification is applied. Below it, a human confirms. */
export const AUTO_APPLY_THRESHOLD = 0.8;

/**
 * A model's confidence, however high it reports, is capped here. Nothing
 * inferred reaches the certainty of something stated.
 */
export const AI_CONFIDENCE_CEILING = 0.85;

/**
 * Whether consulting a model is worth doing for this transaction.
 *
 * Returns false whenever a deterministic path already resolves it. This is the
 * cost control and the correctness control at once: an AI call that changes
 * nothing still costs money, still adds latency, and still introduces a chance
 * of disagreeing with a rule the user wrote.
 */
export function shouldConsultAi(
  transaction: ClassifiableTransaction,
  context: Omit<ClassificationContext, 'aiSuggestion'>,
): boolean {
  const on = context.on ?? transaction.transactionDate;

  if (findMatchingRule(transaction.descriptionNormalized, context.rules, on)) return false;

  const match = resolveMerchant(transaction.descriptionNormalized, context.merchants);
  if (match?.merchant.defaultCategoryId) return false;

  return true;
}

export function classify(
  transaction: ClassifiableTransaction,
  context: ClassificationContext,
): Classification {
  const on = context.on ?? transaction.transactionDate;

  const rule = findMatchingRule(transaction.descriptionNormalized, context.rules, on);
  if (rule) {
    return fromRule(rule, transaction);
  }

  const match = resolveMerchant(transaction.descriptionNormalized, context.merchants);
  if (match?.merchant.defaultCategoryId) {
    // The merchant is known and has settled into a category. Confidence is the
    // merchant match's own, not an assertion — a fuzzy merchant match yielding a
    // confident category would launder uncertainty into certainty.
    const confidence = match.confidence;
    return {
      categoryId: match.merchant.defaultCategoryId,
      merchantId: match.merchant.id,
      taxClassification: null,
      businessPercentage: null,
      source: 'system',
      confidence,
      needsReview: confidence < AUTO_APPLY_THRESHOLD,
      appliedRuleId: null,
      explanation: `We matched this to ${match.merchant.name}, which you usually file the same way.`,
    };
  }

  if (context.aiSuggestion) {
    const confidence = Math.min(context.aiSuggestion.confidence, AI_CONFIDENCE_CEILING);
    return {
      categoryId: context.aiSuggestion.categoryId,
      merchantId: context.aiSuggestion.merchantId ?? match?.merchant.id ?? null,
      taxClassification: null,
      businessPercentage: null,
      source: 'ai',
      confidence,
      // A suggestion is always a proposal. Even at the ceiling it is below the
      // auto-apply threshold only by design — see AI_CONFIDENCE_CEILING.
      needsReview: true,
      appliedRuleId: null,
      explanation: 'We suggested a category from the description. Confirm it to make it stick.',
    };
  }

  return {
    categoryId: null,
    merchantId: match?.merchant.id ?? null,
    taxClassification: null,
    businessPercentage: null,
    source: 'system',
    confidence: 0,
    needsReview: true,
    appliedRuleId: null,
    explanation: 'We could not tell what this is. Categorize it once and we will remember.',
  };
}

function fromRule(rule: MerchantRule, transaction: ClassifiableTransaction): Classification {
  // `mixed` without a business percentage is not a classification, it is a
  // question. The database refuses the pair outright; the engine refuses it here
  // so the row reaches review rather than a constraint violation at insert.
  const taxIsUsable = rule.taxClassification !== 'mixed' || Boolean(rule.businessPercentage);

  return {
    categoryId: rule.categoryId ?? null,
    merchantId: rule.merchantId ?? transaction.merchantId ?? null,
    taxClassification: taxIsUsable ? (rule.taxClassification ?? null) : null,
    businessPercentage: taxIsUsable ? (rule.businessPercentage ?? null) : null,
    source: rule.source,
    confidence: rule.confidence,
    needsReview: rule.confidence < AUTO_APPLY_THRESHOLD || !taxIsUsable,
    appliedRuleId: rule.id,
    explanation: explainRule(rule),
  };
}

function explainRule(rule: MerchantRule): string {
  const clause = describePattern(rule);
  switch (rule.source) {
    case 'user':
      return `Your rule: ${clause}.`;
    case 'accountant':
      return `Your accountant's rule: ${clause}.`;
    case 'tax_rule':
      return `A tax rule applies: ${clause}.`;
    case 'ai':
      return `A suggested rule you have not confirmed: ${clause}.`;
    case 'rule':
    case 'system':
      return `A built-in rule: ${clause}.`;
  }
}

function describePattern(rule: MerchantRule): string {
  switch (rule.matchKind) {
    case 'equals':
      return `the description is exactly "${rule.pattern}"`;
    case 'starts_with':
      return `the description starts with "${rule.pattern}"`;
    case 'contains':
      return `the description contains "${rule.pattern}"`;
    case 'tokens':
      return `the description mentions "${rule.pattern}"`;
  }
}
