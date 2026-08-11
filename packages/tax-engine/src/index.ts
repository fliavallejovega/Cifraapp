export {
  DEFAULT_CATEGORY_POLICY,
  classifyExpense,
  deductiblePercentage,
  type CategoryPolicy,
  type ClassificationInput,
  type ClassificationResult,
} from './classify.js';

export {
  INCOME_BRACKETS_KEY,
  applyBrackets,
  estimateIncomeTax,
  type ClaimedDeduction,
  type EstimateInput,
} from './estimate.js';

export { BUNDLED_RULE_SETS, PANAMA_2026_DRAFT } from './jurisdictions/pa-2026.js';

export { computeReserve, type ReserveInput, type ReserveResult } from './reserve.js';

export { findRule, mayPresent, rulesOfType, selectRuleSet, validateRuleSet } from './rules.js';

export type {
  AccountingMethod,
  DeductionRule,
  ExpenseClassification,
  RuleProvenance,
  RuleSetStatus,
  TaxBracket,
  TaxEstimate,
  TaxEstimateLine,
  TaxProblem,
  TaxRule,
  TaxRuleSet,
  TaxType,
  TaxpayerProfile,
  TaxpayerStatus,
} from './types.js';
