import type { ObjectShape } from './schema.js';
import type { AIFeature, Grounding } from './types.js';

/**
 * Every prompt in the product, versioned, in one place.
 *
 * Prompts are not strings buried in components. A prompt is the specification of
 * a model's behaviour — changing one changes what thousands of households are
 * told — so each carries a version, every logged invocation records which
 * version produced it, and a revision is a new version rather than an edit.
 * `allocation-explanation-v2` and `-v1` can then be compared on real logs
 * instead of on recollection.
 *
 * The shared preamble is the part that must never be diluted. It is what stands
 * between a fluent sentence and a household acting on a figure nobody computed.
 */

export const PREAMBLE = [
  'You assist inside a financial system that has already done the arithmetic.',
  '',
  'Rules you must follow exactly:',
  '1. Every figure you write must appear, character for character, in the FACTS',
  '   block below. Never round, restate, convert, total or estimate an amount.',
  '   If a number is not in FACTS, it does not go in your answer.',
  '2. You are explaining a decision that has already been made. You are not',
  '   making it, revising it, or judging whether it was right.',
  '3. Say plainly when the facts do not support an answer. An honest refusal is',
  '   correct behaviour here, not a failure.',
  '4. No financial, tax or legal advice, and no suggestion that a figure is',
  '   final, owed, or filed. Estimates are described as estimates.',
  '5. Write for one household reading one screen: concrete, calm, unhurried, no',
  '   exclamation, no urgency that the facts do not carry.',
].join('\n');

export interface PromptDefinition {
  /** Stable across versions. `allocation-explanation`. */
  readonly key: string;
  readonly version: number;
  /** `allocation-explanation-v1`. Recorded on every invocation. */
  readonly id: string;
  readonly feature: AIFeature;
  readonly instruction: string;
  readonly output: ObjectShape;
  readonly maxOutputTokens: number;
  /**
   * Grounding names this prompt requires. A call missing one is rejected before
   * it reaches a provider — a prompt silently running without a fact produces a
   * confident answer about nothing.
   */
  readonly requires: readonly string[];
  /**
   * Whether the same grounding always deserves the same answer. False for
   * anything about a specific moment in a specific household's month.
   */
  readonly cacheable: boolean;
}

function define(definition: Omit<PromptDefinition, 'id'>): PromptDefinition {
  return { ...definition, id: `${definition.key}-v${String(definition.version)}` };
}

const CONFIDENCE = {
  kind: 'number',
  description: 'How confident you are, from 0 to 1. Be honest; low is useful.',
  minimum: 0,
  maximum: 1,
} as const;

export const MERCHANT_CLASSIFICATION_V1 = define({
  key: 'merchant-classification',
  version: 1,
  feature: 'merchant_classification',
  instruction: [
    'A bank statement descriptor is given. Identify the business behind it and',
    'the kind of spending it represents.',
    '',
    'Return a category *hint* in plain words, not an identifier. The system maps',
    'hints onto its own category tree and discards any it does not recognize —',
    'inventing a plausible-looking identifier helps nobody.',
  ].join('\n'),
  output: {
    merchantName: {
      kind: 'text',
      description: 'The business as a person would name it. Empty if unrecognizable.',
      maxLength: 80,
    },
    categoryHint: {
      kind: 'text',
      description: 'The kind of spending, in plain words: "groceries", "electricity".',
      maxLength: 40,
    },
    isRecurring: {
      kind: 'flag',
      description: 'Whether this descriptor typically represents a subscription or bill.',
    },
    confidence: CONFIDENCE,
    reasoning: {
      kind: 'text',
      description: 'One sentence on what in the descriptor led you there.',
      maxLength: 200,
    },
  },
  maxOutputTokens: 300,
  requires: ['descriptor'],
  cacheable: true,
});

