import { Money, toPlainDate, type PlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { classifyExpense, deductiblePercentage, DEFAULT_CATEGORY_POLICY } from './classify.js';
import { estimateIncomeTax } from './estimate.js';
import { PANAMA_2026_DRAFT } from './jurisdictions/pa-2026.js';
import { computeReserve } from './reserve.js';
import { mayPresent, selectRuleSet, validateRuleSet } from './rules.js';
import type { RuleProvenance, TaxRuleSet, TaxpayerProfile } from './types.js';

const pab = (value: string) => Money.fromDecimalString(value, 'PAB');

const REVIEWED: RuleProvenance = {
  source: 'Test authority',
  sourceUrl: null,
  sourceReference: 'Test article 1',
  notes: null,
  reviewedBy: 'A reviewer',
  reviewedAt: '2026-01-02',
};

/** A published copy of the draft, for the cases that need a presentable set. */
const PUBLISHED: TaxRuleSet = {
  ...PANAMA_2026_DRAFT,
  version: 2,
  status: 'published',
  rules: PANAMA_2026_DRAFT.rules.map((rule) => ({ ...rule, provenance: REVIEWED })),
};

const INDEPENDENT: TaxpayerProfile = {
  jurisdiction: 'PA',
  status: 'independent_professional',
  ruc: null,
  activity: null,
  accountingMethod: 'cash',
  itbmsRegistered: false,
  fiscalYearStart: '01-01',
};

describe('rule sets', () => {
  it('keeps the shipped Panama set unreviewed and unpresentable', () => {
    // The single most important assertion in this package. If this ever passes
    // with `published`, somebody has flipped a status to make a screen work.
    expect(PANAMA_2026_DRAFT.status).toBe('draft');
    expect(mayPresent(PANAMA_2026_DRAFT)).toBe(false);

    for (const rule of PANAMA_2026_DRAFT.rules) {
      expect(rule.provenance.reviewedBy).toBeNull();
      expect(rule.provenance.reviewedAt).toBeNull();
      expect(rule.provenance.sourceReference.length).toBeGreaterThan(0);
    }
  });

  it('accepts a set whose bands are contiguous', () => {
    expect(validateRuleSet(PANAMA_2026_DRAFT).ok).toBe(true);
  });

  it('refuses to publish a rule nobody reviewed', () => {
    const result = validateRuleSet({ ...PANAMA_2026_DRAFT, status: 'published' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.includes('without a reviewer'))).toBe(true);
    }
  });

  it('catches a gap between bands, which would exempt income silently', () => {
    const broken: TaxRuleSet = {
      ...PANAMA_2026_DRAFT,
      rules: [
        {
          kind: 'brackets',
          key: 'income.brackets',
          taxType: 'income',
          brackets: [
            { from: pab('0'), upTo: pab('11000.00'), rate: '0.000' },
            { from: pab('12000.00'), upTo: null, rate: '15.000' },
          ],
          provenance: REVIEWED,
        },
      ],
    };

    const result = validateRuleSet(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.includes('does not continue'))).toBe(true);
    }
  });

  it('selects the set in force on a date', () => {
    const on = toPlainDate('2026-06-01');
    expect(selectRuleSet([PANAMA_2026_DRAFT], 'PA', on)?.fiscalYear).toBe(2026);
    expect(selectRuleSet([PANAMA_2026_DRAFT], 'PA', '2025-06-01' as PlainDate)).toBeUndefined();
    expect(selectRuleSet([PANAMA_2026_DRAFT], 'CR', on)).toBeUndefined();
  });

  it('prefers the highest version when two sets overlap', () => {
    const set = selectRuleSet([PANAMA_2026_DRAFT, PUBLISHED], 'PA', toPlainDate('2026-06-01'));
    expect(set?.version).toBe(2);
  });
});

