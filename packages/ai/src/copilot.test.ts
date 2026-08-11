import { describe, expect, it } from 'vitest';

import { InMemoryResponseCache } from './cache.js';
import { invoke } from './copilot.js';
import { pricePerMillionFromDecimal, type ModelPricing } from './cost.js';
import { ALLOCATION_EXPLANATION_V1, MERCHANT_CLASSIFICATION_V1, PROMPTS } from './prompts.js';
import { NullProvider } from './providers/null.js';
import { ScriptedProvider } from './providers/scripted.js';

const PRICING: ModelPricing = {
  provider: 'scripted',
  model: 'scripted-1',
  inputMicrosPerMillion: pricePerMillionFromDecimal('3.00'),
  outputMicrosPerMillion: pricePerMillionFromDecimal('15.00'),
  currency: 'USD',
};

const pricing = () => PRICING;

const GROUNDING = {
  incoming: '$2,400.00',
  lines: 'Rent $1,200.00 · Card minimum $185.00',
};

const GOOD_ANSWER = {
  summary: 'The $2,400.00 that arrived covers rent of $1,200.00 and the $185.00 card minimum.',
  cautions: [],
};

describe('prompt registry', () => {
  it('gives every prompt a unique versioned identifier', () => {
    const ids = PROMPTS.map((prompt) => prompt.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('allocation-explanation-v1');
  });

  it('only marks a prompt cacheable when the same facts deserve the same answer', () => {
    expect(MERCHANT_CLASSIFICATION_V1.cacheable).toBe(true);
    expect(ALLOCATION_EXPLANATION_V1.cacheable).toBe(false);
  });
});

describe('invoke', () => {
  it('refuses before the provider when a declared fact is missing', async () => {
    const provider = new ScriptedProvider({ fallback: GOOD_ANSWER });

    const result = await invoke({
      prompt: ALLOCATION_EXPLANATION_V1,
      grounding: { incoming: '$2,400.00' },
      locale: 'en',
      provider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'missing_grounding') {
      expect(result.error.names).toEqual(['lines']);
    }
    expect(provider.calls).toHaveLength(0);
  });

  it('returns a parsed answer and what it cost', async () => {
    const provider = new ScriptedProvider({ fallback: GOOD_ANSWER });

    const result = await invoke({
      prompt: ALLOCATION_EXPLANATION_V1,
      grounding: GROUNDING,
      locale: 'en',
      provider,
      pricing,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.output['summary']).toContain('$2,400.00');
      expect(result.value.record.promptId).toBe('allocation-explanation-v1');
      expect(result.value.record.cacheHit).toBe(false);
      // 120 input at $3/M plus 60 output at $15/M.
      expect(result.value.record.costMicros).toBe(1_260n);
    }
  });

  it('sends the facts sorted, so the same question renders the same bytes', async () => {
    const provider = new ScriptedProvider({ fallback: GOOD_ANSWER });

    await invoke({
      prompt: ALLOCATION_EXPLANATION_V1,
      grounding: GROUNDING,
      locale: 'en',
      provider,
    });

    expect(provider.calls[0]?.user).toBe(
      'FACTS\nincoming: $2,400.00\nlines: Rent $1,200.00 · Card minimum $185.00',
    );
    expect(provider.calls[0]?.temperature).toBe(0);
  });

  it('rejects an answer carrying a figure the facts did not', async () => {
    const provider = new ScriptedProvider({
      fallback: {
        summary: 'The $2,400.00 leaves roughly $900 to spend this month.',
        cautions: [],
      },
    });

    const result = await invoke({
      prompt: ALLOCATION_EXPLANATION_V1,
      grounding: GROUNDING,
      locale: 'en',
      provider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'ungrounded_figures') {
      expect(result.error.figures).toEqual(['900']);
    }
  });

  it('rejects an answer that does not match the declared shape', async () => {
    const provider = new ScriptedProvider({ fallback: { summary: 'Fine.' } });

    const result = await invoke({
      prompt: ALLOCATION_EXPLANATION_V1,
      grounding: GROUNDING,
      locale: 'en',
      provider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'malformed_output') {
      expect(result.error.issues).toEqual(['cautions: missing.']);
    }
  });

  it('answers a repeatable question once', async () => {
    const provider = new ScriptedProvider({
      fallback: {
        merchantName: 'Supermercado Rey',
        categoryHint: 'groceries',
        isRecurring: false,
        confidence: 0.9,
        reasoning: 'The descriptor names a supermarket chain.',
      },
    });
    const cache = new InMemoryResponseCache();
    const grounding = { descriptor: 'SUPERMERCADO REY 04 PANAMA' };

    const first = await invoke({
      prompt: MERCHANT_CLASSIFICATION_V1,
      grounding,
      locale: 'en',
      provider,
      pricing,
      cache,
    });
    const second = await invoke({
      prompt: MERCHANT_CLASSIFICATION_V1,
      grounding,
      locale: 'en',
      provider,
      pricing,
      cache,
    });

    expect(first.ok && second.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
    if (second.ok) {
      expect(second.value.record.cacheHit).toBe(true);
      // A served cache entry costs nothing and must not be billed again.
      expect(second.value.record.costMicros).toBe(0n);
    }
  });

  it('does not reuse an answer across locales', async () => {
    const provider = new ScriptedProvider({
      fallback: {
        merchantName: 'Supermercado Rey',
        categoryHint: 'groceries',
        isRecurring: false,
        confidence: 0.9,
        reasoning: 'The descriptor names a supermarket chain.',
      },
    });
    const cache = new InMemoryResponseCache();
    const grounding = { descriptor: 'SUPERMERCADO REY 04 PANAMA' };

    await invoke({ prompt: MERCHANT_CLASSIFICATION_V1, grounding, locale: 'en', provider, cache });
    await invoke({ prompt: MERCHANT_CLASSIFICATION_V1, grounding, locale: 'es', provider, cache });

    expect(provider.calls).toHaveLength(2);
  });

  it('stops at the budget instead of crossing it once', async () => {
    const provider = new ScriptedProvider({ fallback: GOOD_ANSWER });

    const result = await invoke({
      prompt: ALLOCATION_EXPLANATION_V1,
      grounding: GROUNDING,
      locale: 'en',
      provider,
      pricing,
      budget: { capMicros: 1_000n, spentMicros: 900n, currency: 'USD' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('budget_exhausted');
    expect(provider.calls).toHaveLength(0);
  });

  it('reports an unconfigured deployment as an ordinary outcome', async () => {
    const result = await invoke({
      prompt: ALLOCATION_EXPLANATION_V1,
      grounding: GROUNDING,
      locale: 'en',
      provider: new NullProvider(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('not_configured');
  });

  it('asks the model to answer in the household language', async () => {
    const provider = new ScriptedProvider({ fallback: GOOD_ANSWER });

    await invoke({
      prompt: ALLOCATION_EXPLANATION_V1,
      grounding: GROUNDING,
      locale: 'es',
      provider,
    });

    expect(provider.calls[0]?.system).toContain('Spanish, as spoken in Panama.');
  });
});
