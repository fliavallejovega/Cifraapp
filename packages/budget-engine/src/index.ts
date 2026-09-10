export {
  computeBudgetState,
  MIN_MONTHS_FOR_SUGGESTION,
  suggestBudget,
  type BudgetState,
  type BudgetStateInput,
  type BudgetSuggestion,
} from './budget.js';

export {
  buildCommitmentCalendar,
  DEFAULT_ALARM_DAYS_BEFORE,
  DEFAULT_REFRESH_MINUTES,
  escapeText,
  foldLine,
  type CalendarCommitment,
  type CalendarOptions,
  type CommitmentCoverageHint,
} from './calendar.js';

export {
  compareCards,
  readRate,
  type CardOffer,
  type ComparisonResult,
  type RankedOffer,
  type SpendCategory,
} from './card-compare.js';

export {
  computeCoverage,
  COVERAGE_HORIZON_DAYS,
  type CommitmentCoverage,
  type CoverageCommitment,
  type CoverageDependency,
  type CoverageInput,
  type CoverageResult,
  type CoverageVerdict,
  type ExpectedReceipt,
  type ReceiptConfidence,
} from './coverage.js';

export {
  computeCushion,
  cushionClaim,
  cushionMonths,
  HIGH_VARIATION,
  MAX_CUSHION_MONTHS,
  MIN_CUSHION_MONTHS,
  STABLE_VARIATION,
  type CushionInput,
  type CushionState,
} from './cushion.js';

export {
  computeIncomeFloor,
  FLOOR_LOOKBACK_MONTHS,
  FLOOR_PERCENTILE,
  MIN_MONTHS_FOR_FLOOR,
  monthlyIncomeTotals,
  percentileOf,
  type FloorSource,
  type IncomeFloor,
  type IncomeFloorInput,
  type IncomeMonth,
  type IncomeReceipt,
} from './income-floor.js';

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
  buildPayPeriods,
  PAY_PERIOD_HORIZON_DAYS,
  periodContaining,
  type IncomeStream,
  type OneOffReceipt,
  type PayPeriod,
  type PayPeriodInput,
  type PeriodClaim,
} from './pay-period.js';

export {
  advanceToOrAfter,
  nextOccurrence,
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
