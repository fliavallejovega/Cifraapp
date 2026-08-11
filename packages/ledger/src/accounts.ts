import type { LedgerAccount } from './types.js';

/**
 * The chart of accounts.
 *
 * Small on purpose. A chart with sixty accounts nobody posts to is harder to
 * read than one with fifteen that are all used, and every account here exists
 * because something in this system posts to it.
 *
 * Codes follow the usual ranges — 1000s assets, 2000s liabilities, 3000s equity,
 * 4000s revenue, 5000s expense — so a person who has seen a ledger before can
 * find their way without a legend.
 */

function account(
  code: string,
  name: string,
  type: LedgerAccount['type'],
  normalBalance: LedgerAccount['normalBalance'],
  isContra = false,
): LedgerAccount {
  return { code, name, type, normalBalance, isContra };
}

export const CHART_OF_ACCOUNTS: readonly LedgerAccount[] = [
  account('1000', 'Cash', 'asset', 'debit'),
  // Money the processor has taken but not yet paid out. Treating a charge as
  // cash on the day it succeeds overstates the bank balance for two days and
  // makes every reconciliation fail.
  account('1100', 'Processor receivable', 'asset', 'debit'),
  account('1200', 'Accounts receivable', 'asset', 'debit'),

  // Revenue billed but not yet earned. A customer who pays for a year on the
  // first of January has not given the company a year of revenue in January;
  // recognizing it that way is the most common way a SaaS overstates itself.
  account('2000', 'Deferred revenue', 'liability', 'credit'),
  account('2100', 'Accounts payable', 'liability', 'credit'),
  account('2200', 'Taxes payable', 'liability', 'credit'),

  account('3000', 'Retained earnings', 'equity', 'credit'),

  account('4000', 'Subscription revenue', 'revenue', 'credit'),
  // A contra account, so gross revenue stays visible. Netting refunds into
  // revenue hides how much was refunded, which is the number that matters.
  account('4100', 'Refunds', 'revenue', 'debit', true),
  account('4200', 'Discounts', 'revenue', 'debit', true),

  account('5000', 'Payment processing fees', 'expense', 'debit'),
  account('5100', 'Infrastructure', 'expense', 'debit'),
  account('5200', 'Software and services', 'expense', 'debit'),
  account('5300', 'AI provider usage', 'expense', 'debit'),
  account('5900', 'Payroll', 'expense', 'debit'),
];

export const ACCOUNTS_BY_CODE: ReadonlyMap<string, LedgerAccount> = new Map(
  CHART_OF_ACCOUNTS.map((entry) => [entry.code, entry]),
);

export function findAccount(code: string): LedgerAccount | undefined {
  return ACCOUNTS_BY_CODE.get(code);
}

export const ACCOUNT_CODES = {
  cash: '1000',
  processorReceivable: '1100',
  accountsReceivable: '1200',
  deferredRevenue: '2000',
  subscriptionRevenue: '4000',
  refunds: '4100',
  discounts: '4200',
  processingFees: '5000',
  aiUsage: '5300',
} as const;
