import { describe, expect, it } from 'vitest';
import { Money, toPlainDate } from '@app/domain';

import {
  proposeReceivableMatches,
  type ArrivedMoney,
  type ExpectedCollection,
} from './receivable-match.js';

const usd = (value: string) => Money.fromDecimalString(value, 'USD');
const on = (value: string) => toPlainDate(value);

function invoice(over: Partial<ExpectedCollection> = {}): ExpectedCollection {
  return {
    id: 'r1',
    name: 'Factura Acme',
    source: 'Acme Studios',
    amount: usd('2400.00'),
    expectedFrom: on('2026-10-01'),
    expectedTo: on('2026-10-15'),
    ...over,
  };
}

function payment(over: Partial<ArrivedMoney> = {}): ArrivedMoney {
  return {
    id: 't1',
    date: on('2026-10-08'),
    amount: usd('2400.00'),
    description: 'TRANSFERENCIA ACME STUDIOS REF 88213',
    ...over,
  };
}

describe('proposing collections against money that arrived', () => {
  it('matches the exact amount inside the window, and says why', () => {
    const [proposal] = proposeReceivableMatches([invoice()], [payment()]);

    expect(proposal).toBeDefined();
    expect(proposal?.reasons).toContain('amount_exact');
    expect(proposal?.reasons).toContain('window_inside');
    expect(proposal?.reasons).toContain('name_match');
  });

  it('refuses a different sum of money however well everything else fits', () => {
    // Same day, same payer, same wording. Only the amount differs, and that is
    // enough: this is a different payment.
    const proposals = proposeReceivableMatches([invoice()], [payment({ amount: usd('1900.00') })]);

    expect(proposals).toHaveLength(0);
  });

  it('tolerates cents but not a tenth', () => {
    const cents = proposeReceivableMatches([invoice()], [payment({ amount: usd('2399.50') })]);
    expect(cents).toHaveLength(1);
    expect(cents[0]?.reasons).toContain('amount_close');

    const tenth = proposeReceivableMatches([invoice()], [payment({ amount: usd('2160.00') })]);
    expect(tenth).toHaveLength(0);
  });

  it('still proposes a payment that arrived late, and ranks it below one on time', () => {
    const late = payment({ id: 'late', date: on('2026-10-22') });
    const onTime = payment({ id: 'ontime', date: on('2026-10-08') });

    const proposals = proposeReceivableMatches([invoice()], [late, onTime]);

    expect(proposals.map((p) => p.transactionId)).toEqual(['ontime', 'late']);
    expect(proposals[1]?.reasons).toContain('window_near');
  });

  it('drops a payment too far outside the window to be this invoice', () => {
    const proposals = proposeReceivableMatches(
      [invoice({ source: null, name: 'Cobro' })],
      [payment({ date: on('2026-12-20'), description: 'DEPOSITO' })],
    );

    expect(proposals).toHaveLength(0);
  });

  it('still works when the household could not name a date', () => {
    const proposals = proposeReceivableMatches(
      [invoice({ expectedFrom: null, expectedTo: null })],
      [payment({ date: on('2027-03-03') })],
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.reasons).toContain('no_window');
  });

  it('does not match across currencies', () => {
    const proposals = proposeReceivableMatches(
      [invoice({ amount: Money.fromDecimalString('2400.00', 'PAB') })],
      [payment()],
    );

    expect(proposals).toHaveLength(0);
  });

  it('ignores short words so every payment does not match every invoice', () => {
    // «SA» and «de» appear in half the descriptions a bank produces.
    const proposals = proposeReceivableMatches(
      [invoice({ name: 'SA de CV', source: null })],
      [payment({ description: 'PAGO SA DE CV OTRO CLIENTE' })],
    );

    expect(proposals[0]?.reasons).not.toContain('name_match');
  });

  it('orders identical scores deterministically', () => {
    const first = proposeReceivableMatches(
      [invoice()],
      [payment({ id: 'b' }), payment({ id: 'a' })],
    );
    const second = proposeReceivableMatches(
      [invoice()],
      [payment({ id: 'a' }), payment({ id: 'b' })],
    );

    expect(first.map((p) => p.transactionId)).toEqual(second.map((p) => p.transactionId));
  });
});
