/**
 * Market data: what a household owns, valued at a price it did not invent.
 *
 * The package draws one line and keeps it: a **quantity** is a fact the
 * household states, a **price** is a fact somebody else states, and every
 * price that crosses this boundary carries the source that said it and the
 * moment it was said. Nothing here recommends, predicts or ranks — valuing
 * what is already owned is arithmetic, and it is the only thing about markets
 * this product does.
 */

export {
  lookup,
  lookupAll,
  PRICE_SOURCE,
  type LookupFailure,
  type LookupResult,
} from './provider.js';
export {
  isStale,
  totalOf,
  valueOf,
  type HoldingKind,
  type Quote,
  type Valuation,
} from './quote.js';
