export {
  computeBudgetState,
  MIN_MONTHS_FOR_SUGGESTION,
  suggestBudget,
  type BudgetState,
  type BudgetStateInput,
  type BudgetSuggestion,
} from './budget.js';

export {
  expectedInMonth,
  expectedOccurrences,
  FORECAST_LOOKBACK_MONTHS,
  MIN_MONTHS_FOR_FORECAST,
  projectMonths,
  summarizeByMonth,
  type ExpectedOccurrence,
  type MonthlyTotal,
  type Projection,
} from './forecast.js';

export {
  advanceToOrAfter,
  detectRecurrence,
  MIN_OCCURRENCES,
  RECURRING_CONFIDENCE_FLOOR,
} from './recurring.js';

export {
  computeSafeToSpend,
  DEFAULT_HORIZON_DAYS,
  estimateRunwayMonths,
  type Deduction,
  type DeductionKind,
  type SafeToSpendInput,
  type SafeToSpendResult,
} from './safe-to-spend.js';

export { median, medianNumber, relativeVariation, unitRatio } from './statistics.js';

export type {
  BudgetLineInput,
  BudgetLineState,
  Frequency,
  Occurrence,
  RecurringSeries,
  UpcomingObligation,
} from './types.js';
