import 'server-only';

import {
  AnthropicProvider,
  NullProvider,
  OpenAIProvider,
  invoke,
  microsToMoney,
  moneyToMicros,
  type AIFailure,
  type AIProvider,
  type Grounding,
  type Invocation,
  type ModelPricing,
  type PromptDefinition,
  type PromptLocale,
  type ResponseCache,
  type StructuredOutput,
} from '@app/ai';
import { aiBudgets, aiCache, aiInvocations, aiModels } from '@app/database/schema';
import { Money, type CurrencyCode } from '@app/domain';
import { getServerEnv } from '@app/validation/env';
import { and, eq, gte, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from './session';

/**
 * The copilot, wired to this deployment.
 *
 * Everything the engine needs from the outside world is assembled here: which
 * provider (if any), what a call costs, what the household has already spent,
 * what has been cached, and where the invocation is logged. The engine itself
 * knows none of it, which is what keeps it testable without a database.
 *
 * The important property is that a failure is not an exception. `ask` always
 * returns, always logs, and a screen that renders its result has to handle "no
 * provider configured" the same way it handles an answer. The deterministic
 * explanation was always on the page; the copilot adds to it or it does not.
 */

type Tx = Parameters<Parameters<typeof queryAsUser<unknown>>[1]>[0];

export interface CopilotAnswer {
  readonly output: StructuredOutput;
  readonly cacheHit: boolean;
  /** Set when this household is near its monthly ceiling. */
  readonly budgetWarning: number | null;
}

export type CopilotResult =
  | { readonly ok: true; readonly value: CopilotAnswer }
  | { readonly ok: false; readonly error: AIFailure };

/** Whether this deployment can call a model at all. */
export function copilotIsConfigured(): boolean {
  const env = getServerEnv();
  if (env.AI_PROVIDER === 'anthropic') return Boolean(env.ANTHROPIC_API_KEY);
  if (env.AI_PROVIDER === 'openai') return Boolean(env.OPENAI_API_KEY);
  return false;
}

function buildProvider(): AIProvider {
  const env = getServerEnv();

  if (env.AI_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      ...(env.AI_MODEL ? { model: env.AI_MODEL } : {}),
    });
  }

  if (env.AI_PROVIDER === 'openai' && env.OPENAI_API_KEY) {
    return new OpenAIProvider({
      apiKey: env.OPENAI_API_KEY,
      ...(env.AI_MODEL ? { model: env.AI_MODEL } : {}),
    });
  }

  return new NullProvider();
}

/**
 * Asks a question and records what happened, whatever happened.
 *
 * Failures are logged with the same care as successes. The ratio between them —
 * per prompt version — is the only evidence that a prompt revision improved
 * anything, and a copilot that logs only its wins cannot be improved.
 */
export async function ask(
  session: Session,
  householdId: string,
  options: {
    prompt: PromptDefinition;
    grounding: Grounding;
    locale: PromptLocale;
    currency?: CurrencyCode;
  },
): Promise<CopilotResult> {
  const provider = buildProvider();
  const currency = options.currency ?? 'USD';

  return queryAsUser(session, async (tx) => {
    const [pricing, spentMicros] = await Promise.all([
      loadPricing(tx, provider.id, provider.model, currency),
      loadMonthlySpend(tx, householdId),
    ]);

    const capMicros = await loadCap(tx, householdId);

    const result = await invoke({
      prompt: options.prompt,
      grounding: options.grounding,
      locale: options.locale,
      provider,
      pricing: () => pricing,
      cache: databaseCache(tx, householdId),
      budget: { capMicros, spentMicros, currency },
    });

    if (!result.ok) {
      await logFailure(tx, session, householdId, options, provider, result.error);
      return { ok: false, error: result.error };
    }

    await logSuccess(tx, session, householdId, result.value);
    return {
      ok: true,
      value: {
        output: result.value.output,
        cacheHit: result.value.record.cacheHit,
        budgetWarning: result.value.budgetWarning,
      },
    };
  });
}

/**
 * The cache, in the household's own rows.
 *
 * Scoped by household on both read and write. The key is a hash of the facts,
 * and two households can legitimately produce the same hash for the same
 * merchant — serving one's answer to the other would still be a cross-tenant
 * read, so the scope is in the query and not only in the key.
 */
function databaseCache(tx: Tx, householdId: string): ResponseCache {
  return {
    async get(key) {
      const [row] = await tx
        .select({
          output: aiCache.output,
          model: aiCache.model,
          promptId: aiCache.promptId,
          inputTokens: aiCache.inputTokens,
          outputTokens: aiCache.outputTokens,
        })
        .from(aiCache)
        .where(and(eq(aiCache.householdId, householdId), eq(aiCache.cacheKey, key)))
        .limit(1);

      if (!row) return undefined;

      await tx
        .update(aiCache)
        .set({ hits: sql`${aiCache.hits} + 1` })
        .where(and(eq(aiCache.householdId, householdId), eq(aiCache.cacheKey, key)));

      return {
        output: row.output as StructuredOutput,
        model: row.model,
        promptId: row.promptId,
        usage: { inputTokens: row.inputTokens, outputTokens: row.outputTokens },
      };
    },

    async set(key, answer) {
      await tx
        .insert(aiCache)
        .values({
          householdId,
          cacheKey: key,
          promptId: answer.promptId,
          model: answer.model,
          output: answer.output,
          inputTokens: answer.usage.inputTokens,
          outputTokens: answer.usage.outputTokens,
        })
        .onConflictDoNothing();
    },
  };
}

