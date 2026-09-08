import type { HoldingKind } from './quote.js';

/**
 * Finding an instrument by name, before anybody has to know its symbol.
 *
 * The symbol field used to be a guess with consequences. Somebody who owns
 * Bitcoin types `BTC`, and `BTC` is a real ticker — the Grayscale Bitcoin Mini
 * Trust, a fund on NYSE Arca — so the form found something, priced it, and
 * recorded a holding the household does not own. Nothing failed. That is the
 * problem this module exists to remove: the symbol stops being typed and
 * starts being *chosen*, from a list where Bitcoin and a bitcoin fund are two
 * visibly different rows.
 *
 * The same provider as the quote, for the same reason: two search indexes
 * would eventually disagree with the thing that prices them.
 */

const ENDPOINT = 'https://query1.finance.yahoo.com/v1/finance/search';

/** Shorter than the quote's. Nobody waits ten seconds for a suggestion. */
const TIMEOUT_MS = 6_000;

/**
 * Asked for wide, shown narrow.
 *
 * The provider ranks globally and the filters here are local, so a request
 * that returns only what fits on screen has nothing left after «solo cripto».
 */
const REQUESTED = 30;

export type SearchFailure = 'unavailable' | 'too-short';

/**
 * How a search is narrowed.
 *
 * Five of these are the instrument's own type, as the provider states it.
 * `bond` is not: no market data provider classifies a bond ETF as a bond, it
 * classifies it as an ETF that happens to hold bonds. So `bond` narrows *the
 * search* — funds and ETFs whose own name says what they hold — and every row
 * it returns still shows the type the provider actually gave it. A filter may
 * decide what is worth looking at; it may not relabel an instrument.
 */
export type SearchScope = 'all' | 'equity' | 'fund' | 'crypto' | 'bond' | 'other';

export interface Candidate {
  /** Exactly as it must be typed to be priced: `AAPL`, `VOO`, `BTC-USD`. */
  readonly symbol: string;
  readonly name: string;
  readonly kind: HoldingKind;
  /** Where it trades, as the provider names it. `NASDAQ`, `NYSEArca`, `CCC`. */
  readonly exchange: string | null;
}

export type SearchResult =
  | { readonly ok: true; readonly candidates: readonly Candidate[] }
  | { readonly ok: false; readonly reason: SearchFailure };

/**
 * The provider's instrument types, mapped onto the six this product keeps.
 *
 * Futures, options, currency pairs and warrants all land in `other` — they are
 * things a household can hold, so refusing to name them would be worse than
 * naming them vaguely, but none of them is an equity, a fund or a coin and
 * pretending otherwise would put the wrong word on a screen.
 */
export function kindOfQuoteType(quoteType: string | null, symbol: string): HoldingKind {
  switch ((quoteType ?? '').toUpperCase()) {
    case 'CRYPTOCURRENCY':
      return 'crypto';
    case 'ETF':
      return 'etf';
    case 'MUTUALFUND':
      return 'fund';
    case 'EQUITY':
      return 'equity';
    case 'INDEX':
      return 'index';
    default:
      // How the provider writes a coin when it has not said so outright, and
      // the shape a person types when they know the pair but not the type.
      return /-(USD|USDT|EUR|GBP)$/i.test(symbol) ? 'crypto' : 'other';
  }
}

/**
 * Words that mean «this fund holds debt», in both languages of the product.
 *
 * Read off the instrument's own name and nothing else. A name is the issuer's
 * statement about what the fund is, which is a weaker claim than a
 * classification and is therefore never shown as one — it only decides whether
 * the row survives the «bonos» filter.
 */
const DEBT_WORDS =
  /\b(bond|bonds|bono|bonos|treasury|tesoro|gilt|aggregate|agg|fixed[- ]income|renta fija|corporate debt|deuda|munis?|municipal|tips)\b/i;

const holdsDebt = (candidate: Candidate): boolean =>
  (candidate.kind === 'etf' || candidate.kind === 'fund') && DEBT_WORDS.test(candidate.name);

/** Whether a candidate belongs in a scoped list. Pure, so it is testable. */
export function matchesScope(candidate: Candidate, scope: SearchScope): boolean {
  switch (scope) {
    case 'all':
      return true;
    case 'equity':
      return candidate.kind === 'equity';
    case 'fund':
      return candidate.kind === 'etf' || candidate.kind === 'fund';
    case 'crypto':
      return candidate.kind === 'crypto';
    case 'bond':
      return holdsDebt(candidate);
    case 'other':
      return candidate.kind === 'index' || candidate.kind === 'other';
  }
}

