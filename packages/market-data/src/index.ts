/**
 * Market data: what a household owns, valued at a price it did not invent.
 *
 * The package draws one line and keeps it: a **quantity** is a fact the
 * household states, a **price** is a fact somebody else states, and every
 * price that crosses this boundary carries the source that said it and the
 * moment it was said. Nothing here recommends or predicts — valuing what is
 * already owned is arithmetic, and it is the only thing about markets this
 * product does. The one ordering it performs is over search results, so that
 * somebody who types «BTC» is offered Bitcoin before a fund named after it;
 * that is spelling help, and it never reaches a portfolio.
 */

export {
  lookup,
  lookupAll,
  PRICE_SOURCE,
  type LookupFailure,
  type LookupResult,
} from './provider.js';
export {
  matchesScope,
  rankCandidates,
  search,
  type Candidate,
  type SearchFailure,
  type SearchResult,
  type SearchScope,
} from './search.js';
export {
  isStale,
  totalOf,
  valueOf,
  type HoldingKind,
  type Quote,
  type Valuation,
} from './quote.js';
