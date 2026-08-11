import type { Money } from '@app/domain';

/**
 * The shape of every AI interaction in the product.
 *
 * The rule this package exists to enforce is in `CLAUDE.md` and it is absolute:
 * **AI is never the source of truth** for a balance, a tax figure, a permission,
 * a ledger entry or a duplicate decision. It classifies and it explains
 * deterministic output. Everything here is arranged so that breaking that rule
 * requires deliberately working around the types rather than forgetting to
 * follow a convention.
 *
 * Three mechanisms carry the weight:
 *
 *   1. **Structured output only.** A model returns fields declared in advance
 *      (`ObjectShape`), parsed before anyone sees them. There is no code path in
 *      this package that hands free-form model text to a caller.
 *   2. **Grounding.** Every call carries the facts it is allowed to reason from,
 *      and the guardrail rejects an answer citing a figure that was not among
 *      them (`guardrails.ts`).
 *   3. **Read-only features.** `AIFeature` is a closed list of things AI may do.
 *      None of them writes.
 */

export type ProviderId = 'anthropic' | 'openai' | 'scripted' | 'none';

/**
 * What AI is allowed to be asked for.
 *
 * Closed on purpose. Adding a member is the moment to ask whether the new use is
 * an explanation of something deterministic — which is allowed — or a
 * computation the product would then be trusting a model to get right, which is
 * not. Modifying balances, creating accounting entries, computing authoritative
 * taxes, overriding a user rule, bypassing a permission, deleting a record and
 * clearing a duplicate are absent because they are forbidden, not because nobody
 * has needed them yet.
 */
export type AIFeature =
  | 'merchant_classification'
  | 'allocation_explanation'
  | 'anomaly_summary'
  | 'budget_suggestion'
  | 'document_interpretation'
  | 'rule_proposal'
  | 'scenario_narration'
  | 'question_answer';

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

/**
 * Why a call did not produce a usable answer.
 *
 * Every one of these is expected rather than exceptional — a household with no
 * key configured, a month's budget spent, a model that returned prose where a
 * field was required — so they travel as a `Result`, not as a throw. The caller
 * that renders a copilot panel has to decide what to say in each case, and the
 * compiler makes it.
 */
export type AIFailure =
  | { readonly kind: 'not_configured' }
  | { readonly kind: 'budget_exhausted'; readonly spent: Money; readonly cap: Money }
  | { readonly kind: 'transport'; readonly status: number | null; readonly message: string }
  | { readonly kind: 'missing_grounding'; readonly names: readonly string[] }
  | { readonly kind: 'malformed_output'; readonly issues: readonly string[] }
  | { readonly kind: 'ungrounded_figures'; readonly figures: readonly string[] }
  | { readonly kind: 'refused'; readonly reason: string };

/** The values a prompt may reason from, already rendered by deterministic code. */
export type Grounding = Readonly<Record<string, string>>;

/** A parsed structured answer. Field values are only ever these shapes. */
export type OutputValue = string | number | boolean | readonly string[] | readonly OutputRecord[];
export type OutputRecord = Readonly<Record<string, string | number | boolean>>;
export type StructuredOutput = Readonly<Record<string, OutputValue>>;

export interface ProviderRequest {
  readonly system: string;
  readonly user: string;
  /** JSON Schema the provider must emit against. Built from the prompt's shape. */
  readonly outputSchema: JsonSchema;
  readonly maxOutputTokens: number;
  /** Deterministic by default: the same question should not drift between reads. */
  readonly temperature: number;
  readonly timeoutMs: number;
}

export interface ProviderResponse {
  readonly model: string;
  readonly usage: TokenUsage;
  /** Unparsed. `parseOutput` decides whether it is usable. */
  readonly raw: unknown;
}

export interface AIProvider {
  readonly id: ProviderId;
  readonly model: string;
  complete(request: ProviderRequest): Promise<ProviderResult>;
}

export type ProviderResult =
  | { readonly ok: true; readonly value: ProviderResponse }
  | { readonly ok: false; readonly error: AIFailure };

/** The subset of JSON Schema the providers are sent. Narrow by design. */
export interface JsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, JsonSchemaField>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export type JsonSchemaField =
  | { readonly type: 'string'; readonly description: string; readonly maxLength?: number }
  | { readonly type: 'string'; readonly description: string; readonly enum: readonly string[] }
  | {
      readonly type: 'number';
      readonly description: string;
      readonly minimum?: number;
      readonly maximum?: number;
    }
  | { readonly type: 'boolean'; readonly description: string }
  | {
      readonly type: 'array';
      readonly description: string;
      readonly maxItems: number;
      readonly items: { readonly type: 'string'; readonly maxLength?: number } | JsonSchema;
    };
