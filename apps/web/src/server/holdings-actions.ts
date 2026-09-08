'use server';

import { marketPrices } from '@app/database/schema';
import { lookup } from '@app/market-data';
import { getServerEnv } from '@app/validation/env';
import { getPlatformDb } from '@app/database';

/**
 * Looking a symbol up while somebody is typing it.
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