export const ALLOCATION_EXPLANATION_V1 = define({
  key: 'allocation-explanation',
  version: 1,
  feature: 'allocation_explanation',
  instruction: [
    'An allocation plan has been computed. Each line already carries a',
    'deterministic reason. Write the paragraph that sits above them: what this',
    'plan does with the money that arrived, and why in that order.',
    '',
    "The ordering is the product's, not yours. Do not propose a different one.",
  ].join('\n'),
  output: {
    summary: {
      kind: 'text',
      description: 'Two or three sentences describing the plan as a whole.',
      maxLength: 480,
    },
    cautions: {
      kind: 'text_list',
      description: 'Things in the facts worth noticing. Empty list if there are none.',
      maxItems: 3,
      itemMaxLength: 160,
    },
  },
  maxOutputTokens: 500,
  requires: ['incoming', 'lines'],
  cacheable: false,
});

export const ANOMALY_SUMMARY_V1 = define({
  key: 'anomaly-summary',
  version: 1,
  feature: 'anomaly_summary',
  instruction: [
    'A deterministic check found a spending pattern outside its usual range.',
    'Describe it neutrally. A higher electricity bill in a hot month is not an',
    'emergency, and language that treats it as one teaches the household to',
    'ignore the next alert.',
  ].join('\n'),
  output: {
    headline: {
      kind: 'text',
      description: 'One clause, no alarm. "Electricity is above its six-month average."',
      maxLength: 120,
    },
    detail: {
      kind: 'text',
      description: 'One or two sentences of context from the facts.',
      maxLength: 320,
    },
    tone: {
      kind: 'choice',
      description: 'How much attention this genuinely warrants.',
      options: ['informational', 'worth_reviewing'],
    },
  },
  maxOutputTokens: 350,
  requires: ['category', 'observation'],
  cacheable: false,
});

export const BUDGET_SUGGESTION_V1 = define({
  key: 'budget-suggestion',
  version: 1,
  feature: 'budget_suggestion',
  instruction: [
    'Spending statistics per category are given, computed from real history.',
    'Say where a budget would be worth tightening, holding or loosening, and why.',
    '',
    'Do not propose amounts. The system computes those from the same history and',
    'will attach them to the categories you name.',
  ].join('\n'),
  output: {
    rationale: {
      kind: 'text',
      description: "Two sentences on the shape of this household's spending.",
      maxLength: 400,
    },
    categories: {
      kind: 'record_list',
      description: 'One entry per category worth commenting on.',
      maxItems: 8,
      fields: {
        category: {
          kind: 'text',
          description: 'The category name exactly as given in the facts.',
          maxLength: 60,
        },
        emphasis: {
          kind: 'choice',
          description: 'What the history suggests for this category.',
          options: ['reduce', 'hold', 'increase'],
        },
        reason: { kind: 'text', description: 'One short clause.', maxLength: 140 },
      },
    },
  },
  maxOutputTokens: 700,
  requires: ['categories'],
  cacheable: false,
});

export const DOCUMENT_INTERPRETATION_V1 = define({
  key: 'document-interpretation',
  version: 1,
  feature: 'document_interpretation',
  instruction: [
    'Text extracted from an uploaded document is given. Say what kind of document',
    'it is and who issued it.',
    '',
    'Do not extract transactions. Parsing is deterministic and already happened;',
    'a second, softer reading of the same rows is how duplicates are born.',
  ].join('\n'),
  output: {
    documentKind: {
      kind: 'choice',
      description: 'The best fit. Choose unknown rather than guessing.',
      options: ['bank_statement', 'card_statement', 'invoice', 'receipt', 'tax_form', 'unknown'],
    },
    issuer: {
      kind: 'text',
      description: 'The institution or business that issued it. Empty if unclear.',
      maxLength: 80,
    },
    notes: {
      kind: 'text',
      description: 'Anything a person reviewing this should know first.',
      maxLength: 240,
    },
    needsReview: {
      kind: 'flag',
      description: 'True when a person should look before the system relies on this.',
    },
  },
  maxOutputTokens: 350,
  requires: ['excerpt'],
  cacheable: true,
});

