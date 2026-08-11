import { err, ok, type Result } from '@app/domain';

import { checkBudget, estimateTokens, projectMicros, type BudgetState } from './budget.js';
import { cacheKey, type ResponseCache } from './cache.js';
import { usageMicros, type PricingLookup } from './cost.js';
import { ungroundedFigures, type GuardrailOptions } from './guardrails.js';
import {
  missingGrounding,
  renderSystem,
  renderUser,
  type PromptDefinition,
  type PromptLocale,
} from './prompts.js';
import { collectText, parseOutput, toJsonSchema } from './schema.js';
import type {
  AIFailure,
  AIFeature,
  AIProvider,
  Grounding,
  ProviderId,
  StructuredOutput,
  TokenUsage,
} from './types.js';

/**
 * One call, with everything that must happen around it.
 *
 * Six things stand between a question and an answer, in this order, and the
 * order is the point:
 *
 *   1. **Grounding check** — a prompt missing a fact it declared never runs.
 *   2. **Cache** — a repeatable question is answered once.
 *   3. **Budget** — checked against projected cost, before spending it.
 *   4. **Provider** — the only step that leaves the process.
 *   5. **Parse** — structured or nothing.
 *   6. **Guardrail** — no figure the facts did not carry.
 *
 * Steps 1, 5 and 6 are refusals to trust the model, and each has cost a product
 * somewhere a wrong number on a customer's screen. Step 3 is the one that runs
 * before rather than after, which is what makes it a budget rather than a
 * report.
 */

export const DEFAULT_TIMEOUT_MS = 20_000;

/** Deterministic. The same question twice should not produce two answers. */
export const TEMPERATURE = 0;

export interface InvocationRecord {
  readonly promptId: string;
  readonly feature: AIFeature;
  readonly provider: ProviderId;
  readonly model: string;
  readonly locale: PromptLocale;
  readonly usage: TokenUsage;
  /** Estimated, in micro-dollars. Tokens are the record; this is derived. */
  readonly costMicros: bigint;
  readonly cacheHit: boolean;
  readonly latencyMs: number;
}

export interface Invocation {
  readonly output: StructuredOutput;
  readonly record: InvocationRecord;
  /** Fraction of the budget consumed, once past the warning threshold. */
  readonly budgetWarning: number | null;
}

export interface InvokeOptions {
  readonly prompt: PromptDefinition;
  readonly grounding: Grounding;
  readonly locale: PromptLocale;
  readonly provider: AIProvider;
  readonly pricing?: PricingLookup;
  readonly cache?: ResponseCache;
  readonly budget?: BudgetState;
  readonly guardrail?: GuardrailOptions;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export async function invoke(options: InvokeOptions): Promise<Result<Invocation, AIFailure>> {
  const { prompt, grounding, locale, provider } = options;
  const now = options.now ?? (() => Date.now());
  const startedAt = now();

  const missing = missingGrounding(prompt, grounding);
  if (missing.length > 0) {
    return err({ kind: 'missing_grounding', names: missing });
  }

  const system = renderSystem(prompt, locale);
  const user = renderUser(grounding);
  const key = cacheKey(`${prompt.id}:${locale}`, grounding);

  if (prompt.cacheable && options.cache) {
    const cached = await options.cache.get(key);
    if (cached) {
      return ok({
        output: cached.output,
        record: {
          promptId: prompt.id,
          feature: prompt.feature,
          provider: provider.id,
          model: cached.model,
          locale,
          usage: cached.usage,
          // A cache hit costs nothing. Recording the original cost here would
          // double-count it against the budget every time it is served.
          costMicros: 0n,
          cacheHit: true,
          latencyMs: now() - startedAt,
        },
        budgetWarning: null,
      });
    }
  }

  const pricing = options.pricing?.(provider.id, provider.model);

  if (options.budget && pricing) {
    const projected = projectMicros(
      estimateTokens(system) + estimateTokens(user),
      prompt.maxOutputTokens,
      pricing.inputMicrosPerMillion,
      pricing.outputMicrosPerMillion,
    );

    const verdict = checkBudget(options.budget, projected);
    if (verdict.decision === 'deny') return err(verdict.failure);
  }

  const response = await provider.complete({
    system,
    user,
    outputSchema: toJsonSchema(prompt.output),
    maxOutputTokens: prompt.maxOutputTokens,
    temperature: TEMPERATURE,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  if (!response.ok) return err(response.error);

  const parsed = parseOutput(prompt.output, response.value.raw);
  if (!parsed.ok) return err({ kind: 'malformed_output', issues: parsed.error });

  const figures = ungroundedFigures(collectText(parsed.value), grounding, options.guardrail ?? {});
  if (figures.length > 0) {
    return err({ kind: 'ungrounded_figures', figures });
  }

  const costMicros = pricing ? usageMicros(pricing, response.value.usage) : 0n;

  if (prompt.cacheable && options.cache) {
    await options.cache.set(key, {
      output: parsed.value,
      usage: response.value.usage,
      model: response.value.model,
      promptId: prompt.id,
    });
  }

  const warning =
    options.budget && options.budget.capMicros > 0n
      ? warningFraction(options.budget, costMicros)
      : null;

  return ok({
    output: parsed.value,
    record: {
      promptId: prompt.id,
      feature: prompt.feature,
      provider: provider.id,
      model: response.value.model,
      locale,
      usage: response.value.usage,
      costMicros,
      cacheHit: false,
      latencyMs: now() - startedAt,
    },
    budgetWarning: warning,
  });
}

function warningFraction(budget: BudgetState, costMicros: bigint): number | null {
  const verdict = checkBudget(budget, costMicros);
  return verdict.decision === 'warn' ? verdict.fractionUsed : null;
}
