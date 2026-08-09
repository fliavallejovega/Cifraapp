import { Money, toPlainDate } from '@app/domain';
import { normalizeDescription } from '@app/transaction-engine';
import { describe, expect, it } from 'vitest';

import {
  AI_CONFIDENCE_CEILING,
  AUTO_APPLY_THRESHOLD,
  classify,
  shouldConsultAi,
} from './classify.js';
import { orderRules } from './rules.js';
import type {
  ClassifiableTransaction,
  ClassificationContext,
  MerchantRecord,
  MerchantRule,
} from './types.js';

const SOFTWARE = 'category-software';
const ENTERTAINMENT = 'category-entertainment';
const GROCERIES = 'category-groceries';

function transaction(description: string, date = '2026-07-15'): ClassifiableTransaction {
  return {
    id: 'txn-1',
    descriptionNormalized: normalizeDescription(description).normalized,
    amount: Money.fromDecimalString('54.99', 'USD'),
    direction: 'outflow',
    transactionDate: toPlainDate(date),
  };
}

function rule(
  overrides: Partial<MerchantRule> & Pick<MerchantRule, 'id' | 'pattern'>,
): MerchantRule {
  return {
    matchKind: 'contains',
    merchantId: null,
    categoryId: SOFTWARE,
    taxClassification: null,
    businessPercentage: null,
    source: 'user',
    confidence: 1,
    priority: 100,
    isActive: true,
    effectiveFrom: null,
    effectiveTo: null,
    ...overrides,
  };
}

function merchant(overrides: Partial<MerchantRecord> & Pick<MerchantRecord, 'id'>): MerchantRecord {
  return {
    name: 'Super 99',
    normalizedName: 'super99',
    aliases: [],
    defaultCategoryId: GROCERIES,
    ...overrides,
  };
}

const empty: ClassificationContext = { rules: [], merchants: [] };

describe('the categorization ladder', () => {
  it('applies a user rule and says so', () => {
    const result = classify(transaction('ADOBE INC 800-833-6687'), {
      ...empty,
      rules: [rule({ id: 'r1', pattern: 'adobe' })],
    });

    expect(result.categoryId).toBe(SOFTWARE);
    expect(result.source).toBe('user');
    expect(result.confidence).toBe(1);
    expect(result.needsReview).toBe(false);
    expect(result.appliedRuleId).toBe('r1');
    expect(result.explanation).toContain('Your rule');
  });

  it('lets a user rule beat a confident model suggestion', () => {
    // The product's central promise about AI, made mechanical: a person who
    // stated something outranks a model that inferred it.
    const result = classify(transaction('ADOBE INC'), {
      ...empty,
      rules: [rule({ id: 'r1', pattern: 'adobe' })],
      aiSuggestion: { categoryId: ENTERTAINMENT, confidence: 0.99, promptVersion: 'v1' },
    });

    expect(result.categoryId).toBe(SOFTWARE);
    expect(result.source).toBe('user');
  });

  it('lets an accountant rule beat a user rule', () => {
    const result = classify(transaction('ADOBE INC'), {
      ...empty,
      rules: [
        rule({ id: 'r1', pattern: 'adobe', source: 'user', categoryId: ENTERTAINMENT }),
        rule({ id: 'r2', pattern: 'adobe', source: 'accountant', categoryId: SOFTWARE }),
      ],
    });

    expect(result.categoryId).toBe(SOFTWARE);
    expect(result.source).toBe('accountant');
  });

  it('falls back to the merchant the household already knows', () => {
    const result = classify(transaction('SUPER99 #034'), {
      ...empty,
      merchants: [merchant({ id: 'm1' })],
    });

    expect(result.categoryId).toBe(GROCERIES);
    expect(result.merchantId).toBe('m1');
    expect(result.source).toBe('system');
  });

  it('does not launder a fuzzy merchant match into a confident category', () => {
    const result = classify(transaction('SUPERMERCADO 99 COSTA'), {
      ...empty,
      merchants: [merchant({ id: 'm1', normalizedName: 'supermercado99costa del este' })],
    });

    if (result.categoryId !== null) {
      expect(result.confidence).toBeLessThan(1);
      expect(result.needsReview).toBe(result.confidence < AUTO_APPLY_THRESHOLD);
    }
  });

  it('never auto-applies a model suggestion', () => {
    const result = classify(transaction('SOME NEW SHOP'), {
      ...empty,
      aiSuggestion: { categoryId: ENTERTAINMENT, confidence: 1, promptVersion: 'v1' },
    });

    expect(result.source).toBe('ai');
    expect(result.confidence).toBeLessThanOrEqual(AI_CONFIDENCE_CEILING);
    expect(result.needsReview).toBe(true);
  });

  it('routes an unknown description to review rather than guessing', () => {
    const result = classify(transaction('XJ4 92831'), empty);

    expect(result.categoryId).toBeNull();
    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBe(0);
  });

  it('speaks in the product register, never "AI detected"', () => {
    const result = classify(transaction('SOME NEW SHOP'), {
      ...empty,
      aiSuggestion: { categoryId: ENTERTAINMENT, confidence: 0.9, promptVersion: 'v1' },
    });

    expect(result.explanation).not.toMatch(/\bAI\b/);
    expect(result.explanation.toLowerCase()).not.toContain('model');
  });
});

