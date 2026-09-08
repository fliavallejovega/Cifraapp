'use server';

import { marketPrices } from '@app/database/schema';
import { lookup, search, type SearchScope } from '@app/market-data';
import { getServerEnv } from '@app/validation/env';
import { getPlatformDb } from '@app/database';

/**
 * Finding an instrument, and pricing the one that was chosen.
 *
 * Two things happen, and only one of them is for the person at the keyboard.
 * They get told whether the symbol is real, what it is called, and what it
 * costs — so «BTC» and «BTC-USD» and a typo stop being the same silent
 * outcome. The quote is also written to `app.market_prices`, so the portfolio
 * screen has something to value the holding at without asking the provider
 * again for every render.
 *
 * The write goes through the platform connection, not the household's. A quote
 * belongs to no household — it is what a market said — and letting one
 * household's request write a row every other household reads is exactly the
 * kind of thing that should require deciding to, rather than happening because
 * the connection was already open.
 */

export interface SymbolLookup {
  readonly ok: boolean;
  readonly symbol?: string;
  readonly name?: string;
  readonly price?: string;
  readonly currency?: string;
  readonly kind?: string;
  readonly asOf?: string;
  readonly reason?: 'not-found' | 'unavailable' | 'unsupported-currency' | 'empty';
}

export async function lookupSymbol(rawSymbol: string): Promise<SymbolLookup> {
  const symbol = rawSymbol.trim();
  if (symbol === '') return { ok: false, reason: 'empty' };

  const result = await lookup(symbol);
  if (!result.ok) return { ok: false, reason: result.reason };

  const { quote } = result;

  try {
    await getPlatformDb(getServerEnv().DATABASE_URL)
      .insert(marketPrices)
      .values({
        symbol: quote.symbol,
        kind: quote.kind,
        displayName: quote.displayName,
        price: quote.price,
        currency: quote.currency,
        previousClose: quote.previousClose,
        source: quote.source,
        asOf: quote.asOf,
      })
      .onConflictDoUpdate({
        target: marketPrices.symbol,
        set: {
          kind: quote.kind,
          displayName: quote.displayName,
          price: quote.price,
          currency: quote.currency,
          previousClose: quote.previousClose,
          source: quote.source,
          asOf: quote.asOf,
          updatedAt: new Date(),
        },
      });
  } catch {
    // The person asked what a symbol is worth and they are getting an answer.
    // Failing to cache it is this system's problem, not theirs.
  }

  return {
    ok: true,
    symbol: quote.symbol,
    name: quote.displayName,
    price: quote.price,
    currency: quote.currency,
    kind: quote.kind,
    asOf: quote.asOf.toISOString(),
  };
}

/**
 * What the provider knows by this name.
 *
 * The reason this exists is a holding somebody nearly recorded by accident:
 * they typed «BTC» meaning bitcoin, and `BTC` is a real ticker — the Grayscale
 * Bitcoin Mini Trust, a fund on NYSE Arca. The old field found it, priced it,
 * and would have stored a fund they do not own. Nothing failed, which is what
 * made it dangerous. Searching turns the symbol from something typed into
 * something chosen from a list where the coin and the fund named after it are
 * two visibly different rows.
 *
 * Nothing is written here. A search is a question, and the quote is only
 * recorded once somebody has picked the instrument they actually hold.
 */
export interface SymbolCandidate {
  readonly symbol: string;
  readonly name: string;
  readonly kind: string;
  readonly exchange: string | null;
}

export type SymbolSearch =
  | { readonly ok: true; readonly candidates: readonly SymbolCandidate[] }
  | { readonly ok: false; readonly reason: 'unavailable' | 'too-short' };

const SCOPES: readonly SearchScope[] = ['all', 'equity', 'fund', 'crypto', 'bond', 'other'];

export async function searchSymbols(term: string, rawScope: string): Promise<SymbolSearch> {
  const scope = SCOPES.includes(rawScope as SearchScope) ? (rawScope as SearchScope) : 'all';
  const result = await search(term, { scope, limit: 8 });
  if (!result.ok) return { ok: false, reason: result.reason };

  return {
    ok: true,
    candidates: result.candidates.map((candidate) => ({
      symbol: candidate.symbol,
      name: candidate.name,
      kind: candidate.kind,
      exchange: candidate.exchange,
    })),
  };
}
