import { err, ok, type Result } from '@app/domain';

import type {
  JsonSchema,
  JsonSchemaField,
  OutputRecord,
  OutputValue,
  StructuredOutput,
} from './types.js';

/**
 * The structured-output contract, declared once and used twice.
 *
 * A prompt declares the shape it expects. That single declaration becomes the
 * JSON Schema sent to the provider *and* the validator run over what comes back,
 * so the two cannot drift apart — which matters because a provider honouring a
 * schema is a strong convention, not a guarantee, and the day it returns
 * something else the product must degrade rather than render it.
 *
 * There is deliberately no money field kind. A monetary figure in the product
 * comes from a row or from an engine, and a model asked to restate one would
 * eventually restate it wrong. Prompts receive amounts as pre-formatted
 * grounding strings and may only echo them back; `guardrails.ts` checks that
 * they did.
 */

export type FieldSchema =
  | { readonly kind: 'text'; readonly description: string; readonly maxLength: number }
  | { readonly kind: 'choice'; readonly description: string; readonly options: readonly string[] }
  | {
      readonly kind: 'number';
      readonly description: string;
      readonly minimum: number;
      readonly maximum: number;
    }
  | { readonly kind: 'flag'; readonly description: string }
  | {
      readonly kind: 'text_list';
      readonly description: string;
      readonly maxItems: number;
      readonly itemMaxLength: number;
    }
  | {
      readonly kind: 'record_list';
      readonly description: string;
      readonly maxItems: number;
      readonly fields: RecordShape;
    };

/** Rows inside a `record_list` are flat: nesting past this has no product use. */
export type ScalarFieldSchema = Extract<
  FieldSchema,
  { kind: 'text' } | { kind: 'choice' } | { kind: 'number' } | { kind: 'flag' }
>;

export type RecordShape = Readonly<Record<string, ScalarFieldSchema>>;

export type ObjectShape = Readonly<Record<string, FieldSchema>>;

export function toJsonSchema(shape: ObjectShape): JsonSchema {
  const properties: Record<string, JsonSchemaField> = {};

  for (const [name, field] of Object.entries(shape)) {
    properties[name] = fieldToJsonSchema(field);
  }

  return {
    type: 'object',
    properties,
    // Everything is required. An optional field is a field the model will omit
    // on the day it matters, and a copilot panel with a missing sentence reads
    // like a bug to the household.
    required: Object.keys(shape),
    additionalProperties: false,
  };
}

/**
 * Parses a provider's answer against the declared shape.
 *
 * Collects every problem rather than stopping at the first, because the log line
 * that says "the model dropped two fields and truncated a third" is the one that
 * gets a prompt fixed.
 */
export function parseOutput(
  shape: ObjectShape,
  value: unknown,
): Result<StructuredOutput, readonly string[]> {
  if (!isRecord(value)) {
    return err(['The response was not a JSON object.']);
  }

  const issues: string[] = [];
  const parsed: Record<string, OutputValue> = {};

  for (const [name, field] of Object.entries(shape)) {
    const raw = value[name];
    if (raw === undefined || raw === null) {
      issues.push(`${name}: missing.`);
      continue;
    }

    const result = parseField(name, field, raw);
    if (result.ok) {
      parsed[name] = result.value;
    } else {
      issues.push(...result.error);
    }
  }

  for (const name of Object.keys(value)) {
    if (!(name in shape)) issues.push(`${name}: not part of the declared shape.`);
  }

  return issues.length > 0 ? err(issues) : ok(parsed);
}

/** Every string the model produced, for the guardrail to inspect. */
export function collectText(output: StructuredOutput): string[] {
  const texts: string[] = [];

  for (const value of Object.values(output)) {
    if (typeof value === 'string') {
      texts.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value as readonly (string | OutputRecord)[]) {
        if (typeof item === 'string') {
          texts.push(item);
        } else {
          for (const nested of Object.values(item)) {
            if (typeof nested === 'string') texts.push(nested);
          }
        }
      }
    }
  }

  return texts;
}

function fieldToJsonSchema(field: FieldSchema): JsonSchemaField {
  switch (field.kind) {
    case 'text':
      return { type: 'string', description: field.description, maxLength: field.maxLength };
    case 'choice':
      return { type: 'string', description: field.description, enum: field.options };
    case 'number':
      return {
        type: 'number',
        description: field.description,
        minimum: field.minimum,
        maximum: field.maximum,
      };
    case 'flag':
      return { type: 'boolean', description: field.description };
    case 'text_list':
      return {
        type: 'array',
        description: field.description,
        maxItems: field.maxItems,
        items: { type: 'string', maxLength: field.itemMaxLength },
      };
    case 'record_list':
      return {
        type: 'array',
        description: field.description,
        maxItems: field.maxItems,
        items: toJsonSchema(field.fields),
      };
  }
}

function parseField(
  name: string,
  field: FieldSchema,
  raw: unknown,
): Result<OutputValue, readonly string[]> {
  switch (field.kind) {
    case 'text': {
      if (typeof raw !== 'string') return err([`${name}: expected text.`]);
      if (raw.length > field.maxLength) {
        return err([
          `${name}: ${String(raw.length)} characters, limit ${String(field.maxLength)}.`,
        ]);
      }
      return ok(raw);
    }

    case 'choice': {
      if (typeof raw !== 'string') return err([`${name}: expected one of the listed options.`]);
      if (!field.options.includes(raw)) {
        return err([`${name}: "${raw}" is not one of ${field.options.join(', ')}.`]);
      }
      return ok(raw);
    }

    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return err([`${name}: expected a finite number.`]);
      }
      if (raw < field.minimum || raw > field.maximum) {
        return err([
          `${name}: ${String(raw)} is outside ${String(field.minimum)}–${String(field.maximum)}.`,
        ]);
      }
      return ok(raw);
    }

    case 'flag': {
      if (typeof raw !== 'boolean') return err([`${name}: expected true or false.`]);
      return ok(raw);
    }

    case 'text_list': {
      if (!Array.isArray(raw)) return err([`${name}: expected a list.`]);
      if (raw.length > field.maxItems) {
        return err([`${name}: ${String(raw.length)} items, limit ${String(field.maxItems)}.`]);
      }

      const issues: string[] = [];
      const items: string[] = [];
      raw.forEach((item: unknown, index) => {
        if (typeof item !== 'string') {
          issues.push(`${name}[${String(index)}]: expected text.`);
        } else if (item.length > field.itemMaxLength) {
          issues.push(`${name}[${String(index)}]: longer than ${String(field.itemMaxLength)}.`);
        } else {
          items.push(item);
        }
      });

      return issues.length > 0 ? err(issues) : ok(items);
    }

    case 'record_list': {
      if (!Array.isArray(raw)) return err([`${name}: expected a list.`]);
      if (raw.length > field.maxItems) {
        return err([`${name}: ${String(raw.length)} items, limit ${String(field.maxItems)}.`]);
      }

      const issues: string[] = [];
      const records: OutputRecord[] = [];

      raw.forEach((item: unknown, index) => {
        const nested = parseOutput(field.fields, item);
        if (!nested.ok) {
          issues.push(...nested.error.map((issue) => `${name}[${String(index)}].${issue}`));
          return;
        }
        records.push(nested.value as OutputRecord);
      });

      return issues.length > 0 ? err(issues) : ok(records);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
