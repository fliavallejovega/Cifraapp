export {
  evaluateCondition,
  evaluateRules,
  recordExecution,
  type EvaluationOptions,
  type MatchedRule,
  type RuleEvaluation,
  type RuleExecution,
  type SkipReason,
  type SkippedRule,
  type Truth,
} from './evaluate.js';

export {
  FACT_CATALOGUE,
  factKind,
  isKnownFact,
  listFacts,
  type FactKey,
  type FactKind,
  type FactSet,
  type FactValue,
} from './facts.js';

export {
  MAX_ACTIONS_PER_RULE,
  MAX_CONDITION_DEPTH,
  MAX_CONDITIONS_PER_RULE,
  validateRule,
  type Action,
  type AllocationPriority,
  type ComparisonOperator,
  type Condition,
  type FactComparison,
  type Literal,
  type Rule,
  type RuleProblem,
} from './schema.js';
