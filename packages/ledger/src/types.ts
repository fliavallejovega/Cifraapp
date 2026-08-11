import type { CurrencyCode, Money, PlainDate } from '@app/domain';

/**
 * The company's own books — real double-entry, not a `balance` column.
 *
 * This is the SaaS company's accounting, and it lives in `platform`. It never
 * touches a household's money: a customer's subscription payment is two separate
 * records in two domains — a transaction in their household and a revenue event
 * here — linked explicitly and never sharing a row.
 *
 * The invariant is the whole point. **Every entry balances: debits equal
 * credits.** Not by convention, not by a helper everyone remembers to call — by
 * a deferred constraint trigger in the database, so an entry that does not
 * balance cannot be committed by any code path, including a migration or a
 * future job written by someone who has never read this file.
 *
 * A `balance` column that everything increments is the shortcut this exists to
 * refuse. It cannot be audited, it drifts, and the drift is discovered by an
 * accountant a year later with no way to find where it started.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

/**
 * Which side increases an account.
 *
 * Assets and expenses grow on the debit side; liabilities, equity and revenue
 * grow on the credit side. Contra accounts — a refund against revenue — are
 * ordinary accounts of their type with the opposite normal balance, which is why
 * this is a field rather than a function of the type.
 */
export type NormalBalance = 'debit' | 'credit';

export type Side = 'debit' | 'credit';

export interface LedgerAccount {
  /** Stable and human-sortable: `1000` cash, `4000` revenue. */
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly normalBalance: NormalBalance;
  /** True for a contra account — accumulated refunds, discounts. */
  readonly isContra: boolean;
}

export interface JournalLine {
  readonly accountCode: string;
  readonly side: Side;
  /** Always positive. The side carries the direction; a signed amount would let it be carried twice. */
  readonly amount: Money;
  readonly memo: string | null;
}

export interface JournalEntry {
  readonly id: string;
  readonly occurredOn: PlainDate;
  readonly description: string;
  /** What caused this: a subscription id, an invoice reference, a payout. */
  readonly sourceKind: string;
  readonly sourceRef: string | null;
  readonly currency: CurrencyCode;
  readonly lines: readonly JournalLine[];
}

export type LedgerProblem =
  | { readonly kind: 'unbalanced'; readonly debits: Money; readonly credits: Money }
  | { readonly kind: 'no_lines' }
  | { readonly kind: 'non_positive_line'; readonly accountCode: string }
  | { readonly kind: 'unknown_account'; readonly accountCode: string }
  | { readonly kind: 'currency_mismatch'; readonly expected: string; readonly received: string };

/** An account's position at a point in time, in the direction it normally moves. */
export interface AccountBalance {
  readonly accountCode: string;
  readonly debits: Money;
  readonly credits: Money;
  /** Positive when the account sits on its normal side. */
  readonly balance: Money;
}

/**
 * SaaS metrics that must reconcile against the ledger.
 *
 * MRR computed from subscriptions and revenue recognized in the ledger are two
 * views of the same business. When they disagree, one of them is wrong, and the
 * useful property of computing both is that the disagreement is visible.
 */
export interface MrrSnapshot {
  readonly on: PlainDate;
  readonly currency: CurrencyCode;
  /** Monthly recurring revenue, normalized: an annual plan contributes a twelfth. */
  readonly mrr: Money;
  readonly arr: Money;
  readonly customers: number;
  readonly arpu: Money;
}

export interface MrrMovement {
  readonly currency: CurrencyCode;
  readonly opening: Money;
  readonly newMrr: Money;
  readonly expansion: Money;
  readonly contraction: Money;
  readonly churned: Money;
  readonly closing: Money;
  /** Customers who left, not revenue. The two churn rates say different things. */
  readonly logoChurn: number;
  /** Net revenue retention across customers present at the start, as a ratio. */
  readonly netRetention: number | null;
  /** Gross retention: expansion excluded, so it can never exceed 1. */
  readonly grossRetention: number | null;
}

/** One customer's recurring revenue at a point in time. */
export interface CustomerMrr {
  readonly customerId: string;
  readonly mrr: Money;
}
