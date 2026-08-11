import type { CurrencyCode } from '@app/domain';

import { microsToMoney } from './cost.js';
import type { AIFailure } from './types.js';

/**
 * The spending ceiling, checked before the call rather than after it.
 *
 * An AI feature that degrades when a budget runs out is a product decision; one
 * that keeps spending because nothing checked is an incident. The gate runs on
 * the *projected* cost — what this call is expected to add — because a budget
 * enforced only on what has already been spent is always exceeded exactly once.
 *
 * Warning before the ceiling matters as much as the ceiling. A household that
 * discovers the copilot stopped working has been failed twice.
 */

export const WARN_AT_FRACTION = 0.8;

export interface BudgetState {
  /** Zero means uncapped: the deployment has not set a limit. */
  readonly capMicros: bigint;
  readonly spentMicros: bigint;
  readonly currency: CurrencyCode;
}

export type BudgetVerdict =
  | { readonly decision: 'allow' }
  | { readonly decision: 'warn'; readonly fractionUsed: number }
  | {
      readonly decision: 'deny';
      readonly failure: Extract<AIFailure, { kind: 'budget_exhausted' }>;
    };

export function checkBudget(state: BudgetState, projectedMicros: bigint): BudgetVerdict {
  if (state.capMicros <= 0n) return { decision: 'allow' };

  const projected = state.spentMicros + (projectedMicros > 0n ? projectedMicros : 0n);

  if (projected > state.capMicros) {
    return {
      decision: 'deny',
      failure: {
        kind: 'budget_exhausted',
        spent: microsToMoney(state.spentMicros, state.currency),
        cap: microsToMoney(state.capMicros, state.currency),
      },
    };
  }

  const fractionUsed = Number((projected * 10_000n) / state.capMicros) / 10_000;
  return fractionUsed >= WARN_AT_FRACTION
    ? { decision: 'warn', fractionUsed }
    : { decision: 'allow' };
}

/**
 * What a call is expected to cost before it is made.
 *
 * Deliberately pessimistic on output: a model asked for at most `maxOutputTokens`
 * is assumed to use all of them. Under-projecting is how a cap gets crossed by
 * the call that was supposed to be checked.
 */
export function projectMicros(
  inputTokenEstimate: number,
  maxOutputTokens: number,
  inputMicrosPerMillion: bigint,
  outputMicrosPerMillion: bigint,
): bigint {
  const input = BigInt(Math.max(0, Math.trunc(inputTokenEstimate)));
  const output = BigInt(Math.max(0, Math.trunc(maxOutputTokens)));

  return (input * inputMicrosPerMillion + output * outputMicrosPerMillion) / 1_000_000n;
}

/**
 * A rough token count for text, used only to project cost.
 *
 * Four characters per token is the usual approximation across these models. It
 * is not accurate enough to bill on and is never used for that — the provider
 * reports real usage, and that is what gets logged.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
