import { type Money, type CurrencyCode, type PlainDate, type Result } from '@app/domain';

import { ACCOUNT_CODES } from './accounts.js';
import { buildEntry, type DraftLine } from './journal.js';
import type { JournalEntry, LedgerProblem } from './types.js';

/**
 * What each business event does to the books.
 *
 * These are the postings from the specification, written once so that the
 * company's accounting is decided here rather than at eleven call sites:
 *
 *   Customer pays $20   Dr Cash $20              Cr Subscription revenue $20
 *   Refund $20          Dr Refunds (contra) $20  Cr Cash $20
 *   Processor fee       Dr Processing fees       Cr Cash / Processor receivable
 *
 * The refund posts to a contra account rather than reducing revenue directly.
 * Netting it away hides how much was refunded, and that figure is the one a
 * board asks about.
 */

export interface PaymentPosting {
  readonly id: string;
  readonly occurredOn: PlainDate;
  readonly currency: CurrencyCode;
  /** What the customer paid, gross. */
  readonly gross: Money;
  /** What the processor kept. Zero when it is billed separately. */
  readonly processorFee: Money;
  /** True while the money sits with the processor rather than in the bank. */
  readonly heldByProcessor: boolean;
  readonly sourceRef: string | null;
  readonly description: string;
}

/**
 * A successful subscription payment.
 *
 * Three lines when there is a fee, because the customer paid the gross amount
 * and the company received the net. Posting only the net loses the fee entirely,
 * and payment processing is one of the larger line items a SaaS has.
 */
export function postPayment(input: PaymentPosting): Result<JournalEntry, LedgerProblem> {
  const net = input.gross.subtract(input.processorFee);
  const cashAccount = input.heldByProcessor
    ? ACCOUNT_CODES.processorReceivable
    : ACCOUNT_CODES.cash;

  const lines: DraftLine[] = [
    { accountCode: cashAccount, side: 'debit', amount: net, memo: 'Net received' },
  ];

  if (input.processorFee.isPositive()) {
    lines.push({
      accountCode: ACCOUNT_CODES.processingFees,
      side: 'debit',
      amount: input.processorFee,
      memo: 'Processor fee',
    });
  }

  lines.push({
    accountCode: ACCOUNT_CODES.subscriptionRevenue,
    side: 'credit',
    amount: input.gross,
    memo: 'Subscription',
  });

  return buildEntry({
    id: input.id,
    occurredOn: input.occurredOn,
    description: input.description,
    sourceKind: 'payment',
    sourceRef: input.sourceRef,
    currency: input.currency,
    lines,
  });
}

export function postRefund(input: {
  id: string;
  occurredOn: PlainDate;
  currency: CurrencyCode;
  amount: Money;
  sourceRef: string | null;
  description: string;
}): Result<JournalEntry, LedgerProblem> {
  return buildEntry({
    id: input.id,
    occurredOn: input.occurredOn,
    description: input.description,
    sourceKind: 'refund',
    sourceRef: input.sourceRef,
    currency: input.currency,
    lines: [
      // Contra revenue, not a reduction of revenue. Gross revenue and the amount
      // refunded are two facts and the business needs both.
      { accountCode: ACCOUNT_CODES.refunds, side: 'debit', amount: input.amount, memo: 'Refund' },
      {
        accountCode: ACCOUNT_CODES.cash,
        side: 'credit',
        amount: input.amount,
        memo: 'Refund paid',
      },
    ],
  });
}

/**
 * An annual plan billed up front.
 *
 * The cash arrives now; the revenue does not. It sits in deferred revenue and is
 * recognized a month at a time. A company that books the full year in January
 * has told itself a story it will have to unwind in February.
 */
export function postDeferredBilling(input: {
  id: string;
  occurredOn: PlainDate;
  currency: CurrencyCode;
  amount: Money;
  sourceRef: string | null;
  description: string;
}): Result<JournalEntry, LedgerProblem> {
  return buildEntry({
    id: input.id,
    occurredOn: input.occurredOn,
    description: input.description,
    sourceKind: 'deferred_billing',
    sourceRef: input.sourceRef,
    currency: input.currency,
    lines: [
      { accountCode: ACCOUNT_CODES.cash, side: 'debit', amount: input.amount, memo: 'Billed' },
      {
        accountCode: ACCOUNT_CODES.deferredRevenue,
        side: 'credit',
        amount: input.amount,
        memo: 'Unearned',
      },
    ],
  });
}

/** One month of an annual plan becoming revenue. */
export function postRevenueRecognition(input: {
  id: string;
  occurredOn: PlainDate;
  currency: CurrencyCode;
  amount: Money;
  sourceRef: string | null;
  description: string;
}): Result<JournalEntry, LedgerProblem> {
  return buildEntry({
    id: input.id,
    occurredOn: input.occurredOn,
    description: input.description,
    sourceKind: 'revenue_recognition',
    sourceRef: input.sourceRef,
    currency: input.currency,
    lines: [
      {
        accountCode: ACCOUNT_CODES.deferredRevenue,
        side: 'debit',
        amount: input.amount,
        memo: 'Earned this period',
      },
      {
        accountCode: ACCOUNT_CODES.subscriptionRevenue,
        side: 'credit',
        amount: input.amount,
        memo: 'Recognized',
      },
    ],
  });
}

/** The processor paying out what it was holding. */
export function postPayout(input: {
  id: string;
  occurredOn: PlainDate;
  currency: CurrencyCode;
  amount: Money;
  sourceRef: string | null;
}): Result<JournalEntry, LedgerProblem> {
  return buildEntry({
    id: input.id,
    occurredOn: input.occurredOn,
    description: 'Processor payout',
    sourceKind: 'payout',
    sourceRef: input.sourceRef,
    currency: input.currency,
    lines: [
      { accountCode: ACCOUNT_CODES.cash, side: 'debit', amount: input.amount, memo: 'Payout' },
      {
        accountCode: ACCOUNT_CODES.processorReceivable,
        side: 'credit',
        amount: input.amount,
        memo: 'Settled',
      },
    ],
  });
}

/** Vendor spend, including what the AI copilot costs to run. */
export function postExpense(input: {
  id: string;
  occurredOn: PlainDate;
  currency: CurrencyCode;
  amount: Money;
  accountCode: string;
  sourceKind: string;
  sourceRef: string | null;
  description: string;
}): Result<JournalEntry, LedgerProblem> {
  return buildEntry({
    id: input.id,
    occurredOn: input.occurredOn,
    description: input.description,
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    currency: input.currency,
    lines: [
      { accountCode: input.accountCode, side: 'debit', amount: input.amount, memo: null },
      { accountCode: ACCOUNT_CODES.cash, side: 'credit', amount: input.amount, memo: null },
    ],
  });
}
