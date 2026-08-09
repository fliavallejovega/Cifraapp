export {
  AI_CONFIDENCE_CEILING,
  AUTO_APPLY_THRESHOLD,
  classify,
  shouldConsultAi,
} from './classify.js';

export {
  CORRECTIONS_BEFORE_PROPOSAL,
  confirmProposal,
  proposeRule,
  recordCorrection,
  type Correction,
  type RuleProposal,
} from './learning.js';

export {
  MERCHANT_SIMILARITY_FLOOR,
  normalizeMerchantName,
  resolveMerchant,
  type MerchantMatch,
  type MerchantSignal,
} from './merchants.js';

export {
  findMatchingRule,
  isRuleActiveOn,
  matchesPattern,
  orderRules,
  ruleSpecificity,
} from './rules.js';

export {
  sourceAuthority,
  type AiSuggestion,
  type ClassifiableTransaction,
  type Classification,
  type ClassificationContext,
  type ClassificationLogEntry,
  type ClassificationSource,
  type MatchKind,
  type MerchantRecord,
  type MerchantRule,
  type TaxClassification,
} from './types.js';
