import type { Money, PlainDate } from '@app/domain';

/**
 * Tax, treated as the highest-risk thing in this project.
 *
 * Everything in this package is built around one admission: a tax rule is a
 * fact about the world on a particular date, published by an authority, and it
 * changes. Encoding one as a constant in TypeScript makes it a fact about a
 * deployment instead — undated, unsourced, and wrong the moment the law moves.
 *
 * So a rule here is data, and it never travels without four things: **when it
 * applied**, **where it came from**, **which version it belongs to**, and
 * **whether a person has reviewed it**. A calculation records the rule set
 * version that produced it, so the figure a household saw in March can still be
 * explained in November after the rules have changed twice.
 *
 * The review status is not decoration. A rule set nobody has checked computes
 * fine and must not be presented as a tax figure, and `mayPresent` is the one
 * function that decides that.
 */

export type TaxType = 'income' | 'itbms' | 'social_security' | 'municipal';

/**
 * How a person earns, which decides almost everything else.
 *
 * The spec is emphatic: **ask, never assume**. Cash-basis availability, ITBMS
 * registration and filing deadlines all follow from this, and inferring it from
 * transaction patterns would put a household on the wrong return.
 */
export type TaxpayerStatus =
  | 'salaried'
  | 'independent_professional'
  | 'freelancer'
  | 'merchant'
  | 'mixed_income'
  | 'personal_business';

export type AccountingMethod = 'cash' | 'accrual';

/**
 * What an expense is, for tax.
 *
 * `REQUIRES_REVIEW` is a real answer and often the correct one. A system that
 * always picks a side produces a return nobody checked.
 */
export type ExpenseClassification =
  | 'PERSONAL'
  | 'BUSINESS'
  | 'MIXED'
  | 'NON_DEDUCTIBLE'
  | 'POTENTIALLY_DEDUCTIBLE'
  | 'REQUIRES_REVIEW';

/** Draft → Review → Approve → Publish. Nothing computes for a household from a draft. */
export type RuleSetStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'superseded';

/**
 * Where a rule came from, carried on the rule itself.
 *
 * Not metadata. A tax figure a household cannot trace to a published article is
 * an assertion, and this product does not make assertions about tax.
 */
export interface RuleProvenance {
  /** The authority. `Dirección General de Ingresos`. */
  readonly source: string;
  readonly sourceUrl: string | null;
  /** The article, resolution or form. `Código Fiscal, artículo 700`. */
  readonly sourceReference: string;
  readonly notes: string | null;
  /** Null means nobody has checked this against the primary source. */
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
}

/** A progressive bracket. `upTo` null is the top band. */
export interface TaxBracket {
  readonly from: Money;
  readonly upTo: Money | null;
  /** Percent with up to three decimals, as a string. `15.000`. */
  readonly rate: string;
}

/**
 * A deduction, with the cap that makes it real.
 *
 * Modelled as a shape rather than seeded with figures: a deduction whose cap
 * nobody verified is worse than no deduction at all, because it silently lowers
 * a reserve the household was relying on.
 */
export interface DeductionRule {
  readonly key: string;
  readonly label: string;
  /** The most that may be deducted, or null for uncapped. */
  readonly cap: Money | null;
  /** Percentage of the qualifying amount that is deductible. `100.000`. */
  readonly rate: string;
  readonly provenance: RuleProvenance;
}

export type TaxRule =
  | {
      readonly kind: 'brackets';
      readonly key: string;
      readonly taxType: TaxType;
      readonly brackets: readonly TaxBracket[];
      readonly provenance: RuleProvenance;
    }
  | {
      readonly kind: 'flat_rate';
      readonly key: string;
      readonly taxType: TaxType;
      readonly rate: string;
      readonly provenance: RuleProvenance;
    }
  | {
      readonly kind: 'threshold';
      readonly key: string;
      readonly taxType: TaxType;
      readonly amount: Money;
      readonly provenance: RuleProvenance;
    }
  | {
      readonly kind: 'deduction';
      readonly key: string;
      readonly taxType: TaxType;
      readonly deduction: DeductionRule;
      readonly provenance: RuleProvenance;
    }
  | {
      readonly kind: 'deadline';
      readonly key: string;
      readonly taxType: TaxType;
      /** `MM-DD`. The year comes from the fiscal year being filed. */
      readonly monthDay: string;
      readonly label: string;
      readonly provenance: RuleProvenance;
    };

export interface TaxRuleSet {
  readonly jurisdiction: string;
  readonly fiscalYear: number;
  /** Monotonic per jurisdiction and year. Recorded on every calculation. */
  readonly version: number;
  readonly status: RuleSetStatus;
  readonly effectiveFrom: PlainDate;
  readonly effectiveTo: PlainDate | null;
  readonly currency: Money['currency'];
  readonly rules: readonly TaxRule[];
}

export interface TaxpayerProfile {
  readonly jurisdiction: string;
  readonly status: TaxpayerStatus;
  /** Panama's taxpayer identifier. Null until the household supplies it. */
  readonly ruc: string | null;
  readonly activity: string | null;
  readonly accountingMethod: AccountingMethod;
  readonly itbmsRegistered: boolean;
  /** `MM-DD`. Most are calendar years; some are not, and assuming costs a filing. */
  readonly fiscalYearStart: string;
}

export interface TaxEstimateLine {
  readonly key: string;
  readonly label: string;
  readonly amount: Money;
  /** The rule that produced this line, so the figure can be traced. */
  readonly ruleKey: string | null;
}

/**
 * An estimate, and everything needed to judge how much to trust it.
 *
 * `presentable` is false whenever the rule set behind it has not been reviewed
 * and published. The product must not show a tax figure from an unreviewed set,
 * and this is where that decision is made rather than in a component.
 */
export interface TaxEstimate {
  readonly jurisdiction: string;
  readonly fiscalYear: number;
  readonly ruleSetVersion: number;
  readonly ruleSetStatus: RuleSetStatus;
  readonly presentable: boolean;
  readonly currency: Money['currency'];

  readonly grossIncome: Money;
  readonly deductions: Money;
  readonly taxableIncome: Money;
  readonly estimatedTax: Money;
  /** Effective rate over gross income, 0–1. Null when there was no income. */
  readonly effectiveRate: number | null;
  readonly lines: readonly TaxEstimateLine[];
}

export type TaxProblem =
  | { readonly kind: 'no_rule_set'; readonly jurisdiction: string; readonly on: PlainDate }
  | { readonly kind: 'missing_rule'; readonly ruleKey: string }
  | { readonly kind: 'currency_mismatch'; readonly expected: string; readonly received: string };