describe('income tax', () => {
  const estimate = (gross: string) =>
    estimateIncomeTax({ ruleSet: PUBLISHED, grossIncome: pab(gross), deductions: [] });

  it('charges nothing below the first threshold', () => {
    const result = estimate('10000.00');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.estimatedTax.isZero()).toBe(true);
      expect(result.value.effectiveRate).toBe(0);
    }
  });

  it('taxes only the slice above a threshold, not the whole amount', () => {
    // The most common misunderstanding of a progressive system, and the one that
    // makes an estimate wrong in the direction that stops people earning more.
    const result = estimate('20000.00');
    expect(result.ok).toBe(true);
    // 9 000 over the threshold at 15%.
    if (result.ok) expect(result.value.estimatedTax.toDecimalString()).toBe('1350.0000');
  });

  it('reaches the documented figure at the top of the second band', () => {
    const result = estimate('50000.00');
    if (result.ok) expect(result.value.estimatedTax.toDecimalString()).toBe('5850.0000');
  });

  it('applies the top rate only above the top threshold', () => {
    const result = estimate('80000.00');
    // 5 850 plus 25% of 30 000.
    if (result.ok) expect(result.value.estimatedTax.toDecimalString()).toBe('13350.0000');
  });

  it('keeps the lines adding up to the total', () => {
    const result = estimate('80000.00');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const summed = Money.sum(
        result.value.lines.map((line) => line.amount),
        'PAB',
      );
      expect(summed.equals(result.value.estimatedTax)).toBe(true);
    }
  });

  it('records the rule set that produced it', () => {
    const result = estimate('20000.00');
    if (result.ok) {
      expect(result.value.ruleSetVersion).toBe(2);
      expect(result.value.presentable).toBe(true);
    }
  });

  it('will not present a figure from an unreviewed set', () => {
    const result = estimateIncomeTax({
      ruleSet: PANAMA_2026_DRAFT,
      grossIncome: pab('20000.00'),
      deductions: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // It computes — that is how a draft gets checked — and it is not shown.
      expect(result.value.estimatedTax.isPositive()).toBe(true);
      expect(result.value.presentable).toBe(false);
    }
  });

  it('ignores a deduction no rule backs', () => {
    const result = estimateIncomeTax({
      ruleSet: PUBLISHED,
      grossIncome: pab('20000.00'),
      deductions: [{ key: 'invented.deduction', label: 'Invented', amount: pab('5000.00') }],
    });

    if (result.ok) {
      expect(result.value.deductions.isZero()).toBe(true);
      expect(result.value.estimatedTax.toDecimalString()).toBe('1350.0000');
    }
  });

  it('caps a deduction at the rule that allows it', () => {
    const withDeduction: TaxRuleSet = {
      ...PUBLISHED,
      rules: [
        ...PUBLISHED.rules,
        {
          kind: 'deduction',
          key: 'deduction.capped',
          taxType: 'income',
          deduction: {
            key: 'deduction.capped',
            label: 'Capped',
            cap: pab('1000.00'),
            rate: '100.000',
            provenance: REVIEWED,
          },
          provenance: REVIEWED,
        },
      ],
    };

    const result = estimateIncomeTax({
      ruleSet: withDeduction,
      grossIncome: pab('20000.00'),
      deductions: [{ key: 'deduction.capped', label: 'Capped', amount: pab('8000.00') }],
    });

    if (result.ok) {
      expect(result.value.deductions.toDecimalString()).toBe('1000.0000');
      expect(result.value.taxableIncome.toDecimalString()).toBe('19000.0000');
    }
  });

  it('refuses income in a currency the rules do not cover', () => {
    const result = estimateIncomeTax({
      ruleSet: PUBLISHED,
      grossIncome: Money.fromDecimalString('20000.00', 'USD'),
      deductions: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('currency_mismatch');
  });
});

describe('tax reserve', () => {
  const annual = estimateIncomeTax({
    ruleSet: PUBLISHED,
    grossIncome: pab('60000.00'),
    deductions: [],
  });

  it('reserves in proportion to the income that has actually arrived', () => {
    expect(annual.ok).toBe(true);
    if (!annual.ok) return;

    // 8 350 of tax on 60 000 projected; a third of the year has arrived.
    const result = computeReserve({
      annual: annual.value,
      incomeToDate: pab('20000.00'),
      reservedToDate: pab('0'),
    });

    expect(annual.value.estimatedTax.toDecimalString()).toBe('8350.0000');
    expect(result.target.toDecimalString()).toBe('2783.3333');
    expect(result.additional.equals(result.target)).toBe(true);
  });

  it('asks for nothing more when the household is ahead', () => {
    if (!annual.ok) return;

    const result = computeReserve({
      annual: annual.value,
      incomeToDate: pab('20000.00'),
      reservedToDate: pab('3000.00'),
    });

    expect(result.additional.isZero()).toBe(true);
    expect(result.surplus.toDecimalString()).toBe('216.6667');
  });

  it('never reserves more than the year is estimated to owe', () => {
    if (!annual.ok) return;

    const result = computeReserve({
      annual: annual.value,
      incomeToDate: pab('90000.00'),
      reservedToDate: pab('0'),
    });

    expect(result.target.equals(annual.value.estimatedTax)).toBe(true);
  });

  it('carries the presentability of the rules it came from', () => {
    const draft = estimateIncomeTax({
      ruleSet: PANAMA_2026_DRAFT,
      grossIncome: pab('60000.00'),
      deductions: [],
    });

    if (!draft.ok) return;
    const result = computeReserve({
      annual: draft.value,
      incomeToDate: pab('20000.00'),
      reservedToDate: pab('0'),
    });

    expect(result.presentable).toBe(false);
  });
});

describe('expense classification', () => {
  const base = { taxpayer: INDEPENDENT, merchantName: null, hasDocument: false };

  it('lets the household overrule every heuristic', () => {
    const result = classifyExpense({
      ...base,
      categorySlug: 'groceries',
      override: { classification: 'BUSINESS', businessPercentage: 100 },
    });

    expect(result.classification).toBe('BUSINESS');
    expect(result.needsPerson).toBe(false);
  });

  it('treats a salaried taxpayer as having no business expenses', () => {
    const result = classifyExpense({
      ...base,
      taxpayer: { ...INDEPENDENT, status: 'salaried' },
      categorySlug: 'business-software',
    });

    expect(result.classification).toBe('PERSONAL');
  });

  it('never reaches BUSINESS on inference alone', () => {
    const withDocument = classifyExpense({
      ...base,
      categorySlug: 'business-software',
      hasDocument: true,
    });

    expect(withDocument.classification).toBe('POTENTIALLY_DEDUCTIBLE');
    expect(withDocument.needsPerson).toBe(true);
  });

  it('leaves a mixed-use split to the person who knows it', () => {
    const result = classifyExpense({ ...base, categorySlug: 'transportation-fuel' });

    expect(result.classification).toBe('MIXED');
    expect(result.businessPercentage).toBe(0);
    expect(result.needsPerson).toBe(true);
  });

  it('marks a transfer as never deductible', () => {
    const result = classifyExpense({ ...base, categorySlug: 'transfers-card-payment' });
    expect(result.classification).toBe('NON_DEDUCTIBLE');
  });

  it('asks rather than guesses when nothing is known', () => {
    expect(classifyExpense({ ...base, categorySlug: null }).classification).toBe('REQUIRES_REVIEW');
    expect(classifyExpense({ ...base, categorySlug: 'other' }).classification).toBe(
      'REQUIRES_REVIEW',
    );
  });

  it('deducts nothing that has not been confirmed', () => {
    const potential = classifyExpense({ ...base, categorySlug: 'business-services' });
    expect(deductiblePercentage(potential)).toBe(0);

    const confirmed = classifyExpense({
      ...base,
      categorySlug: 'business-services',
      override: { classification: 'MIXED', businessPercentage: 60 },
    });
    expect(deductiblePercentage(confirmed)).toBe(60);
  });

  it('keeps the default policy free of unreviewed claims', () => {
    // Every slug in this list is a claim about deductibility. The test exists so
    // that adding one is a deliberate act with a diff, not a quiet edit.
    expect(DEFAULT_CATEGORY_POLICY.potentiallyBusiness).toEqual([
      'business',
      'business-software',
      'business-services',
      'business-supplies',
      'education',
    ]);
  });
});
