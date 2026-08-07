import { Money, toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { normalizeDescription } from './normalize.js';
import { detectTransfers, type TransferLeg } from './transfers.js';

const usd = (value: string): Money => Money.fromDecimalString(value, 'USD');

function leg(
  id: string,
  accountId: string,
  accountType: string,
  amount: string,
  date: string,
  description = '',
): TransferLeg {
  return {
    id,
    accountId,
    accountType,
    transactionDate: toPlainDate(date),
    amount: usd(amount),
    descriptionNormalized: normalizeDescription(description).normalized,
  };
}

describe('transfers between own accounts', () => {
  it('pairs a matching outflow and inflow into one transfer', () => {
    const matches = detectTransfers([
      leg('a', 'checking', 'checking', '-500.00', '2026-07-10', 'Transferencia a ahorros'),
      leg('b', 'savings', 'savings', '500.00', '2026-07-10', 'Transferencia desde corriente'),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.from.id).toBe('a');
    expect(matches[0]?.to.id).toBe('b');
    expect(matches[0]?.isCardPayment).toBe(false);
  });

  it('does not treat a movement as income plus an expense', () => {
    // The whole point: one transfer, never two entries. A household that moved
    // $500 between its own accounts spent nothing and earned nothing.
    const matches = detectTransfers([
      leg('a', 'checking', 'checking', '-500.00', '2026-07-10'),
      leg('b', 'savings', 'savings', '500.00', '2026-07-10'),
    ]);

    expect(matches).toHaveLength(1);
  });

  it('tolerates a settlement lag within the window', () => {
    const matches = detectTransfers([
      leg('a', 'checking', 'checking', '-500.00', '2026-07-10'),
      leg('b', 'savings', 'savings', '500.00', '2026-07-12'),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.confidence).toBeLessThan(0.85);
  });

  it('refuses a pair outside the window', () => {
    expect(
      detectTransfers([
        leg('a', 'checking', 'checking', '-500.00', '2026-07-10'),
        leg('b', 'savings', 'savings', '500.00', '2026-07-25'),
      ]),
    ).toEqual([]);
  });

  it('refuses a pair on the same account', () => {
    // A charge and its reversal on one account is a correction, not a transfer.
    expect(
      detectTransfers([
        leg('a', 'checking', 'checking', '-500.00', '2026-07-10'),
        leg('b', 'checking', 'checking', '500.00', '2026-07-10'),
      ]),
    ).toEqual([]);
  });

  it('refuses a pair with different amounts', () => {
    expect(
      detectTransfers([
        leg('a', 'checking', 'checking', '-500.00', '2026-07-10'),
        leg('b', 'savings', 'savings', '499.00', '2026-07-10'),
      ]),
    ).toEqual([]);
  });
});

describe('credit card payments', () => {
  it('marks a payment toward a card as a card payment, not spending', () => {
    // The expensive mistake: counting a $1,200 card payment as an expense
    // double-counts, because the purchases behind it were already counted.
    const matches = detectTransfers([
      leg('a', 'checking', 'checking', '-1200.00', '2026-07-15', 'Pago tarjeta Visa'),
      leg('b', 'visa', 'credit_card', '1200.00', '2026-07-15', 'Payment thank you'),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.isCardPayment).toBe(true);
    expect(matches[0]?.explanation).toMatch(/already counted/i);
  });

  it('marks a loan payment the same way', () => {
    const matches = detectTransfers([
      leg('a', 'checking', 'checking', '-350.00', '2026-07-05', 'Pago prestamo'),
      leg('b', 'auto-loan', 'loan', '350.00', '2026-07-05'),
    ]);

    expect(matches[0]?.isCardPayment).toBe(true);
  });

  it('scores a payment with transfer wording above a bare one', () => {
    const worded = detectTransfers([
      leg('a', 'checking', 'checking', '-100.00', '2026-07-05', 'Transferencia'),
      leg('b', 'savings', 'savings', '100.00', '2026-07-05', 'Transferencia'),
    ]);
    const bare = detectTransfers([
      leg('c', 'checking', 'checking', '-100.00', '2026-07-05', 'ABC123'),
      leg('d', 'savings', 'savings', '100.00', '2026-07-05', 'XYZ789'),
    ]);

    expect(worded[0]?.confidence).toBeGreaterThan(bare[0]?.confidence ?? 0);
  });
});

describe('multiple candidate pairs', () => {
  it('claims each transaction at most once', () => {
    // Three $500 movements on one day must not produce nine pairings.
    const matches = detectTransfers([
      leg('out-1', 'checking', 'checking', '-500.00', '2026-07-10'),
      leg('out-2', 'checking', 'checking', '-500.00', '2026-07-10'),
      leg('in-1', 'savings', 'savings', '500.00', '2026-07-10'),
      leg('in-2', 'travel', 'savings', '500.00', '2026-07-10'),
    ]);

    expect(matches).toHaveLength(2);

    const used = matches.flatMap((match) => [match.from.id, match.to.id]);
    expect(new Set(used).size).toBe(used.length);
  });

  it('leaves an unmatched outflow alone', () => {
    const matches = detectTransfers([
      leg('out-1', 'checking', 'checking', '-500.00', '2026-07-10'),
      leg('out-2', 'checking', 'checking', '-72.30', '2026-07-10'),
      leg('in-1', 'savings', 'savings', '500.00', '2026-07-10'),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.from.id).toBe('out-1');
  });
});
