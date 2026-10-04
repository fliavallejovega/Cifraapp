import 'server-only';

import { parseOutput, toJsonSchema, type ObjectShape } from '@app/ai';

import { providerFor } from './ai';

/**
 * A suggested category for descriptors no rule or merchant recognised.
 *
 * Without this, a new household's first statements arrived almost entirely
 * uncategorised: there were no rules yet and no merchant had a category, so
 * every line became a question. A model reads the descriptors and picks, from
 * the household's own category list, the one each most likely belongs to.
 *
 * It only ever proposes. What comes back is filed as a suggestion awaiting a
 * person (`needs_review`, source `ai`), never as a decided category — the
 * model is not the authority on where money went. A name it returns that is
 * not in the list is discarded, and so is anything below the floor.
 */

const MAX_DESCRIPTORS = 60;
const FLOOR = 0.5;

export interface CategoryOption {
  readonly id: string;
  readonly name: string;
}

export async function suggestCategories(
  descriptors: readonly string[],
  categories: readonly CategoryOption[],
): Promise<ReadonlyMap<string, { categoryId: string; confidence: number }>> {
  const unique = [...new Set(descriptors)].slice(0, MAX_DESCRIPTORS);
  if (unique.length === 0 || categories.length === 0) return new Map();

  const provider = await providerFor('reading');
  if (provider.id === 'none') return new Map();

  const names = categories.map((category) => category.name);
  const shape = {
    suggestions: {
      kind: 'record_list',
      description: 'One entry per descriptor, in the order given.',
      maxItems: MAX_DESCRIPTORS,
      fields: {
        index: {
          kind: 'number',
          description: 'The descriptor number as given, from 1.',
          minimum: 1,
          maximum: MAX_DESCRIPTORS,
        },
        category: {
          kind: 'choice',
          description: 'The category from the list this spending most likely belongs to.',
          options: names,
        },
        confidence: {
          kind: 'number',
          description: 'How sure, from 0 to 1. Below 0.5 when the descriptor does not say.',
          minimum: 0,
          maximum: 1,
        },
      },
    },
  } as const satisfies ObjectShape;

  const result = await provider.complete({
    system: [
      'You sort bank statement descriptors into a household’s spending categories.',
      'Pick only from the categories given. When a descriptor does not say what',
      'it was — a bare transfer, a code — give a low confidence rather than a guess.',
    ].join('\n'),
    user: [
      'Categories:',
      ...names.map((name) => `- ${name}`),
      '',
      'Descriptors:',
      ...unique.map((descriptor, index) => `${String(index + 1)}. ${descriptor}`),
    ].join('\n'),
    outputSchema: toJsonSchema(shape),
    maxOutputTokens: 4000,
    temperature: 0,
    timeoutMs: 60_000,
  });
  if (!result.ok) return new Map();

  const parsed = parseOutput(shape, result.value.raw);
  if (!parsed.ok) return new Map();

  const byName = new Map(categories.map((category) => [category.name, category.id]));
  const out = new Map<string, { categoryId: string; confidence: number }>();
  const rows = parsed.value['suggestions'];
  for (const entry of Array.isArray(rows) ? rows : []) {
    const record = entry as Readonly<Record<string, unknown>>;
    const index = typeof record['index'] === 'number' ? record['index'] - 1 : -1;
    const descriptor = unique[index];
    const categoryId =
      typeof record['category'] === 'string' ? byName.get(record['category']) : undefined;
    const confidence = typeof record['confidence'] === 'number' ? record['confidence'] : 0;
    if (descriptor && categoryId && confidence >= FLOOR) {
      out.set(descriptor, { categoryId, confidence: Math.min(confidence, 0.84) });
    }
  }
  return out;
}
