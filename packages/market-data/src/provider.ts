import type { CurrencyCode } from '@app/domain';

import { kindOfQuoteType } from './search.js';
import type { HoldingKind, Quote } from './quote.js';

/**
 * Where a price comes from.
 *
 * One provider, on purpose. Two would mean two failure modes, two rate limits
 * and two answers to «what is AAPL worth», and the moment those two disagree
 * somebody has to decide which is right — a decision this product should not
 * be making about a number it did not produce.
 *
 * Yahoo's chart endpoint is public and unkeyed, which is what makes it usable
 * here at all: a household should not need a market-data subscription to be
 * told what its own shares are worth. It is also unofficial, so it is treated
 * as what it is — a best effort that can fail, whose failure is reported
 * rather than papered over with the last figure that happened to work.
 */

const ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SOURCE = 'yahoo-finance';

/** Ten seconds. A person is waiting on this while typing into a form. */
const TIMEOUT_MS = 10_000;

export type LookupFailure = 'not-found' | 'unavailable' | 'unsupported-currency';

export type LookupResult =
  | { readonly ok: true; readonly quote: Quote }
  | { readonly ok: false; readonly reason: LookupFailure };

/** What this product can relate to a household's money without inventing a rate. */
const SUPPORTED: readonly string[] = ['USD', 'PAB'];

interface ChartMeta {
  symbol?: unknown;
  currency?: unknown;
  regularMarketPrice?: unknown;
  chartPreviousClose?: unknown;
  previousClose?: unknown;
  regularMarketTime?: unknown;
  shortName?: unknown;
  longName?: unknown;
  instrumentType?: unknown;
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** A price arrives as a JSON number; it becomes text before anything else touches it. */
const asDecimal = (value: unknown): string | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toFixed(8) : null;

/**
 * The chart endpoint's `instrumentType`, read through the same table the
 * search uses. One mapping, so a symbol cannot be a fund while it is being
 * chosen and «other» once it is priced.
 */
const kindOf = (instrumentType: string | null, symbol: string): HoldingKind =>
  kindOfQuoteType(instrumentType, symbol);

/**
 * The current quote for one symbol.
 *
 * Never throws. Every way this can fail is an ordinary outcome a form has to
 * show — a typo, a provider that is down, a stock priced in a currency this
 * product cannot relate to the household's without an exchange rate it does
 * not have.
 */
export async function lookup(rawSymbol: string): Promise<LookupResult> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!/^[A-Z0-9.\-^=]{1,20}$/.test(symbol)) return { ok: false, reason: 'not-found' };

  let payload: unknown;
  try {
    const response = await fetch(`${ENDPOINT}/${encodeURIComponent(symbol)}?interval=1d&range=5d`, {
      headers: {
        // Without it the endpoint answers with a consent page rather than JSON.
        'User-Agent': 'Mozilla/5.0 (compatible; Cifraapp/1.0)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) return { ok: false, reason: 'not-found' };
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    payload = await response.json();
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  const meta = readMeta(payload);
  if (!meta) return { ok: false, reason: 'not-found' };

  const price = asDecimal(meta.regularMarketPrice);
  const currency = asString(meta.currency)?.toUpperCase() ?? null;
  if (!price || !currency) return { ok: false, reason: 'not-found' };
  if (!SUPPORTED.includes(currency)) return { ok: false, reason: 'unsupported-currency' };

  const seconds = typeof meta.regularMarketTime === 'number' ? meta.regularMarketTime : null;

  return {
    ok: true,
    quote: {
      symbol: asString(meta.symbol) ?? symbol,
      kind: kindOf(asString(meta.instrumentType), symbol),
      displayName: asString(meta.longName) ?? asString(meta.shortName) ?? symbol,
      price,
      currency: currency as CurrencyCode,
      previousClose: asDecimal(meta.chartPreviousClose) ?? asDecimal(meta.previousClose),
      source: SOURCE,
      // The provider's own timestamp when it gives one. Falling back to now
      // would date a stale quote to this instant, which is the one lie this
      // package exists to prevent.
      asOf: seconds === null ? new Date() : new Date(seconds * 1000),
    },
  };
}

function readMeta(payload: unknown): ChartMeta | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const chart = (payload as { chart?: unknown }).chart;
  if (typeof chart !== 'object' || chart === null) return null;
  const results = (chart as { result?: unknown }).result;
  if (!Array.isArray(results) || results.length === 0) return null;
  const first: unknown = results[0];
  if (typeof first !== 'object' || first === null) return null;
  const meta = (first as { meta?: unknown }).meta;
  return typeof meta === 'object' && meta !== null ? meta : null;
}

/** Several symbols at once, in parallel, each failing on its own. */
export async function lookupAll(symbols: readonly string[]): Promise<Map<string, LookupResult>> {
  const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()))].filter(Boolean);
  const results = await Promise.all(
    unique.map(async (symbol) => [symbol, await lookup(symbol)] as const),
  );
  return new Map(results);
}

export { SOURCE as PRICE_SOURCE };
