import { describe, expect, it } from 'vitest';

import { formatMoney } from './format.js';
import { Money } from './money.js';

const usd = (value: string): Money => Money.fromDecimalString(value, 'USD');
const pab = (value: string): Money => Money.fromDecimalString(value, 'PAB');

describe('formatMoney', () => {
  it('formats dollars and balboas with their own symbols', () => {
    expect(formatMoney(usd('1234.56'))).toBe('$1,234.56');
    expect(formatMoney(pab('1234.56'))).toBe('B/. 1,234.56');
  });

  it('uses a true minus sign so figures stay aligned in a column', () => {
    expect(formatMoney(usd('-72.30'))).toBe('−$72.30');
  });

  it('shows a leading plus only when asked, for inflows and deltas', () => {
    expect(formatMoney(usd('500.00'), { signDisplay: 'always' })).toBe('+$500.00');
    expect(formatMoney(usd('500.00'))).toBe('$500.00');
    expect(formatMoney(usd('-500.00'), { signDisplay: 'never' })).toBe('$500.00');
  });

  it('rounds to currency precision rather than exposing internal scale', () => {
    expect(formatMoney(usd('12.3456'))).toBe('$12.35');
  });

  it('drops cents only when explicitly asked', () => {
    expect(formatMoney(usd('48210.00'), { compactCents: true })).toBe('$48,210');
  });

  it('can disambiguate currencies that share a peg', () => {
    expect(formatMoney(usd('100.00'), { showCode: true })).toBe('$100.00 USD');
    expect(formatMoney(pab('100.00'), { showCode: true })).toBe('B/. 100.00 PAB');
  });
});