/**
 * Whether a row is worth showing a person at all.
 *
 * The provider indexes several hundred thousand share classes of European
 * funds whose only name is their own identifier — `0P0001QOCA.F`. They are
 * real and they are useless here: a row that says nothing but its own code
 * cannot be chosen on purpose, and eight of them push the answer off screen.
 */
function isLegible(candidate: Candidate): boolean {
  const name = candidate.name.trim();
  if (name === '') return false;
  if (name.replace(/[.-]/g, '').toUpperCase() === candidate.symbol.replace(/[.-]/g, ''))
    return candidate.kind !== 'fund';
  return true;
}

/**
 * The order the list is shown in.
 *
 * The provider's own score decides almost everything, and it is right often
 * enough that the order it returns is kept wherever these rules do not speak.
 * What they correct is one failure, the one that produced this module: the
 * person typed the thing itself and was given the derivative.
 *
 * So the coin comes first. `BTC` is a real ticker — the Grayscale Bitcoin Mini
 * Trust — and an exact-match rule would hand somebody typing «btc» that fund
 * over Bitcoin, which is the bug rather than a fix for it. `<TERM>-USD`
 * therefore outranks even an exact symbol match, because a person typing a
 * coin's three letters means the coin, and the fund is still on the very next
 * row, named, typed and one click away for whoever did mean it. Everywhere
 * else an exact symbol wins: somebody who types `AAPL` means Apple, not a fund
 * with Apple in its name.
 */
export function rankCandidates(
  candidates: readonly Candidate[],
  term: string,
): readonly Candidate[] {
  const query = term.trim().toUpperCase();

  const priority = (candidate: Candidate): number => {
    const symbol = candidate.symbol.toUpperCase();
    if (candidate.kind === 'crypto' && symbol === `${query}-USD`) return 0;
    if (symbol === query) return 1;
    if (symbol.startsWith(`${query}-`) || symbol.startsWith(`${query}.`)) return 2;
    if (symbol.startsWith(query)) return 3;
    return 4;
  };

  // A stable sort, so anything the two rules do not separate keeps the order
  // the provider ranked it in rather than an order this function invented.
  return [...candidates]
    .map((candidate, position) => ({ candidate, position, priority: priority(candidate) }))
    .sort((a, b) => a.priority - b.priority || a.position - b.position)
    .map((entry) => entry.candidate);
}

interface RawQuote {
  symbol?: unknown;
  shortname?: unknown;
  longname?: unknown;
  quoteType?: unknown;
  exchDisp?: unknown;
  isYahooFinance?: unknown;
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** The provider's payload, turned into candidates. Exported so it can be tested without a network. */
export function readCandidates(payload: unknown): readonly Candidate[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const quotes = (payload as { quotes?: unknown }).quotes;
  if (!Array.isArray(quotes)) return [];

  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  for (const entry of quotes as readonly RawQuote[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const symbol = asString(entry.symbol)?.toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    // The index also carries things the quote endpoint cannot price. Offering
    // one would be offering a holding that shows «no pudimos» forever.
    if (entry.isYahooFinance === false) continue;

    const candidate: Candidate = {
      symbol,
      name: asString(entry.longname) ?? asString(entry.shortname) ?? symbol,
      kind: kindOfQuoteType(asString(entry.quoteType), symbol),
      exchange: asString(entry.exchDisp),
    };
    if (!isLegible(candidate)) continue;

    seen.add(symbol);
    candidates.push(candidate);
  }

  return candidates;
}

/**
 * What the provider knows by this name, narrowed to one kind of thing.
 *
 * Never throws, for the same reason `lookup` does not: every failure here is
 * something a form has to draw — a provider that is down, a query too short to
 * mean anything, a search that found nothing.
 */
export async function search(
  rawTerm: string,
  { scope = 'all', limit = 8 }: { scope?: SearchScope; limit?: number } = {},
): Promise<SearchResult> {
  const term = rawTerm.trim();
  if (term.length < 2) return { ok: false, reason: 'too-short' };

  let payload: unknown;
  try {
    const url = `${ENDPOINT}?q=${encodeURIComponent(term)}&quotesCount=${REQUESTED}&newsCount=0&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query`;
    const response = await fetch(url, {
      headers: {
        // Without it the endpoint answers with a consent page rather than JSON.
        'User-Agent': 'Mozilla/5.0 (compatible; Cifraapp/1.0)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    payload = await response.json();
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  const matching = readCandidates(payload).filter((candidate) => matchesScope(candidate, scope));

  // An empty list is a successful search that found nothing, not a failure.
  // The two read differently on screen and only one of them is worth retrying.
  return { ok: true, candidates: rankCandidates(matching, term).slice(0, Math.max(1, limit)) };
}
