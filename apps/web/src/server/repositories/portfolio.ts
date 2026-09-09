import 'server-only';

import { getPlatformDb } from '@app/database';
import { holdings, householdPeople, marketPrices } from '@app/database/schema';
import { Money, type CurrencyCode } from '@app/domain';
import { isStale, lookupAll, totalOf, valueOf, type Quote, type Valuation } from '@app/market-data';
import { getServerEnv } from '@app/validation/env';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * What the household owns, and what it is worth right now.
 *
 * The split that runs through this file is the same one the schema draws: the
 * **quantity** is the household's, read under row-level security; the **price**
 * is the market's, read from a table that belongs to nobody. Putting them
 * together is arithmetic, and it happens here rather than in a screen so that
 * every screen gets the same answer.
 *
 * Quotes older than their kind allows are refreshed on the way in — fifteen
 * minutes for a coin, a day for a share. Not on every render: a page that
 * re-quotes six symbols each time somebody scrolls is a page that gets the
 * provider to stop answering, and the resulting silence would look like a
 * portfolio worth nothing.
 */

export interface Position {
  readonly id: string;
  readonly symbol: string;
  readonly label: string;
  readonly kind: string;
  readonly quantity: string;
  readonly holder: string | null;
  /** Quién es, por identificador, para que un formulario pueda pre-rellenarlo. */
  readonly holderId: string | null;
  /** Lo que costó, cuando la casa lo sabe. Nulo es «nadie lo dijo», no cero. */
  readonly costBasis: string | null;
  /**
   * Qué decidió la casa hacer con esta posición.
   *
   * Nulo es «nadie lo ha dicho», que no es lo mismo que «la mantengo». La
   * pantalla las distingue porque el plan las lee distinto: lo que no se toca
   * no está disponible, y lo que va a salir sí va a estarlo.
   */
  readonly intent: 'long_term' | 'hold' | 'exit' | 'reallocate' | null;
  readonly intentHorizon: string | null;
  readonly intentNote: string | null;
  readonly intentSetAt: Date | null;
  /** Absent when nothing has ever quoted this symbol. */
  readonly valuation: Valuation | null;
  readonly stale: boolean;
}

export interface Portfolio {
  readonly positions: readonly Position[];
  readonly total: Money;
  /**
   * Lo que la casa decidió no tocar, y lo que decidió convertir en efectivo.
   *
   * Es la lectura que el total general no puede dar: medio bitcoin y diez
   * acciones valen lo que valen, pero una es la reserva de cinco años y la otra
   * es lo que se piensa vender el mes que viene. Sumadas en una sola cifra, esa
   * diferencia —que es la que decide si el fondo de emergencia está resuelto—
   * desaparece.
   *
   * Sólo cuenta lo que se pudo cotizar, igual que el total.
   */
  readonly untouchable: Money;
  readonly leaving: Money;
  /** Cuántas posiciones nadie ha decidido todavía. */
  readonly undecided: number;
  /** Movement against the previous close, summed. Null when nothing had one. */
  readonly change: Money | null;
  /** Symbols nothing could price. Named, so the total can be read honestly. */
  readonly unpriced: readonly string[];
  readonly currency: CurrencyCode;
}

