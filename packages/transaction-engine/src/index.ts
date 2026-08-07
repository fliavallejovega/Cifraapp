export { computeDocumentHash, computeFingerprint } from './fingerprint.js';

export {
  assessDuplicate,
  CERTAIN_THRESHOLD,
  DEFAULT_DATE_WINDOW_DAYS,
  REVIEW_THRESHOLD,
  type DuplicateAssessment,
  type DuplicateOptions,
  type DuplicateVerdict,
  type MatchSignal,
} from './identity.js';

export {
  descriptionSimilarity,
  normalizeDescription,
  type NormalizationResult,
} from './normalize.js';

export {
  countsAsSpending,
  DEFAULT_TRANSFER_WINDOW_DAYS,
  detectTransfers,
  type TransferLeg,
  type TransferMatch,
  type TransferOptions,
} from './transfers.js';

export {
  detectStatementFormat,
  parseAmountText,
  parseCsvStatement,
  parseOfxDate,
  parseOfxStatement,
  parseStatement,
  parseStatementDate,
  splitCsvLine,
  type ParseOptions,
} from './parsers/index.js';

export {
  StatementParseError,
  type CandidateTransaction,
  type ExistingTransaction,
  type ParsedStatement,
  type RejectedRow,
  type StatementFormat,
} from './types.js';
