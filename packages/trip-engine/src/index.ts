/**
 * The trips budget engine: pure functions from a trip's inputs to its per
 * diem, commitments, reserve and diagnostics. No I/O, no clock, no floats.
 * See docs/viajes/01-diseno.md §3.
 */
export { allocateUnits } from './allocate.js';
export { computeTripBudget, ENGINE_VERSION } from './budget.js';
export {
  CATEGORY_TEMPLATE,
  COMMITMENT_CATEGORIES,
  DAILY_CATEGORIES,
  isDailyCategory,
  isTripCategory,
  PROFILES,
  rebalanceShares,
  sharesFor,
  TRIP_CATEGORIES,
  validateShares,
  type CommitmentCategory,
  type DailyCategory,
  type Profile,
  type ProfileKey,
  type Shares,
  type TripCategory,
} from './categories.js';
export {
  baseToLocalUnits,
  convertToBase,
  convertToLocal,
  exchangeEffect,
  localToBaseUnits,
  shiftedRate,
} from './fx.js';
export {
  COST_INDEX_BY_LEVEL,
  DEFAULT_TRAVELER_WEIGHT,
  levelForIndex,
  noCostIndexProvider,
  suggestBudgetRange,
  type CostIndexProvider,
  type CostLevel,
  type RangeLeg,
} from './reference.js';
export type * from './types.js';
export { divide, fromMinor, toMinor, toScaled } from './units.js';
export {
  destinationsFromSegments,
  detectCurrency,
  MONTH_FIRST_COUNTRIES,
  normalizeExtraction,
  parsePrintedAmount,
  parsePrintedDate,
  parsePrintedTime,
  scrubSensitive,
  type DocumentKind,
  type FlightSegment,
  type Proposal,
  type RawExtraction,
} from './documents.js';
