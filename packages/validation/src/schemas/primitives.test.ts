import { describe, expect, it } from 'vitest';

import { dateRangeSchema, moneySchema, paginationSchema, plainDateSchema } from './primitives.js';

describe('moneySchema', () => {
  it('parses an exact decimal string into Money', () => {
    const result = moneySchema.parse({ amount: '1234.56', currency: 'USD' });
    expect(result.toCurrencyString()).toBe('1234.56');
    expect(result.currency).toBe('USD');
  });

  it('rejects a JSON number, which would already have lost precision', () => {
    expect(() => moneySchema.parse({ amount: 1234.56, currency: 'USD' })).toThrow();
  });

  it('rejects precision the ledger cannot store', () => {
    expect(() => moneySchema.parse({ amount: '1.234567', currency: 'USD' })).toThrow();
  });

  it('rejects an unknown currency instead of defaulting to dollars', () => {
    expect(() => moneySchema.parse({ amount: '10.00', currency: 'EUR' })).toThrow();
  });
});

describe('plainDateSchema', () => {
  it('accepts a calendar date', () => {
    expect(plainDateSchema.parse('2026-07-31')).toBe('2026-07-31');
  });

  it('rejects a timestamp, which would reintroduce timezone drift', () => {
    expect(() => plainDateSchema.parse('2026-07-31T00:00:00Z')).toThrow();
  });

  it('rejects a date that does not exist', () => {
    expect(() => plainDateSchema.parse('2026-02-30')).toThrow();
  });
});

describe('dateRangeSchema', () => {
  it('rejects a range that ends before it starts', () => {
    expect(() => dateRangeSchema.parse({ start: '2026-07-31', end: '2026-07-01' })).toThrow();
  });

  it('accepts a single-day range', () => {
    expect(dateRangeSchema.parse({ start: '2026-07-01', end: '2026-07-01' })).toEqual({
      start: '2026-07-01',
      end: '2026-07-01',
    });
  });
});

describe('paginationSchema', () => {
  it('defaults to a bounded page rather than everything', () => {
    expect(paginationSchema.parse({}).limit).toBe(50);
  });

  it('refuses to fetch an unbounded history', () => {
    expect(() => paginationSchema.parse({ limit: 10_000 })).toThrow();
  });
});
