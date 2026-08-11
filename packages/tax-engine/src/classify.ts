import type { ExpenseClassification, TaxpayerProfile } from './types.js';

/**
 * What an expense is, for tax — decided conservatively and reversibly.
 *
 * Three principles run through this, and each one is a decision to be less
 * clever than the code could be:
 *
 *   1. **The household's own answer wins.** A standing decision about a merchant
 *      or a category is not a hint to weigh against a heuristic; it is the
 *      answer. A system that overrules a person about their own business is one
 *      they stop correcting.
 *   2. **`REQUIRES_REVIEW` is a real outcome.** Guessing between personal and
 *      business produces a return nobody checked, and the wrong guess is a
 *      deduction claimed without a receipt.
 *   3. **Never `BUSINESS` on a heuristic alone.** The strongest thing inference
 *      produces here is `POTENTIALLY_DEDUCTIBLE`. Confirming it is a person's
 *      job, and a document is usually what makes it possible.
 *
 * The policy is data rather than a switch statement, because which categories
 * lean business is a fact about a jurisdiction and a trade, not about this
 * codebase.
 */

export interface CategoryPolicy {
  /** Category slugs that are personal for everyone. */
  readonly personal: readonly string[];
  /** Slugs whose business use is plausible and needs confirming. */
  readonly potentiallyBusiness: readonly string[];
  /** Slugs that are genuinely both, with a split the household must set. */
  readonly mixed: readonly string[];
  /** Slugs that are never deductible: fines, personal taxes, transfers. */
  readonly nonDeductible: readonly string[];
}

/**
 * The default policy over the seeded category tree.
 *
 * Deliberately small. Every slug added here is a claim about deductibility, and
 * an unreviewed claim in this list becomes a deduction on somebody's return.
 */
export const DEFAULT_CATEGORY_POLICY: CategoryPolicy = {
  personal: [
    'groceries',
    'dining',
    'entertainment',
    'shopping',
    'family',
    'personal',
    'healthcare',
    'housing-rent',
    'housing-mortgage',
    'housing-maintenance',
  ],
  potentiallyBusiness: [
    'business',
    'business-software',
    'business-services',
    'business-supplies',
    'education',
  ],
  mixed: ['housing-utilities', 'transportation', 'transportation-fuel', 'subscriptions', 'travel'],
  nonDeductible: ['transfers', 'transfers-card-payment', 'transfers-internal', 'debt', 'fees'],
};

export interface ClassificationInput {
  readonly taxpayer: TaxpayerProfile;
  readonly categorySlug: string | null;
  readonly merchantName: string | null;
  /** True when a receipt or invoice is attached. */
  readonly hasDocument: boolean;
  /**
   * The household's standing answer for this merchant or category. Set by them,
   * or by a rule they wrote. It is not overridden by anything below.
   */
  readonly override?: {
    readonly classification: ExpenseClassification;
    readonly businessPercentage: number;
  } | null;
  readonly policy?: CategoryPolicy;
}

export interface ClassificationResult {
  readonly classification: ExpenseClassification;
  /** 0–100. Meaningful only for `MIXED`. */
  readonly businessPercentage: number;
  /** A message key. This engine has no language, like every other one here. */
  readonly reasonKey: string;
  /** True when a person must decide before this figure is used on a return. */
  readonly needsPerson: boolean;
}

/** Salaried employment has no business-expense path. Saying so early avoids nonsense. */
const BUSINESS_STATUSES = new Set([
  'independent_professional',
  'freelancer',
  'merchant',
  'mixed_income',
  'personal_business',
]);

export function classifyExpense(input: ClassificationInput): ClassificationResult {
  if (input.override) {
    return {
      classification: input.override.classification,
      businessPercentage: input.override.businessPercentage,
      reasonKey: 'tax.reason.householdDecided',
      needsPerson: false,
    };
  }

  const policy = input.policy ?? DEFAULT_CATEGORY_POLICY;
  const slug = input.categorySlug;

  if (slug !== null && policy.nonDeductible.includes(slug)) {
    return personalResult('NON_DEDUCTIBLE', 'tax.reason.neverDeductible');
  }

  if (!BUSINESS_STATUSES.has(input.taxpayer.status)) {
    // A salaried taxpayer's expenses are personal. This is not a guess to be
    // improved later; it is what the status means.
    return personalResult('PERSONAL', 'tax.reason.salariedTaxpayer');
  }

  if (slug === null) {
    return {
      classification: 'REQUIRES_REVIEW',
      businessPercentage: 0,
      reasonKey: 'tax.reason.uncategorized',
      needsPerson: true,
    };
  }

  if (policy.personal.includes(slug)) {
    return personalResult('PERSONAL', 'tax.reason.personalCategory');
  }

  if (policy.mixed.includes(slug)) {
    // The split is the household's to set. Defaulting it would put a number on a
    // return that nobody chose.
    return {
      classification: 'MIXED',
      businessPercentage: 0,
      reasonKey: 'tax.reason.mixedUse',
      needsPerson: true,
    };
  }

  if (policy.potentiallyBusiness.includes(slug)) {
    return {
      classification: 'POTENTIALLY_DEDUCTIBLE',
      businessPercentage: 100,
      reasonKey: input.hasDocument
        ? 'tax.reason.businessWithDocument'
        : 'tax.reason.businessNoDocument',
      // Even with a document. Inference never reaches BUSINESS on its own.
      needsPerson: true,
    };
  }

  return {
    classification: 'REQUIRES_REVIEW',
    businessPercentage: 0,
    reasonKey: 'tax.reason.unknownCategory',
    needsPerson: true,
  };
}

function personalResult(
  classification: ExpenseClassification,
  reasonKey: string,
): ClassificationResult {
  return { classification, businessPercentage: 0, reasonKey, needsPerson: false };
}

/**
 * The deductible portion of an amount, given its classification.
 *
 * `POTENTIALLY_DEDUCTIBLE` contributes nothing until a person confirms it. That
 * is the conservative direction: a reserve that turns out to be too large is an
 * inconvenience, and one that turns out to be too small is a shortfall in April.
 */
export function deductiblePercentage(result: ClassificationResult): number {
  switch (result.classification) {
    case 'BUSINESS':
      return 100;
    case 'MIXED':
      return Math.max(0, Math.min(100, result.businessPercentage));
    case 'PERSONAL':
    case 'NON_DEDUCTIBLE':
    case 'POTENTIALLY_DEDUCTIBLE':
    case 'REQUIRES_REVIEW':
      return 0;
  }
}
