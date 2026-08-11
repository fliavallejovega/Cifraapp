import type { AIProvider, ProviderRequest, ProviderResult } from '../types.js';

/**
 * OpenAI's chat completions, over `fetch`.
 *
 * The second provider is not hedging — it is the reason `AIProvider` exists.
 * A single-provider abstraction is a guess about what an interface should look
 * like; the second implementation is where the guess gets corrected, and it
 * corrected one thing here: structured output is requested differently by every
 * provider, so the request carries a schema and each adapter decides how to ask
 * for it.
 */

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const SCHEMA_NAME = 'structured_answer';

export interface OpenAIOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const;
  readonly model: string;

  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: OpenAIOptions) {
    this.#apiKey = options.apiKey;
    this.model = options.model ?? 'gpt-4.1';
    this.#endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async complete(request: ProviderRequest): Promise<ProviderResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, request.timeoutMs);

    try {
      const response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.#apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_completion_tokens: request.maxOutputTokens,
          temperature: request.temperature,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: SCHEMA_NAME, strict: true, schema: request.outputSchema },
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          ok: false,
          error: {
            kind: 'transport',
            status: response.status,
            message: `OpenAI returned ${String(response.status)}.`,
          },
        };
      }

      const body: unknown = await response.json();
      return readCompletion(body, this.model);
    } catch (cause) {
      return {
        ok: false,
        error: {
          kind: 'transport',
          status: null,
          message: cause instanceof Error ? cause.name : 'Request failed.',
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function readCompletion(body: unknown, model: string): ProviderResult {
  if (typeof body !== 'object' || body === null) {
    return {
      ok: false,
      error: { kind: 'malformed_output', issues: ['Response was not an object.'] },
    };
  }

  const record = body as {
    choices?: unknown;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0] as
    { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown } | undefined;

  if (typeof first?.message?.refusal === 'string') {
    return { ok: false, error: { kind: 'refused', reason: first.message.refusal } };
  }

  const content = first?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return {
      ok: false,
      error: {
        kind: 'malformed_output',
        issues: [`No content was returned (finish reason: ${String(first?.finish_reason)}).`],
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, error: { kind: 'malformed_output', issues: ['Content was not JSON.'] } };
  }

  return {
    ok: true,
    value: {
      model,
      usage: {
        inputTokens: asCount(record.usage?.prompt_tokens),
        outputTokens: asCount(record.usage?.completion_tokens),
      },
      raw: parsed,
    },
  };
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