describe('rule validity windows', () => {
  it('ignores a rule that has expired', () => {
    const result = classify(transaction('ADOBE INC', '2026-07-15'), {
      ...empty,
      rules: [rule({ id: 'r1', pattern: 'adobe', effectiveTo: toPlainDate('2026-06-30') })],
    });

    expect(result.categoryId).toBeNull();
  });

  it('ignores a rule that has not started', () => {
    const result = classify(transaction('ADOBE INC', '2026-07-15'), {
      ...empty,
      rules: [rule({ id: 'r1', pattern: 'adobe', effectiveFrom: toPlainDate('2026-08-01') })],
    });

    expect(result.categoryId).toBeNull();
  });

  it('ignores a deactivated rule', () => {
    const result = classify(transaction('ADOBE INC'), {
      ...empty,
      rules: [rule({ id: 'r1', pattern: 'adobe', isActive: false })],
    });

    expect(result.categoryId).toBeNull();
  });
});

describe('rule ordering', () => {
  it('prefers the more specific pattern at equal authority and priority', () => {
    const ordered = orderRules([
      rule({ id: 'broad', pattern: 'adobe', matchKind: 'contains' }),
      rule({ id: 'exact', pattern: 'adobe creative cloud', matchKind: 'equals' }),
    ]);

    expect(ordered[0]?.id).toBe('exact');
  });

  it('is stable when two rules are otherwise identical', () => {
    // Determinism is not a nicety here. The same import must categorize the same
    // way every run, or a disputed figure cannot be reproduced.
    const a = rule({ id: 'aaa', pattern: 'adobe' });
    const b = rule({ id: 'bbb', pattern: 'adobe' });

    expect(orderRules([a, b]).map((r) => r.id)).toEqual(['aaa', 'bbb']);
    expect(orderRules([b, a]).map((r) => r.id)).toEqual(['aaa', 'bbb']);
  });
});

describe('mixed tax classification', () => {
  it('refuses a mixed classification with no business percentage', () => {
    // The database rejects the pair outright. Catching it here sends the row to
    // review instead of to a constraint violation halfway through an import.
    const result = classify(transaction('CLARO INTERNET'), {
      ...empty,
      rules: [rule({ id: 'r1', pattern: 'claro', taxClassification: 'mixed' })],
    });

    expect(result.taxClassification).toBeNull();
    expect(result.needsReview).toBe(true);
  });

  it('keeps a mixed classification that carries its percentage', () => {
    const result = classify(transaction('CLARO INTERNET'), {
      ...empty,
      rules: [
        rule({
          id: 'r1',
          pattern: 'claro',
          taxClassification: 'mixed',
          businessPercentage: '40.00',
        }),
      ],
    });

    expect(result.taxClassification).toBe('mixed');
    expect(result.businessPercentage).toBe('40.00');
    expect(result.needsReview).toBe(false);
  });
});

describe('when the model is worth consulting', () => {
  it('is not, when a rule already answers', () => {
    expect(
      shouldConsultAi(transaction('ADOBE INC'), {
        ...empty,
        rules: [rule({ id: 'r1', pattern: 'adobe' })],
      }),
    ).toBe(false);
  });

  it('is not, when the merchant is already established', () => {
    expect(
      shouldConsultAi(transaction('SUPER99 #034'), {
        ...empty,
        merchants: [merchant({ id: 'm1' })],
      }),
    ).toBe(false);
  });

  it('is, when nothing deterministic resolves it', () => {
    expect(shouldConsultAi(transaction('SOME NEW SHOP'), empty)).toBe(true);
  });

  it('is, when the merchant is known but has settled on no category', () => {
    expect(
      shouldConsultAi(transaction('SUPER99 #034'), {
        ...empty,
        merchants: [merchant({ id: 'm1', defaultCategoryId: null })],
      }),
    ).toBe(true);
  });
});
