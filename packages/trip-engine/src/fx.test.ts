import { describe, expect, it } from 'vitest';

import { allocateUnits } from './allocate.js';
import { rebalanceShares, PROFILES, validateShares } from './categories.js';
import { convertToBase, convertToLocal, exchangeEffect, shiftedRate } from './fx.js';
import { suggestBudgetRange, levelForIndex } from './reference.js';
import { fromMinor, toMinor } from './units.js';

describe('conversion', () => {
  it('converts between base and local at a rate of local units per base unit', () => {
    expect(convertToLocal('165.00', '0.92', { minorUnits: 2 }, { minorUnits: 2 })).toBe('151.80');
    expect(convertToBase('46.50', '0.88511', { minorUnits: 2 }, { minorUnits: 2 })).toBe('52.54');
    expect(convertToLocal('100.00', '150.25', { minorUnits: 2 }, { minorUnits: 0 })).toBe('15025');
    expect(convertToBase('85900', '4100', { minorUnits: 0 }, { minorUnits: 2 })).toBe('20.95');
  });

  it('rounds half-up once, at the target currency', () => {
    expect(convertToLocal('0.01', '0.5', { minorUnits: 2 }, { minorUnits: 2 })).toBe('0.01');
    expect(convertToLocal('0.01', '0.49', { minorUnits: 2 }, { minorUnits: 2 })).toBe('0.00');
  });
});

describe('exchangeEffect', () => {
  it('is positive when the real rates cost more than the plan', () => {
    // Planned at 0.92 €/$: €92 would cost $100. Paid $105.
    expect(
      exchangeEffect(
        [{ localAmount: '92.00', localMinor: 2, currency: 'EUR', baseAmount: '105.00' }],
        { EUR: { rate: '0.92' } },
        2,
      ),
    ).toBe('5.00');
  });

  it('is negative when the trip came out cheaper, and ignores currencies without a planning rate', () => {
    expect(
      exchangeEffect(
        [
          { localAmount: '92.00', localMinor: 2, currency: 'EUR', baseAmount: '98.00' },
          { localAmount: '50000', localMinor: 0, currency: 'COP', baseAmount: '12.00' },
        ],
        { EUR: { rate: '0.92' } },
        2,
      ),
    ).toBe('-2.00');
  });
});

describe('shiftedRate', () => {
  it('makes the local currency dearer by the given percent', () => {
    expect(shiftedRate('0.92', '10')).toBe('0.8363636364');
    expect(
      convertToBase('100.00', shiftedRate('0.92', '10'), { minorUnits: 2 }, { minorUnits: 2 }),
    ).toBe('119.57');
  });
});

describe('allocateUnits', () => {
  it('adds back exactly and gives remainders by largest fraction', () => {
    expect(allocateUnits(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(allocateUnits(0n, [0n, 0n])).toEqual([0n, 0n]);
    expect(() => allocateUnits(5n, [0n, 0n])).toThrow();
  });
});

describe('rebalanceShares', () => {
  it('keeps the total at 10 000 when one category moves', () => {
    const next = rebalanceShares(PROFILES.balanced, 'food', 4000);
    expect(next.food).toBe(4000);
    expect(validateShares(next)).toBe(true);
  });

  it('does not move locked categories', () => {
    const next = rebalanceShares(PROFILES.balanced, 'food', 3000, ['lodging']);
    expect(next.lodging).toBe(PROFILES.balanced.lodging);
    expect(validateShares(next)).toBe(true);
  });
});

describe('references', () => {
  it('maps an index to its nearest level', () => {
    expect(levelForIndex('1.25')).toBe('high');
    expect(levelForIndex('0.75')).toBe('low');
  });

  it('suggests a range around an estimate, low under high', () => {
    const range = suggestBudgetRange({
      minorUnits: 2,
      legs: [{ days: 7, nights: 6, costIndex: '1.00', needsLodging: true }],
      travelerWeights: ['1', '1', '0.6'],
      profile: 'balanced',
    });
    expect(toMinor(range.low, 2)).toBeLessThan(toMinor(range.estimate, 2));
    expect(toMinor(range.estimate, 2)).toBeLessThan(toMinor(range.high, 2));
    expect(range.estimate).toBe(
      fromMinor((toMinor('55.00', 2) * 26n * 7n) / 10n + toMinor('90.00', 2) * 2n * 6n, 2),
    );
  });
});
