import type { Money, PlainDate } from '@app/domain';

/**
 * Where a classification came from.
 *
 * These are the values of the `app.provenance` enum, not a parallel vocabulary.
 * Every classification the system stores carries one, because a category with no
 * provenance cannot be explained, and a category that cannot be explained cannot
 * be trusted or corrected.
 */
export type ClassificationSource = 'system' | 'user' | 'ai' | 'accountant' | 'rule' | 'tax_rule';

/**
 * How much authority a source carries when two of them disagree.
 *
 * The ordering is the product's promise made numeric: a person who told the
 * system something outranks a model that inferred it, always and without
 * exception (spec §26). An accountant outranks the household because the
 * household hired them for exactly that judgement; a tax rule outranks the
 * system's own defaults because it is sourced law rather than a heuristic.
 */
const SOURCE_AUTHORITY: Record<ClassificationSource, number> = {
  accountant: 5,
  user: 4,
  tax_rule: 3,
  rule: 2,
  system: 1,
  ai: 0,
};

export function sourceAuthority(source: ClassificationSource): number {
  return SOURCE_AUTHORITY[source];
}

/**
 * How a rule's pattern is compared against a normalized description.
 *
 * Deliberately not a regular expression. A user-authored regex is arbitrary
 * computation running on the server against every row of an import — a
 * catastrophic-backtracking pattern is a denial of service written by a customer
 * who was only trying to categorize their groceries. These four kinds cover the
 * cases people actually express and each one runs in linear time.
 */
export type MatchKind = 'equals' | 'starts_with' | 'contains' | 'tokens';

export interface MerchantRule {
  readonly id: string;
  readonly matchKind: MatchKind;
  /** Compared against `descriptionNormalized`; stored already normalized. */
  readonly pattern: string;
  readonly merchantId?: string | null;
  readonly categoryId?: string | null;
  readonly taxClassification?: TaxClassification | null;
  /** Whole percent, `'40.00'` for 40%. Required when the classification is mixed. */
  readonly businessPercentage?: string | null;
  readonly source: ClassificationSource;
  /** 0–1. A user rule is normally 1: they are not guessing. */
  readonly confidence: number;
  /** Lower runs first within the same source authority. */
  readonly priority: number;
  readonly isActive: boolean;
  /** Rules may expire — a promotional categorization, a temporary project code. */
  readonly effectiveFrom?: PlainDate | null;
  readonly effectiveTo?: PlainDate | null;
}

export type TaxClassification =
  | 'personal'
  | 'business'
  | 'mixed'
  | 'non_deductible'
  | 'potentially_deductible'
  | 'requires_review';

/** A merchant the household already knows, with the aliases it answers to. */
export interface MerchantRecord {
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly aliases: readonly string[];
  /** The category this merchant's transactions have historically been given. */
  readonly defaultCategoryId?: string | null;
}

/** The transaction being classified, as the engine needs to see it. */
export interface ClassifiableTransaction {
  readonly id?: string;
  readonly descriptionNormalized: string;
  readonly amount: Money;
  readonly direction: 'inflow' | 'outflow';
  readonly transactionDate: PlainDate;
  readonly merchantId?: string | null;
}

/**
 * A category the model proposed. Carried into the engine rather than called from
 * inside it: the engine is deterministic and synchronous, and whether the AI was
 * consulted at all is a decision made before entering it (spec §100).
 */
export interface AiSuggestion {
  readonly categoryId: string;
  readonly merchantId?: string | null;
  readonly confidence: number;
  readonly promptVersion: string;
}

export interface ClassificationContext {
  readonly rules: readonly MerchantRule[];
  readonly merchants: readonly MerchantRecord[];
  /** Consulted only when every deterministic path came up empty. */
  readonly aiSuggestion?: AiSuggestion;
  /** Used to evaluate rule validity windows. Defaults to the transaction date. */
  readonly on?: PlainDate;
}

export interface Classification {
  readonly categoryId: string | null;
  readonly merchantId: string | null;
  readonly taxClassification: TaxClassification | null;
  readonly businessPercentage: string | null;
  readonly source: ClassificationSource;
  readonly confidence: number;
  /** True when the result is a proposal, not a decision. */
  readonly needsReview: boolean;
  readonly appliedRuleId: string | null;
  /** In the product's register: "We noticed…", never "AI detected…". */
  readonly explanation: string;
}

/** One recorded change of a transaction's classification. */
export interface ClassificationLogEntry {
  readonly transactionId: string;
  readonly previousCategoryId: string | null;
  readonly categoryId: string | null;
  readonly previousSource: ClassificationSource | null;
  readonly source: ClassificationSource;
  readonly confidence: number;
  readonly appliedRuleId: string | null;
  readonly actorId: string | null;
  readonly reason: string;
}