async function loadPricing(
  tx: Tx,
  provider: string,
  model: string,
  currency: CurrencyCode,
): Promise<ModelPricing | undefined> {
  const [row] = await tx
    .select({
      input: aiModels.inputMicrosPerMillion,
      output: aiModels.outputMicrosPerMillion,
    })
    .from(aiModels)
    .where(and(eq(aiModels.provider, provider), eq(aiModels.modelKey, model)))
    .limit(1);

  if (!row) return undefined;

  return {
    provider: provider as ModelPricing['provider'],
    model,
    inputMicrosPerMillion: row.input,
    outputMicrosPerMillion: row.output,
    currency,
  };
}

/** What this household has spent since the first of the month. */
async function loadMonthlySpend(tx: Tx, householdId: string): Promise<bigint> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${aiInvocations.costMicros}), 0)` })
    .from(aiInvocations)
    .where(
      and(
        eq(aiInvocations.householdId, householdId),
        gte(aiInvocations.createdAt, sql`date_trunc('month', now())`),
      ),
    );

  return BigInt(row?.total ?? '0');
}

/**
 * The household's ceiling, or the deployment's default when it has not set one.
 *
 * A household with no row is not uncapped. `AI_MONTHLY_BUDGET` is what applies,
 * and it defaults to zero — which is uncapped, and is the wrong setting for
 * anything a customer can reach. That is stated in the environment schema so
 * whoever configures a deployment reads it before they choose.
 */
async function loadCap(tx: Tx, householdId: string): Promise<bigint> {
  const [row] = await tx
    .select({ cap: aiBudgets.monthlyCapMicros })
    .from(aiBudgets)
    .where(eq(aiBudgets.householdId, householdId))
    .limit(1);

  if (row) return row.cap;

  return moneyToMicros(Money.fromDecimalString(getServerEnv().AI_MONTHLY_BUDGET, 'USD'));
}

async function logSuccess(
  tx: Tx,
  session: Session,
  householdId: string,
  invocation: Invocation,
): Promise<void> {
  const { record } = invocation;

  await tx.insert(aiInvocations).values({
    householdId,
    profileId: session.profile.id,
    feature: record.feature,
    promptId: record.promptId,
    locale: record.locale,
    provider: record.provider,
    model: record.model,
    inputTokens: record.usage.inputTokens,
    outputTokens: record.usage.outputTokens,
    costMicros: record.costMicros,
    cacheHit: record.cacheHit,
    latencyMs: record.latencyMs,
    outcome: record.cacheHit ? 'cache_hit' : 'ok',
  });
}

async function logFailure(
  tx: Tx,
  session: Session,
  householdId: string,
  options: { prompt: PromptDefinition; locale: PromptLocale },
  provider: AIProvider,
  failure: AIFailure,
): Promise<void> {
  await tx.insert(aiInvocations).values({
    householdId,
    profileId: session.profile.id,
    feature: options.prompt.feature,
    promptId: options.prompt.id,
    locale: options.locale,
    provider: provider.id,
    model: provider.model,
    outcome: outcomeOf(failure),
    failureDetail: detailOf(failure),
  });
}

function outcomeOf(
  failure: AIFailure,
):
  | 'not_configured'
  | 'budget_exhausted'
  | 'missing_grounding'
  | 'transport_error'
  | 'malformed_output'
  | 'ungrounded_figures'
  | 'refused' {
  switch (failure.kind) {
    case 'transport':
      return 'transport_error';
    case 'not_configured':
    case 'budget_exhausted':
    case 'missing_grounding':
    case 'malformed_output':
    case 'ungrounded_figures':
    case 'refused':
      return failure.kind;
  }
}

/**
 * A short, safe description of the failure.
 *
 * Never the provider's response body and never the grounding: both can carry a
 * household's own figures, and a log line is read by people who should not be
 * looking at them.
 */
function detailOf(failure: AIFailure): string | null {
  switch (failure.kind) {
    case 'not_configured':
      return null;
    case 'budget_exhausted':
      return `Spent ${failure.spent.toDecimalString()} of ${failure.cap.toDecimalString()}.`;
    case 'missing_grounding':
      return `Missing facts: ${failure.names.join(', ')}.`;
    case 'transport':
      return failure.message;
    case 'malformed_output':
      return failure.issues.join(' ');
    case 'ungrounded_figures':
      return `Figures not supported by the facts: ${failure.figures.join(', ')}.`;
    case 'refused':
      return failure.reason;
  }
}

/** Estimated AI spending this month, for a settings or admin screen to show. */
export async function monthlySpend(
  session: Session,
  householdId: string,
  currency: CurrencyCode = 'USD',
): Promise<Money> {
  return queryAsUser(session, async (tx) =>
    microsToMoney(await loadMonthlySpend(tx, householdId), currency),
  );
}
