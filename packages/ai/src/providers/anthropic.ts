import type { AIProvider, JsonSchema, ProviderRequest, ProviderResult } from '../types.js';

/**
 * Anthropic's Messages API, reached with `fetch` and nothing else.
 *
 * No SDK. This package is a dependency of the financial engines' host and the
 * whole workspace pins versions deliberately; an SDK here would pull a
 * transitive tree into the process that holds database credentials, to save
 * about forty lines. The API is a POST.
 *
 * Structured output goes through a single tool with the declared JSON Schema as
 * its input, and `tool_choice` forcing it. That is the reliable path: a model
 * told to "reply with JSON" will one day reply with JSON inside an apology.
 */

const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const EMIT_TOOL = 'emit_structured_answer';

export interface AnthropicOptions {
  readonly apiKey: string;
  /** Defaults to the current Sonnet. Overridable per deployment, never hardcoded upstream. */
  readonly model?: string;
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const;
  readonly model: string;

  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: AnthropicOptions) {
    this.#apiKey = options.apiKey;
    this.model = options.model ?? 'claude-sonnet-5';
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
          'x-api-key': this.#apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxOutputTokens,
          temperature: request.temperature,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
          tools: [
            {
              name: EMIT_TOOL,
              description: 'Return the answer in the required structure.',
              input_schema: request.outputSchema satisfies JsonSchema,
            },
          ],
          tool_choice: { type: 'tool', name: EMIT_TOOL },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          ok: false,
          error: {
            kind: 'transport',
            status: response.status,
            // The body may carry a key or a prompt echo. Only the status travels.
            message: `Anthropic returned ${String(response.status)}.`,
          },
        };
      }

      const body: unknown = await response.json();
      return readMessage(body, this.model);
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

function readMessage(body: unknown, model: string): ProviderResult {
  if (typeof body !== 'object' || body === null) {
    return {
      ok: false,
      error: { kind: 'malformed_output', issues: ['Response was not an object.'] },
    };
  }

  const record = body as {
    content?: unknown;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
    stop_reason?: unknown;
  };

  const content = Array.isArray(record.content) ? record.content : [];
  const toolUse = content.find(
    (block: unknown) =>
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'tool_use',
  ) as { input?: unknown } | undefined;

  if (!toolUse) {
    // `max_tokens` truncation lands here: the tool call never completed. Reported
    // as malformed rather than retried, because a retry of a prompt that does
    // not fit is the same call again.
    return {
      ok: false,
      error: {
        kind: 'malformed_output',
        issues: [`No structured answer was returned (stop reason: ${String(record.stop_reason)}).`],
      },
    };
  }

  return {
    ok: true,
    value: {
      model,
      usage: {
        inputTokens: asCount(record.usage?.input_tokens),
        outputTokens: asCount(record.usage?.output_tokens),
      },
      raw: toolUse.input,
    },
  };
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