export async function loadPortfolio(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<Portfolio> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: holdings.id,
        symbol: holdings.symbol,
        label: holdings.label,
        kind: holdings.kind,
        quantity: holdings.quantity,
        holder: householdPeople.displayName,
        holderId: holdings.personId,
        costBasis: holdings.costBasis,
        intent: holdings.intent,
        intentHorizon: holdings.intentHorizon,
        intentNote: holdings.intentNote,
        intentSetAt: holdings.intentSetAt,
        price: marketPrices.price,
        priceCurrency: marketPrices.currency,
        previousClose: marketPrices.previousClose,
        displayName: marketPrices.displayName,
        priceKind: marketPrices.kind,
        source: marketPrices.source,
        asOf: marketPrices.asOf,
      })
      .from(holdings)
      .leftJoin(householdPeople, eq(householdPeople.id, holdings.personId))
      .leftJoin(marketPrices, eq(marketPrices.symbol, holdings.symbol))
      .where(and(eq(holdings.householdId, householdId), isNull(holdings.deletedAt)))
      .orderBy(asc(holdings.createdAt)),
  );

  if (rows.length === 0) {
    return {
      positions: [],
      total: Money.zero(currency),
      change: null,
      untouchable: Money.zero(currency),
      leaving: Money.zero(currency),
      undecided: 0,
      unpriced: [],
      currency,
    };
  }

  const quotes = new Map<string, Quote>();
  for (const row of rows) {
    if (!row.price || !row.priceCurrency || !row.asOf) continue;
    quotes.set(row.symbol, {
      symbol: row.symbol,
      kind: (row.priceKind ?? 'other') as Quote['kind'],
      displayName: row.displayName ?? row.label,
      price: row.price,
      currency: row.priceCurrency.trim() as CurrencyCode,
      previousClose: row.previousClose,
      source: row.source ?? 'unknown',
      asOf: row.asOf,
    });
  }

  // Only what has actually gone stale, and only once per symbol.
  const needsRefresh = [...new Set(rows.map((row) => row.symbol))].filter((symbol) => {
    const quote = quotes.get(symbol);
    return !quote || isStale(quote);
  });

  if (needsRefresh.length > 0) {
    const fresh = await lookupAll(needsRefresh);
    const platform = getPlatformDb(getServerEnv().DATABASE_URL);

    for (const [symbol, result] of fresh) {
      if (!result.ok) continue;
      quotes.set(symbol, result.quote);
      const quote = result.quote;
      try {
        await platform
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
              price: quote.price,
              previousClose: quote.previousClose,
              asOf: quote.asOf,
              updatedAt: new Date(),
            },
          });
      } catch {
        // The screen has the fresh quote in hand either way. Failing to keep
        // it is a cost to the next render, not to this reader.
      }
    }
  }

  const positions: Position[] = rows.map((row) => {
    const quote = quotes.get(row.symbol) ?? null;
    return {
      id: row.id,
      symbol: row.symbol,
      label: row.label,
      kind: row.kind,
      quantity: row.quantity,
      holder: row.holder,
      holderId: row.holderId,
      costBasis: row.costBasis,
      intent: row.intent,
      intentHorizon: row.intentHorizon,
      intentNote: row.intentNote,
      intentSetAt: row.intentSetAt,
      valuation: quote ? valueOf(row.quantity, quote) : null,
      stale: quote ? isStale(quote) : false,
    };
  });

  const valuations = positions
    .map((position) => position.valuation)
    .filter((entry): entry is Valuation => entry !== null);

  const { value, change } = totalOf(valuations, currency);

  /** Lo que vale un conjunto de posiciones, contando sólo lo cotizado. */
  const valueOfThose = (matches: (position: Position) => boolean): Money =>
    Money.sum(
      positions
        .filter((position) => matches(position))
        .map((position) => position.valuation?.value)
        .filter((amount): amount is Money => amount !== undefined),
      currency,
    );

  return {
    positions,
    total: value,
    change,
    // `long_term` es lo que la casa dijo que no toca. `hold` no entra: mantener
    // algo por ahora no es comprometerse a no venderlo, y contarlo como
    // intocable sería endurecer una decisión que nadie tomó.
    untouchable: valueOfThose((position) => position.intent === 'long_term'),
    leaving: valueOfThose((position) => position.intent === 'exit'),
    undecided: positions.filter((position) => position.intent === null).length,
    // Named rather than silently dropped. A total that quietly excludes two
    // holdings is a total nobody can reconcile against their own broker.
    unpriced: positions
      .filter((position) => position.valuation === null)
      .map((position) => position.symbol),
    currency,
  };
}
