export {
  accrueAcrossWindow,
  accrueInterest,
  aprToThousandths,
  effectiveApr,
  utilization,
} from './interest.js';

export {
  comparePlans,
  MAX_SIMULATION_MONTHS,
  simulatePayoff,
  type PlanComparison,
  type SimulationInput,
} from './simulate.js';

export {
  HYBRID_QUICK_WIN_MONTHS,
  orderDebts,
  totalMinimums,
  type StrategyOptions,
} from './strategy.js';

export type {
  Debt,
  DebtOutcome,
  DebtStrategy,
  OrderedDebt,
  PayoffMonth,
  PayoffPlan,
  SimulationProblem,
} from './types.js';
