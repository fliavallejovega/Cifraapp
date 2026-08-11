import type { CloseChecklist, CloseStep, CloseStepState, ReportPeriod } from './types.js';

/**
 * The monthly close.
 *
 * A month that has been closed is a month whose figures can be quoted. The point
 * of the checklist is that closing is a claim — "these numbers are right" — and a
 * claim made over forty uncategorized transactions is not one.
 *
 * Two steps block and the rest advise. Uncategorized rows block because a
 * statement missing a category is a statement missing a line. Unresolved
 * duplicates block because they overstate spending and understate the balance,
 * which is the pair of errors a person is least able to spot afterwards.
 * Everything else is a judgement the household is allowed to make.
 */

export const CLOSE_STEPS: readonly CloseStep[] = [
  'uncategorized',
  'duplicates',
  'transfers',
  'reconciliation',
  'recurring_changes',
  'tax_classification',
];

const BLOCKING_STEPS: ReadonlySet<CloseStep> = new Set<CloseStep>(['uncategorized', 'duplicates']);

export function buildCloseChecklist(
  period: ReportPeriod,
  outstanding: Readonly<Record<CloseStep, number>>,
): CloseChecklist {
  const steps: CloseStepState[] = CLOSE_STEPS.map((step) => ({
    step,
    outstanding: Math.max(0, outstanding[step]),
    blocks: BLOCKING_STEPS.has(step),
  }));

  const blocking = steps.filter((state) => state.blocks && state.outstanding > 0).length;

  return { period, steps, blocking, mayClose: blocking === 0 };
}

/**
 * Whether a date falls inside a closed period.
 *
 * The database enforces this too — a trigger refuses a write into a closed month
 * — because a rule that lives only in application code is a rule that a job, a
 * migration or a future endpoint will eventually walk around.
 */
export function isWithinClosedPeriod(
  date: string,
  closedPeriods: readonly ReportPeriod[],
): boolean {
  return closedPeriods.some((period) => date >= period.start && date <= period.end);
}

/**
 * What a correction to a closed month must be.
 *
 * Not an edit. A closed month's figures have been quoted — to an accountant, on
 * a return, in a decision — and changing them retroactively makes every earlier
 * copy wrong without saying so. The correction is a new entry in a later open
 * period that references what it adjusts.
 */
export interface Adjustment {
  readonly correctsTransactionId: string;
  readonly reason: string;
  /** The open period the correcting entry lands in. */
  readonly postedIn: ReportPeriod;
}
