import { Money, type PlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { ACCOUNT_CODES, CHART_OF_ACCOUNTS, findAccount } from './accounts.js';
import { balances, buildEntry, trialBalance } from './journal.js';
import { lifetimeValue, logoChurnRate, monthlyEquivalent, movement, snapshot } from './metrics.js';
import { postExpense, postPayment, postRefund, postRevenueRecognition } from './postings.js';
import type { CustomerMrr, JournalEntry } from './types.js';

const usd = (value: string) => Money.fromDecimalString(value, 'USD');
const ON = '2026-08-11' as PlainDate;

describe('chart of accounts', () => {
  it('gives every account a normal side', () => {
    for (const account of CHART_OF_ACCOUNTS) {
      expect(['debit', 'credit']).toContain(account.normalBalance);
    }
  });

  it('keeps refunds as contra revenue rather than an expense', () => {
    const refunds = findAccount(ACCOUNT_CODES.refunds);

    // Netting refunds into revenue hides how much was refunded, which is the
    // number a board asks about.
    expect(refunds?.type).toBe('revenue');
    expect(refunds?.isContra).toBe(true);
    expect(refunds?.normalBalance).toBe('debit');
  });
});

describe('entries', () => {
  it('refuses an entry that does not balance', () => {
    const result = buildEntry({
      id: 'e1',
      occurredOn: ON,
      description: 'Wrong',
      sourceKind: 'test',
      currency: 'USD',
      lines: [
        { accountCode: ACCOUNT_CODES.cash, side: 'debit', amount: usd('20.00') },
        { accountCode: ACCOUNT_CODES.subscriptionRevenue, side: 'credit', amount: usd('19.00') },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'unbalanced') {
      expect(result.error.debits.toDecimalString()).toBe('20.0000');
      expect(result.error.credits.toDecimalString()).toBe('19.0000');
    }
  });

  it('refuses a negative amount rather than flipping the side for you', () => {
    const result = buildEntry({
      id: 'e2',
      occurredOn: ON,
      description: 'Wrong',
      sourceKind: 'test',
      currency: 'USD',
      lines: [
        { accountCode: ACCOUNT_CODES.cash, side: 'debit', amount: usd('-20.00') },
        { accountCode: ACCOUNT_CODES.subscriptionRevenue, side: 'credit', amount: usd('-20.00') },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('non_positive_line');
  });

  it('refuses an account that is not in the chart', () => {
    const result = buildEntry({
      id: 'e3',
      occurredOn: ON,
      description: 'Wrong',
      sourceKind: 'test',
      currency: 'USD',
      lines: [
        { accountCode: '9999', side: 'debit', amount: usd('1.00') },
        { accountCode: ACCOUNT_CODES.cash, side: 'credit', amount: usd('1.00') },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('unknown_account');
  });

  it('refuses an entry with no lines', () => {
    const result = buildEntry({
      id: 'e4',
      occurredOn: ON,
      description: 'Empty',
      sourceKind: 'test',
      currency: 'USD',
      lines: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('no_lines');
  });
});

describe('postings', () => {
  it('books a payment gross, with the fee as its own expense', () => {
    const result = postPayment({
      id: 'p1',
      occurredOn: ON,
      currency: 'USD',
      gross: usd('29.99'),
      processorFee: usd('1.17'),
      heldByProcessor: true,
      sourceRef: 'in_1',
      description: 'Pro subscription',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Posting only the net would lose the fee entirely, and processing is one of
    // the larger line items a SaaS carries.
    const revenue = result.value.lines.find(
      (line) => line.accountCode === ACCOUNT_CODES.subscriptionRevenue,
    );
    const fee = result.value.lines.find(
      (line) => line.accountCode === ACCOUNT_CODES.processingFees,
    );
    const received = result.value.lines.find(
      (line) => line.accountCode === ACCOUNT_CODES.processorReceivable,
    );

    expect(revenue?.amount.toDecimalString()).toBe('29.9900');
    expect(fee?.amount.toDecimalString()).toBe('1.1700');
    expect(received?.amount.toDecimalString()).toBe('28.8200');
  });

  it('sends money to cash when the processor is not holding it', () => {
    const result = postPayment({
      id: 'p2',
      occurredOn: ON,
      currency: 'USD',
      gross: usd('20.00'),
      processorFee: usd('0'),
      heldByProcessor: false,
      sourceRef: null,
      description: 'Payment',
    });

    if (!result.ok) return;
    expect(result.value.lines).toHaveLength(2);
    expect(result.value.lines[0]?.accountCode).toBe(ACCOUNT_CODES.cash);
  });

  it('books a refund against contra revenue, not against revenue', () => {
    const result = postRefund({
      id: 'r1',
      occurredOn: ON,
      currency: 'USD',
      amount: usd('20.00'),
      sourceRef: null,
      description: 'Refund',
    });

    if (!result.ok) return;
    expect(result.value.lines[0]?.accountCode).toBe(ACCOUNT_CODES.refunds);
    expect(result.value.lines[0]?.side).toBe('debit');
  });

  it('recognizes deferred revenue a month at a time', () => {
    const result = postRevenueRecognition({
      id: 'rr1',
      occurredOn: ON,
      currency: 'USD',
      amount: usd('9.99'),
      sourceRef: null,
      description: 'August',
    });

    if (!result.ok) return;
    expect(result.value.lines[0]?.accountCode).toBe(ACCOUNT_CODES.deferredRevenue);
    expect(result.value.lines[0]?.side).toBe('debit');
  });

  it('books what the copilot costs to run', () => {
    const result = postExpense({
      id: 'x1',
      occurredOn: ON,
      currency: 'USD',
      amount: usd('42.31'),
      accountCode: ACCOUNT_CODES.aiUsage,
      sourceKind: 'ai_usage',
      sourceRef: '2026-08',
      description: 'AI provider usage',
    });

    expect(result.ok).toBe(true);
  });
});

describe('balances', () => {
  const entries: JournalEntry[] = [];

  const payment = postPayment({
    id: 'p1',
    occurredOn: ON,
    currency: 'USD',
    gross: usd('29.99'),
    processorFee: usd('1.17'),
    heldByProcessor: false,
    sourceRef: null,
    description: 'Payment',
  });
  if (payment.ok) entries.push(payment.value);

  const refund = postRefund({
    id: 'r1',
    occurredOn: ON,
    currency: 'USD',
    amount: usd('10.00'),
    sourceRef: null,
    description: 'Refund',
  });
  if (refund.ok) entries.push(refund.value);

  it('ties out', () => {
    const trial = trialBalance(entries, 'USD');

    // If this ever fails, nothing built on the ledger means anything.
    expect(trial.isBalanced).toBe(true);
    expect(trial.debits.toDecimalString()).toBe(trial.credits.toDecimalString());
  });

  it('reports each account on the side it normally moves', () => {
    const result = balances(entries, 'USD');

    const revenue = result.find((row) => row.accountCode === ACCOUNT_CODES.subscriptionRevenue);
    const refunds = result.find((row) => row.accountCode === ACCOUNT_CODES.refunds);
    const cash = result.find((row) => row.accountCode === ACCOUNT_CODES.cash);

    expect(revenue?.balance.toDecimalString()).toBe('29.9900');
    expect(refunds?.balance.toDecimalString()).toBe('10.0000');
    // 28.82 received, less the 10.00 refunded.
    expect(cash?.balance.toDecimalString()).toBe('18.8200');
  });
});

describe('metrics', () => {
  const previous: CustomerMrr[] = [
    { customerId: 'a', mrr: usd('9.99') },
    { customerId: 'b', mrr: usd('29.99') },
    { customerId: 'c', mrr: usd('17.99') },
  ];

  const current: CustomerMrr[] = [
    // a upgraded, b unchanged, c left, d is new.
    { customerId: 'a', mrr: usd('29.99') },
    { customerId: 'b', mrr: usd('29.99') },
    { customerId: 'd', mrr: usd('9.99') },
  ];

  it('normalizes an annual plan to a month', () => {
    expect(monthlyEquivalent(usd('120.00'), 'year').toDecimalString()).toBe('10.0000');
    expect(monthlyEquivalent(usd('9.99'), 'month').toDecimalString()).toBe('9.9900');
  });

  it('summarizes a point in time', () => {
    const result = snapshot(previous, ON, 'USD');

    expect(result.mrr.toDecimalString()).toBe('57.9700');
    expect(result.arr.toDecimalString()).toBe('695.6400');
    expect(result.customers).toBe(3);
  });

  it('decomposes the move so the parts add up to the whole', () => {
    const result = movement(previous, current, 'USD');

    expect(result.opening.toDecimalString()).toBe('57.9700');
    expect(result.newMrr.toDecimalString()).toBe('9.9900');
    expect(result.expansion.toDecimalString()).toBe('20.0000');
    expect(result.contraction.isZero()).toBe(true);
    expect(result.churned.toDecimalString()).toBe('17.9900');
    expect(result.logoChurn).toBe(1);

    // A decomposition that does not tie out invites the reader to trust a
    // breakdown quietly missing a customer.
    const reconstructed = result.opening
      .add(result.newMrr)
      .add(result.expansion)
      .subtract(result.contraction)
      .subtract(result.churned);

    expect(reconstructed.equals(result.closing)).toBe(true);
  });

  it('counts retention only among customers who were already there', () => {
    const result = movement(previous, current, 'USD');

    // 59.98 retained from an opening 57.97 — expansion outran churn.
    expect(result.netRetention).toBeCloseTo(1.0347, 3);
    // Gross excludes expansion, so it can never exceed one.
    expect(result.grossRetention).toBeLessThanOrEqual(1);
  });

  it('records a contraction as a downgrade, not a churn', () => {
    const downgraded = movement(previous, [{ customerId: 'a', mrr: usd('4.99') }], 'USD');

    expect(downgraded.contraction.toDecimalString()).toBe('5.0000');
    expect(downgraded.logoChurn).toBe(2);
  });

  it('refuses to report a lifetime nobody has measured', () => {
    expect(lifetimeValue(usd('20.00'), 0)).toBeNull();
    expect(lifetimeValue(usd('20.00'), 0.05)?.toDecimalString()).toBe('400.0000');
  });

  it('has no churn rate for a month that started empty', () => {
    expect(logoChurnRate(0, 0)).toBeNull();
    expect(logoChurnRate(1, 4)).toBe(0.25);
  });
});
