import { describe, expect, it } from 'vitest';

import { lookup } from './provider.js';
import { isStale, totalOf, valueOf, type Quote } from './quote.js';

/**
 * The arithmetic is tested exactly; the network is tested for shape.
 *
 * A test that asserts what Bitcoin costs is a test that fails tomorrow for a
 * reason nobody caused. What is worth pinning is the part this package is
 * responsible for: that a quantity times a price is right to the cent, that a
 * price eight decimals long survives the multiplication, and that a quote
 * without a moment is never treated as current.
 */

const quote = (over: Partial<Quote> = {}): Quote => ({
  symbol: 'AAPL',
  kind: 'equity',
  displayName: 'Apple Inc.',
  price: '316.22000000',
  currency: 'USD',
  previousClose: '316.85000000',
  source: 'test',
  asOf: new Date('2026-09-08T20:00:00Z'),
  ...over,
});

describe('valuing a holding', () => {
  it('multiplies a whole quantity by a price, to the cent', () => {
    const result = valueOf('10', quote(), new Date('2026-09-08T20:00:00Z'));
    expect(result.value.toDecimalString()).toBe('3162.2000');
  });

  it('keeps eight decimals of price against a fractional quantity', () => {
    // A satoshi of Bitcoin at $78,515.12345678 is $0.00078515…, which survives
    // storage: money here is `numeric(19,4)`, so a tenth of a cent is kept and
    // only the *display* rounds to two places. Storing four and showing two is
    // what keeps a thousand of these from drifting.
    const dust = valueOf(
      '0.00000001',
      quote({ symbol: 'BTC-USD', kind: 'crypto', price: '78515.12345678', previousClose: null }),
    );
    expect(dust.value.toDecimalString()).toBe('0.0008');

    // A tenth of a Bitcoin is not dust, and every decimal of the price counts.
    const tenth = valueOf(
      '0.1',
      quote({ symbol: 'BTC-USD', kind: 'crypto', price: '78515.12345678', previousClose: null }),
    );
    expect(tenth.value.toDecimalString()).toBe('7851.5123');
  });

  it('reports the change against the previous close, in money and as a ratio', () => {
    const result = valueOf('100', quote());
    // 100 × (316.22 − 316.85) = −63.00
    expect(result.change?.toDecimalString()).toBe('-63.0000');
    expect(result.changeRatio).toBeCloseTo(-0.001988, 5);
  });

  it('reports no change at all when there is no close to compare against', () => {
    const result = valueOf('3', quote({ previousClose: null }));
    expect(result.change).toBeNull();
    // Null, not zero: «nothing to compare» and «did not move» are different
    // statements, and a screen showing 0.00% would be making the second one.
    expect(result.changeRatio).toBeNull();
  });

  it('measures how old the quote is rather than assuming it is now', () => {
    const result = valueOf('1', quote(), new Date('2026-09-08T20:45:00Z'));
    expect(result.ageMinutes).toBe(45);
  });
});

describe('deciding whether a quote is too old to show plainly', () => {
  it('gives a share price the rest of the day', () => {
    const fresh = quote({ asOf: new Date('2026-09-08T12:00:00Z') });
    expect(isStale(fresh, new Date('2026-09-08T20:00:00Z'))).toBe(false);
    expect(isStale(fresh, new Date('2026-09-09T20:00:00Z'))).toBe(true);
  });

  it('gives a crypto price fifteen minutes', () => {
    const coin = quote({ kind: 'crypto', asOf: new Date('2026-09-08T20:00:00Z') });
    expect(isStale(coin, new Date('2026-09-08T20:10:00Z'))).toBe(false);
    expect(isStale(coin, new Date('2026-09-08T20:40:00Z'))).toBe(true);
  });
});

describe('totalling a portfolio', () => {
  it('adds what shares a currency and leaves the rest out', () => {
    const dollars = valueOf('10', quote());
    // Balboas, which are pegged to the dollar one to one — and still not added
    // in. The peg is a fact about Panama, not a property of this function, and
    // a sum that quietly relies on it is a sum nobody can check. The product
    // reports the two separately everywhere else for the same reason.
    const balboas = valueOf('10', quote({ symbol: 'XXX', currency: 'PAB', price: '100' }));
    const total = totalOf([dollars, balboas], 'USD');
    expect(total.value.toDecimalString()).toBe('3162.2000');
  });

  it('reports no movement rather than none when nothing had a previous close', () => {
    const total = totalOf([valueOf('1', quote({ previousClose: null }))], 'USD');
    expect(total.change).toBeNull();
  });
});

/**
 * The live provider. Skipped without a network, because a unit test suite that
 * fails on a plane is a suite people learn to ignore.
 */
const online = process.env['MARKET_DATA_LIVE'] === '1';
const describeLive = online ? describe : describe.skip;

describeLive('the provider, against the real endpoint', () => {
  it('quotes a share and a coin, each with a source and a moment', async () => {
    for (const symbol of ['AAPL', 'BTC-USD']) {
      const result = await lookup(symbol);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(Number(result.quote.price)).toBeGreaterThan(0);
      expect(result.quote.currency).toBe('USD');
      expect(result.quote.source).toBe('yahoo-finance');
      expect(result.quote.asOf.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    }
  });

  it('says «not found» for a symbol that is not one, rather than guessing', async () => {
    const result = await lookup('ZZZZNOTAREALTICKER');
    expect(result.ok).toBe(false);
  });
});