export const RULE_PROPOSAL_V1 = define({
  key: 'rule-proposal',
  version: 1,
  feature: 'rule_proposal',
  instruction: [
    'A repeated correction by the household is given. Describe, in words, the',
    'rule that would have prevented it.',
    '',
    'You are drafting something a person will open in the rule builder, read, and',
    'decide about. You are not writing the rule. Never output JSON conditions.',
  ].join('\n'),
  output: {
    name: {
      kind: 'text',
      description: 'A short name the household would recognize.',
      maxLength: 60,
    },
    whenSummary: {
      kind: 'text',
      description: 'The condition, in plain words.',
      maxLength: 200,
    },
    thenSummary: { kind: 'text', description: 'The effect, in plain words.', maxLength: 200 },
    confidence: CONFIDENCE,
  },
  maxOutputTokens: 400,
  requires: ['corrections'],
  cacheable: false,
});

export const SCENARIO_NARRATION_V1 = define({
  key: 'scenario-narration',
  version: 1,
  feature: 'scenario_narration',
  instruction: [
    'A scenario has been simulated deterministically against a copy of the',
    "household's position. The projected figures are given. Describe what the",
    'simulation shows.',
    '',
    'This is a projection, not a forecast of what will happen. Say so.',
  ].join('\n'),
  output: {
    summary: { kind: 'text', description: 'Three sentences at most.', maxLength: 480 },
    risks: {
      kind: 'text_list',
      description: 'What the projection exposes. Empty list if nothing stands out.',
      maxItems: 3,
      itemMaxLength: 160,
    },
    opportunities: {
      kind: 'text_list',
      description: 'What the projection makes possible.',
      maxItems: 3,
      itemMaxLength: 160,
    },
  },
  maxOutputTokens: 600,
  requires: ['scenario', 'projection'],
  cacheable: false,
});

export const QUESTION_ANSWER_V1 = define({
  key: 'question-answer',
  version: 1,
  feature: 'question_answer',
  instruction: [
    'The household asked a question about their own finances. The facts assembled',
    'for it are below.',
    '',
    'If the facts do not answer it, set answerable to false and say what is',
    'missing. A partial answer built on an assumption is worse than none.',
  ].join('\n'),
  output: {
    answer: { kind: 'text', description: 'The answer, or what is missing.', maxLength: 600 },
    usedFacts: {
      kind: 'text_list',
      description: 'The names of the facts you relied on.',
      maxItems: 8,
      itemMaxLength: 60,
    },
    answerable: { kind: 'flag', description: 'Whether the facts supported an answer.' },
  },
  maxOutputTokens: 700,
  requires: ['question'],
  cacheable: false,
});

export const PROMPTS: readonly PromptDefinition[] = [
  MERCHANT_CLASSIFICATION_V1,
  ALLOCATION_EXPLANATION_V1,
  ANOMALY_SUMMARY_V1,
  BUDGET_SUGGESTION_V1,
  DOCUMENT_INTERPRETATION_V1,
  RULE_PROPOSAL_V1,
  SCENARIO_NARRATION_V1,
  QUESTION_ANSWER_V1,
];

export function findPrompt(id: string): PromptDefinition | undefined {
  return PROMPTS.find((prompt) => prompt.id === id);
}

/** The product ships in Spanish and English; the model is told which one. */
export type PromptLocale = 'es' | 'en';

const LANGUAGE: Record<PromptLocale, string> = {
  es: 'Spanish, as spoken in Panama.',
  en: 'English.',
};

export function renderSystem(prompt: PromptDefinition, locale: PromptLocale): string {
  return `${PREAMBLE}\n\nWrite your answer in ${LANGUAGE[locale]}\n\n${prompt.instruction}`;
}

/**
 * The facts block, rendered deterministically.
 *
 * Sorted by name so the same facts produce the same bytes, which is what makes
 * the cache key meaningful and what makes two logged invocations comparable.
 */
export function renderUser(grounding: Grounding): string {
  const lines = Object.keys(grounding)
    .sort()
    .map((name) => `${name}: ${grounding[name] ?? ''}`);

  return `FACTS\n${lines.join('\n')}`;
}

/** Grounding names the prompt declared but the caller did not supply. */
export function missingGrounding(prompt: PromptDefinition, grounding: Grounding): string[] {
  return prompt.requires.filter((name) => {
    const value = grounding[name];
    return value === undefined || value.trim().length === 0;
  });
}
