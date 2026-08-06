import { describe, expect, it } from 'vitest';

import { CurrencyMismatchError } from './currency.js';
import { Money } from './money.js';

const usd = (value: string): Money => Money.fromDecimalString(value, 'USD');

describe('Money construction', () => {
  it('parses decimal strings losslessly', () => {
    expect(usd('1234.56').toDecimalString()).toBe('1234.5600');
    expect(usd('-0.0001').toDecimalString()).toBe('-0.0001');
    expect(usd('0').toDecimalString()).toBe('0.0000');
  });

  it('rejects precision it cannot represent instead of truncating', () => {
    expect(() => usd('1.234567')).toThrow(RangeError);
  });

  it('rejects values that are not decimals', () => {
    expect(() => usd('1,234.56')).toThrow(TypeError);
    expect(() => usd('abc')).toThrow(TypeError);
    expect(() => usd('1e5')).toThrow(TypeError);
  });

  it('round-trips through JSON without a float in sight', () => {
    const original = usd('98765.4321');
    const wire = JSON.stringify(original);
    expect(wire).toBe('{"amount":"98765.4321","currency":"USD"}');

    const restored = Money.fromJSON(JSON.parse(wire) as { amount: string; currency: string });
    expect(restored.equals(original)).toBe(true);
  });

  it('builds from minor units the way a payment processor reports them', () => {
    expect(Money.fromMinorUnits(1999, 'USD').toCurrencyString()).toBe('19.99');
  });
});

describe('Money arithmetic', () => {
  it('adds and subtracts exactly where floating point would not', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754. It must be exact here.
    expect(usd('0.1').add(usd('0.2')).toCurrencyString()).toBe('0.30');
    expect(usd('0.3').subtract(usd('0.1')).toCurrencyString()).toBe('0.20');
  });

  it('refuses to mix currencies', () => {
    const dollars = Money.fromDecimalString('10.00', 'USD');
    const balboas = Money.fromDecimalString('10.00', 'PAB');
    expect(() => dollars.add(balboas)).toThrow(CurrencyMismatchError);
  });

  it('multiplies by a rate without float drift', () => {
    // A 7.25% rate applied to 1,000 is exactly 72.50.
    expect(usd('1000.00').multiply('0.0725').toCurrencyString()).toBe('72.50');
    expect(usd('1000.00').percentage(7.25).toCurrencyString()).toBe('72.50');
  });

  it('rounds half-up by default and half-even on request', () => {
    // 0.0005 × 0.1 = 0.00005, exactly half of the smallest representable unit.
    const boundary = Money.fromScaledUnits(5n, 'USD'); // 0.0005
    expect(boundary.multiply('0.1', 'half-up').scaledUnits).toBe(1n);
    expect(boundary.multiply('0.1', 'half-even').scaledUnits).toBe(0n);
    expect(boundary.multiply('0.1', 'down').scaledUnits).toBe(0n);
  });

  it('rounds negatives symmetrically rather than toward negative infinity', () => {
    expect(usd('-0.0005').multiply('0.1', 'half-up').scaledUnits).toBe(-1n);
  });

  it('sums an empty list to a typed zero', () => {
    expect(Money.sum([], 'PAB').isZero()).toBe(true);
    expect(Money.sum([], 'PAB').currency).toBe('PAB');
  });
});

describe('Money.allocate', () => {
  it('splits $100 three ways without losing or inventing a cent', () => {
    const parts = usd('100.00').allocateEvenly(3);
    const total = Money.sum(parts, 'USD');

    expect(total.equals(usd('100.00'))).toBe(true);
    expect(parts.map((part) => part.toDecimalString())).toEqual(['33.3334', '33.3333', '33.3333']);
  });

  it('splits by weights and still reconciles exactly', () => {
    const parts = usd('1000.00').allocate([1, 1, 1, 1, 1, 1, 1]);
    expect(Money.sum(parts, 'USD').equals(usd('1000.00'))).toBe(true);
  });

  it('honors uneven weights the way an allocation plan would', () => {
    // 60% debt, 25% emergency fund, 15% travel.
    const parts = usd('500.00').allocate([60, 25, 15]);
    expect(parts.map((part) => part.toCurrencyString())).toEqual(['300.00', '125.00', '75.00']);
    expect(Money.sum(parts, 'USD').equals(usd('500.00'))).toBe(true);
  });

  it('reconciles for every amount from 1 to 1000 cents across 2 to 7 buckets', () => {
    for (let cents = 1; cents <= 1000; cents += 1) {
      for (let buckets = 2; buckets <= 7; buckets += 1) {
        const amount = Money.fromMinorUnits(cents, 'USD');
        const parts = amount.allocateEvenly(buckets);
        expect(Money.sum(parts, 'USD').equals(amount)).toBe(true);
      }
    }
  });

  it('handles negative amounts, as a refund allocation would', () => {
    const parts = usd('-100.00').allocateEvenly(3);
    expect(Money.sum(parts, 'USD').equals(usd('-100.00'))).toBe(true);
    expect(parts.every((part) => part.isNegative())).toBe(true);
  });

  it('rejects weights that cannot describe a split', () => {
    expect(() => usd('10.00').allocate([])).toThrow(RangeError);
    expect(() => usd('10.00').allocate([0, 0])).toThrow(RangeError);
    expect(() => usd('10.00').allocate([1, -1])).toThrow(RangeError);
  });

  it('is deterministic — the same input always favors the same bucket', () => {
    const first = usd('10.00')
      .allocateEvenly(3)
      .map((part) => part.toDecimalString());
    const second = usd('10.00')
      .allocateEvenly(3)
      .map((part) => part.toDecimalString());
    expect(first).toEqual(second);
  });
});

describe('Money comparison and rounding', () => {
  it('compares within a currency and throws across currencies', () => {
    expect(usd('10.00').greaterThan(usd('9.99'))).toBe(true);
    expect(usd('10.00').compare(usd('10.00'))).toBe(0);
    expect(() => usd('10.00').compare(Money.fromDecimalString('10.00', 'PAB'))).toThrow(
      CurrencyMismatchError,
    );
  });

  it('rounds to currency precision only when asked', () => {
    const raw = usd('12.3456');
    expect(raw.toDecimalString()).toBe('12.3456');
    expect(raw.roundToCurrencyPrecision().toDecimalString()).toBe('12.3500');
    expect(raw.toCurrencyString()).toBe('12.35');
  });
});
