import type { AIProvider, ProviderResult } from '../types.js';

/**
 * The provider used when no key is configured.
 *
 * It exists so that "AI is switched off" is an ordinary, typed outcome rather
 * than a crash or a silently missing panel. Every copilot surface has to render
 * something sensible for `not_configured`, and having this in the union from the
 * first day is what forces that.
 */
export class NullProvider implements AIProvider {
  readonly id = 'none' as const;
  readonly model = 'none';

  complete(): Promise<ProviderResult> {
    return Promise.resolve({ ok: false, error: { kind: 'not_configured' } });
  }
}
