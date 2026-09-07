import { Money } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { normalizeTypedAmount } from './amount';

/**
 * The separator this file exists for.
 *
 * "3,200" was read as 3.2 and a $3,200 credit card went into the database as a
 * $3.20 one. Nothing failed: the insert succeeded, the plan was computed
 * correctly from a wrong number, and the only symptom was a minimum payment
 * capped at three dollars on a screen nobody had reason to distrust. That is
 * the shape of every money bug worth having a test for.
 */
describe('normalizeTypedAmount', () => {
  it('reads a lone separator with three digits behind it as grouping', () => {
    // The case that was wrong. Money is not written to three decimal places.
    expect(normalizeTypedAmount('3,200')).toBe('3200');
    expect(normalizeTypedAmount('1.234')).toBe('1234');
    expect(normalizeTypedAmount('950,000')).toBe('950000');
  });

  it('reads a lone separator with one or two digits behind it as a decimal', () => {
    expect(normalizeTypedAmount('950,50')).toBe('950.50');
    expect(normalizeTypedAmount('24.5')).toBe('24.5');
    expect(normalizeTypedAmount('0,99')).toBe('0.99');
  });

  it('takes the last separator as the decimal point when both appear', () => {
    expect(normalizeTypedAmount('1.234,56')).toBe('1234.56');
    expect(normalizeTypedAmount('1,234.56')).toBe('1234.56');
    expect(normalizeTypedAmount('1.234.567,89')).toBe('1234567.89');
    expect(normalizeTypedAmount('1,234,567.89')).toBe('1234567.89');
  });

  it('treats a repeated separator as grouping whatever follows it', () => {
    expect(normalizeTypedAmount('1.234.567')).toBe('1234567');
    expect(normalizeTypedAmount('1,234,567')).toBe('1234567');
  });

  it('strips currency symbols and spaces a bank app pastes in', () => {
    expect(normalizeTypedAmount('$1,234.56')).toBe('1234.56');
    expect(normalizeTypedAmount('B/. 1,234.56')).toBe('1234.56');
    expect(normalizeTypedAmount(' 2 800.00 ')).toBe('2800.00');
  });

  it('keeps a leading minus and drops one anywhere else', () => {
    expect(normalizeTypedAmount('-45.30')).toBe('-45.30');
    expect(normalizeTypedAmount('45.30-')).toBe('45.30');
  });

  it('returns an empty string for anything with no digits in it', () => {
    expect(normalizeTypedAmount('')).toBe('');
    expect(normalizeTypedAmount('   ')).toBe('');
    expect(normalizeTypedAmount('abc')).toBe('');
    expect(normalizeTypedAmount(null)).toBe('');
    expect(normalizeTypedAmount(undefined)).toBe('');
    expect(normalizeTypedAmount(1234)).toBe('');
  });

  it('produces something Money can parse without losing a cent', () => {
    // The only test that matters in the end: the string reaches the column and
    // the column is `numeric(19,4)`.
    const cases: readonly [string, string][] = [
      ['3,200', '3200.0000'],
      ['1.234,56', '1234.5600'],
      ['$1,234.56', '1234.5600'],
      ['950,50', '950.5000'],
      ['-45.30', '-45.3000'],
    ];

    for (const [typed, expected] of cases) {
      expect(Money.fromDecimalString(normalizeTypedAmount(typed), 'USD').toDecimalString()).toBe(
        expected,
      );
    }
  });
});
