import type { AIProvider, ProviderRequest, ProviderResult, TokenUsage } from '../types.js';

/**
 * A provider that answers from a script.
 *
 * Every test in this package runs against it, and so can a development
 * environment with no keys. That is not a convenience: a copilot whose behaviour
 * can only be observed by paying a provider is a copilot nobody writes a
 * regression test for, and the guardrails are exactly the code that most needs
 * one.
 *
 * The script is keyed on the rendered user message, so a test states the facts
 * it is answering about rather than the order calls happen to arrive in.
 */
export class ScriptedProvider implements AIProvider {
  readonly id = 'scripted' as const;
  readonly model: string;

  readonly #answers: Map<string, unknown>;
  readonly #fallback: unknown;
  readonly #usage: TokenUsage;
  readonly calls: ProviderRequest[] = [];

  constructor(options: {
    answers?: Readonly<Record<string, unknown>>;
    fallback?: unknown;
    model?: string;
    usage?: TokenUsage;
  }) {
    this.#answers = new Map(Object.entries(options.answers ?? {}));
    this.#fallback = options.fallback;
    this.model = options.model ?? 'scripted-1';
    this.#usage = options.usage ?? { inputTokens: 120, outputTokens: 60 };
  }

  complete(request: ProviderRequest): Promise<ProviderResult> {
    this.calls.push(request);

    const scripted = [...this.#answers.entries()].find(([needle]) => request.user.includes(needle));
    const raw = scripted ? scripted[1] : this.#fallback;

    if (raw === undefined) {
      return Promise.resolve({
        ok: false,
        error: { kind: 'transport', status: null, message: 'No scripted answer for this request.' },
      });
    }

    return Promise.resolve({
      ok: true,
      value: { model: this.model, usage: this.#usage, raw },
    });
  }
}
