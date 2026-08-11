import type { CurrencyCode, Money, PlainDate } from '@app/domain';

/**
 * Financial statements, built from rows and nothing else.
 *
 * The rule the spec states plainly: **generated from transaction queries, never
 * from AI summaries.** A model may describe a statement after it exists. It may
 * not produce one, and nothing in this package can call one.
 *
 * The shapes below take arrays and return figures. There is no database here, no
 * clock, and no locale — which is what lets the same statement be recomputed
 * years later from archived rows and come out identical. A report that cannot be
 * reproduced is not a report.
 */

/** A transaction as reporting sees it. Signed: negative is money leaving. */
export interface TransactionRow {
  readonly id: string;
  readonly date: PlainDate;
  readonly amount: Money;
  readonly accountId: string;
  readonly categorySlug: string | null;
  readonly categoryLabel: string | null;
  /**
   * The single most consequential field here.
   *
   * A credit card payment moves money between two accounts the household owns.
   * Counting it as spending double-counts every purchase already on the card and
   * makes a disciplined month look catastrophic. Transfers are excluded from
   * income and expense everywhere in this package.
   */
  readonly isTransfer: boolean;
  readonly merchant: string | null;
  /** Set by the tax layer once a person has confirmed it. Never inferred here. */
  readonly deductibleAmount: Money | null;
}

export interface AccountRow {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly balance: Money;
  /** Liability accounts carry what is owed, and subtract from net worth. */
  readonly isLiability: boolean;
}

export interface DebtRow {
  readonly id: string;
  readonly name: string;
  readonly balance: Money;
  readonly apr: string;
  readonly minimumPayment: Money;
}

export interface ReportPeriod {
  readonly start: PlainDate;
  readonly end: PlainDate;
}

export interface StatementLine {
  readonly key: string;
  readonly label: string;
  readonly amount: Money;
  /** How many rows produced this line, so a surprising figure can be opened. */
  readonly count: number;
}

export interface NetWorthStatement {
  readonly currency: CurrencyCode;
  readonly on: PlainDate;
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
  readonly assetLines: readonly StatementLine[];
  readonly liabilityLines: readonly StatementLine[];
}

export interface IncomeStatement {
  readonly currency: CurrencyCode;
  readonly period: ReportPeriod;
  readonly income: Money;
  readonly expenses: Money;
  readonly net: Money;
  readonly incomeLines: readonly StatementLine[];
  readonly expenseLines: readonly StatementLine[];
  /** Rows left out because they move money the household already had. */
  readonly transfersExcluded: number;
}

export interface CashFlowStatement {
  readonly currency: CurrencyCode;
  readonly period: ReportPeriod;
  readonly opening: Money;
  readonly inflows: Money;
  readonly outflows: Money;
  /** Transfers between the household's own accounts, reported and not netted. */
  readonly internalMovement: Money;
  readonly closing: Money;
  readonly net: Money;
}

/**
 * The accounting view an independent professional needs.
 *
 * Cash basis: a figure lands in the period the money moved. Accrual would need
 * invoice dates the product does not yet collect, so the shape allows for it and
 * the builder states which basis it used rather than leaving it ambiguous.
 */
export interface OperatingStatement {
  readonly currency: CurrencyCode;
  readonly period: ReportPeriod;
  readonly basis: 'cash' | 'accrual';
  readonly revenue: Money;
  readonly costOfSales: Money;
  readonly grossProfit: Money;
  readonly operatingExpenses: Money;
  readonly operatingIncome: Money;
  /** Confirmed deductible amounts only. Nothing inferred reaches this figure. */
  readonly deductibleExpenses: Money;
}

/**
 * A bank statement against the system's own figure.
 *
 * The product never silently adjusts a balance to make these agree. It reports
 * the difference and what could explain it, because the difference is usually a
 * missing transaction — and writing a plug entry loses the very thing that would
 * have found it.
 */
export interface Reconciliation {
  readonly currency: CurrencyCode;
  readonly accountId: string;
  readonly statementBalance: Money;
  readonly systemBalance: Money;
  readonly difference: Money;
  readonly isReconciled: boolean;
  readonly candidates: readonly ReconciliationCandidate[];
}

export interface ReconciliationCandidate {
  /** A message key. This package has no language. */
  readonly key: string;
  readonly transactionIds: readonly string[];
  readonly amount: Money;
}

/** The monthly close, in the order the spec sets out. */
export type CloseStep =
  | 'uncategorized'
  | 'duplicates'
  | 'transfers'
  | 'reconciliation'
  | 'recurring_changes'
  | 'tax_classification';

export interface CloseChecklist {
  readonly period: ReportPeriod;
  readonly steps: readonly CloseStepState[];
  readonly blocking: number;
  readonly mayClose: boolean;
}

export interface CloseStepState {
  readonly step: CloseStep;
  readonly outstanding: number;
  /** False for steps a household may knowingly close over. */
  readonly blocks: boolean;
}

/**
 * The financial health score.
 *
 * Transparent by construction: the score is the weighted sum of components that
 * are each shown with their own figure, so "why 82?" has an answer rather than a
 * reassurance. **Never presented as a credit score** — it measures nothing a
 * lender uses and implying otherwise would be a lie with consequences.
 */
export interface HealthComponent {
  readonly key: string;
  /** 0–100. */
  readonly score: number;
  readonly weight: number;
  /** The figure behind the score, for the explanation to show. */
  readonly detail: string;
}

export interface HealthScore {
  readonly score: number;
  readonly components: readonly HealthComponent[];
  /** True when a component had no data and was left out of the weighting. */
  readonly isPartial: boolean;
}
