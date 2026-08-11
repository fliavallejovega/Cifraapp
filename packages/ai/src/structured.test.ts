import { Money } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { checkBudget, projectMicros, WARN_AT_FRACTION } from './budget.js';
import { microsToMoney, moneyToMicros, pricePerMillionFromDecimal, usageMicros } from './cost.js';
import { extractFigures, ungroundedFigures } from './guardrails.js';
import { collectText, parseOutput, toJsonSchema, type ObjectShape } from './schema.js';

const PRICING = {
  provider: 'anthropic' as const,
  model: 'test',
  inputMicrosPerMillion: pricePerMillionFromDecimal('3.00'),
  outputMicrosPerMillion: pricePerMillionFromDecimal('15.00'),
  currency: 'USD' as const,
};

describe('cost', () => {
  it('reads a price per million tokens as exact micro-dollars', () => {
    expect(pricePerMillionFromDecimal('3.00')).toBe(3_000_000n);
    expect(pricePerMillionFromDecimal('0.25')).toBe(250_000n);
    expect(pricePerMillionFromDecimal('1.234567')).toBe(1_234_567n);
  });

  it('rejects a price it cannot represent exactly', () => {
    expect(() => pricePerMillionFromDecimal('3.0000001')).toThrow(TypeError);
  });

  it('costs a call in micro-dollars', () => {
    // 1 000 input at $3/M is $0.003; 500 output at $15/M is $0.0075.
    expect(usageMicros(PRICING, { inputTokens: 1_000, outputTokens: 500 })).toBe(10_500n);
  });

  it('keeps a month of small calls out of the rounding gap', () => {
    // One classification costs $0.00126, which four decimals cannot hold. Round
    // per call and a thousand of them report $1.30; accumulate in micros and
    // they report the $1.26 that was actually spent. Four cents per thousand
    // calls is the drift this unit of account exists to avoid.
    const one = usageMicros(PRICING, { inputTokens: 120, outputTokens: 60 });
    expect(one).toBe(1_260n);
    expect(microsToMoney(one, 'USD').toDecimalString()).toBe('0.0013');

    expect(microsToMoney(one * 1_000n, 'USD').toDecimalString()).toBe('1.2600');
  });

  it('round-trips a stored budget cap', () => {
    const cap = Money.fromDecimalString('25.0000', 'USD');
    expect(microsToMoney(moneyToMicros(cap), 'USD').equals(cap)).toBe(true);
  });
});

describe('budget', () => {
  const state = { capMicros: 1_000_000n, spentMicros: 0n, currency: 'USD' as const };

  it('treats an unset cap as no cap', () => {
    expect(checkBudget({ ...state, capMicros: 0n }, 10_000_000n).decision).toBe('allow');
  });

  it('denies before the call rather than after it', () => {
    const verdict = checkBudget({ ...state, spentMicros: 900_000n }, 200_000n);
    expect(verdict.decision).toBe('deny');

    if (verdict.decision === 'deny') {
      expect(verdict.failure.cap.toDecimalString()).toBe('1.0000');
      expect(verdict.failure.spent.toDecimalString()).toBe('0.9000');
    }
  });

  it('warns before the ceiling', () => {
    const verdict = checkBudget({ ...state, spentMicros: 850_000n }, 0n);
    expect(verdict.decision).toBe('warn');
    if (verdict.decision === 'warn') {
      expect(verdict.fractionUsed).toBeGreaterThanOrEqual(WARN_AT_FRACTION);
    }
  });

  it('projects the whole output allowance, not a hopeful fraction of it', () => {
    const projected = projectMicros(
      1_000,
      500,
      PRICING.inputMicrosPerMillion,
      PRICING.outputMicrosPerMillion,
    );
    expect(projected).toBe(10_500n);
  });
});

const SHAPE: ObjectShape = {
  summary: { kind: 'text', description: 'A sentence.', maxLength: 20 },
  tone: { kind: 'choice', description: 'Tone.', options: ['calm', 'urgent'] },
  confidence: { kind: 'number', description: 'Confidence.', minimum: 0, maximum: 1 },
  reviewed: { kind: 'flag', description: 'Reviewed.' },
  notes: { kind: 'text_list', description: 'Notes.', maxItems: 2, itemMaxLength: 10 },
};

const VALID = {
  summary: 'Rent is covered.',
  tone: 'calm',
  confidence: 0.9,
  reviewed: true,
  notes: ['on time'],
};

describe('structured output', () => {
  it('builds a closed JSON Schema from the declared shape', () => {
    const schema = toJsonSchema(SHAPE);

    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['summary', 'tone', 'confidence', 'reviewed', 'notes']);
    expect(schema.properties['tone']).toMatchObject({ type: 'string', enum: ['calm', 'urgent'] });
  });

  it('accepts an answer that matches', () => {
    const parsed = parseOutput(SHAPE, VALID);
    expect(parsed.ok).toBe(true);
  });

  it('reports every problem at once', () => {
    const parsed = parseOutput(SHAPE, {
      summary: 'A summary far longer than the declared limit.',
      tone: 'panicked',
      confidence: 4,
      notes: ['one', 'two', 'three'],
      extra: 'unasked for',
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toHaveLength(6);
      expect(parsed.error.join(' ')).toContain('reviewed: missing');
      expect(parsed.error.join(' ')).toContain('not part of the declared shape');
    }
  });

  it('parses rows inside a record list', () => {
    const shape: ObjectShape = {
      categories: {
        kind: 'record_list',
        description: 'Categories.',
        maxItems: 2,
        fields: {
          category: { kind: 'text', description: 'Name.', maxLength: 20 },
          emphasis: { kind: 'choice', description: 'Emphasis.', options: ['reduce', 'hold'] },
        },
      },
    };

    const parsed = parseOutput(shape, {
      categories: [{ category: 'Groceries', emphasis: 'hold' }],
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(collectText(parsed.value)).toContain('Groceries');
  });

  it('collects every string a model produced, nested ones included', () => {
    const parsed = parseOutput(SHAPE, VALID);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(collectText(parsed.value)).toEqual(['Rent is covered.', 'calm', 'on time']);
    }
  });
});

describe('guardrails', () => {
  const grounding = { balance: '$4,180.00', rate: '18.9%' };

  it('normalizes a figure so a reformatted amount is not called invented', () => {
    expect(extractFigures('$4,180.00')).toContain('4180');
    expect(extractFigures('4180')).toContain('4180');
    expect(extractFigures('4 180,00')).toContain('4180');
  });

  it('passes an answer that only restates what it was given', () => {
    const figures = ungroundedFigures(
      ['Your balance of $4,180.00 covers rent.', 'The card charges 18.9%.'],
      grounding,
    );

    expect(figures).toEqual([]);
  });

  it('catches a plausible number nobody computed', () => {
    const figures = ungroundedFigures(['That leaves about $1,400 for the month.'], grounding);
    expect(figures).toEqual(['1400']);
  });

  it('catches an amount that was rounded on the way out', () => {
    // The failure this exists for: fluent, close, and wrong.
    expect(ungroundedFigures(['You have around $4,200.'], grounding)).toEqual(['4200']);
  });

  it('lets a caller vouch for a figure it computed itself', () => {
    const figures = ungroundedFigures(['Over the last 6 months.'], grounding, { allow: ['6'] });
    expect(figures).toEqual([]);
  });
});
