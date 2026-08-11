import { err, Money, ok, type Result } from '@app/domain';

import { findRule, mayPresent } from './rules.js';
import type { TaxBracket, TaxEstimate, TaxEstimateLine, TaxProblem, TaxRuleSet } from './types.js';

/**
 * The estimate.
 *
 * Every figure is traceable: each line names the rule that produced it, and the
 * estimate carries the rule set version and status, so a number shown in March
 * can still be explained in November after the rules have moved twice.
 *
 * Two conservative choices, both deliberate:
 *
 *   **A deduction with no rule behind it counts for nothing.** Claiming one that
 *   turns out not to exist lowers a reserve a household was relying on, and they
 *   find out in April.
 *
 *   **Bands are rounded individually and the total is their sum.** Computing the
 *   total exactly and then rounding would leave the displayed lines not adding
 *   up to the displayed total, which in a financial product reads as a bug and
 *   is impossible to explain. The bias this trades for is at most half of a
 *   hundredth of a cent per band.
 */

export const INCOME_BRACKETS_KEY = 'income.brackets';

export interface ClaimedDeduction {
  readonly key: string;
  readonly label: string;
  readonly amount: Money;
}

export interface EstimateInput {
  readonly ruleSet: TaxRuleSet;
  readonly grossIncome: Money;
  readonly deductions: readonly ClaimedDeduction[];
}

export function estimateIncomeTax(input: EstimateInput): Result<TaxEstimate, TaxProblem> {
  const { ruleSet, grossIncome } = input;

  if (grossIncome.currency !== ruleSet.currency) {
    return err({
      kind: 'currency_mismatch',
      expected: ruleSet.currency,
      received: grossIncome.currency,
    });
  }

  const rule = findRule(ruleSet, INCOME_BRACKETS_KEY);
  if (rule?.kind !== 'brackets') {
    return err({ kind: 'missing_rule', ruleKey: INCOME_BRACKETS_KEY });
  }

  const zero = Money.zero(ruleSet.currency);
  const lines: TaxEstimateLine[] = [];

  let allowed = zero;
  for (const claimed of input.deductions) {
    const deductionRule = findRule(ruleSet, claimed.key);
    if (deductionRule?.kind !== 'deduction') continue;

    const { deduction } = deductionRule;
    const eligible = claimed.amount.percentage(deduction.rate);
    const capped = deduction.cap ? Money.min(eligible, deduction.cap) : eligible;
    if (!capped.isPositive()) continue;

    allowed = allowed.add(capped);
    lines.push({
      key: claimed.key,
      label: claimed.label,
      amount: capped.negate(),
      ruleKey: deductionRule.key,
    });
  }

  const taxableIncome = Money.max(grossIncome.subtract(allowed), zero);
  const { tax, bandLines } = applyBrackets(taxableIncome, rule.brackets, rule.key);
  lines.push(...bandLines);

  return ok({
    jurisdiction: ruleSet.jurisdiction,
    fiscalYear: ruleSet.fiscalYear,
    ruleSetVersion: ruleSet.version,
    ruleSetStatus: ruleSet.status,
    presentable: mayPresent(ruleSet),
    currency: ruleSet.currency,
    grossIncome,
    deductions: allowed,
    taxableIncome,
    estimatedTax: tax,
    effectiveRate: effectiveRate(tax, grossIncome),
    lines,
  });
}

/**
 * Progressive bands, applied to the slice of income that falls in each.
 *
 * The mistake this shape prevents is applying the top rate to the whole amount.
 * It is the most common misunderstanding of a progressive system and it makes
 * the estimate wildly wrong in the direction that stops people earning more.
 */
export function applyBrackets(
  taxable: Money,
  brackets: readonly TaxBracket[],
  ruleKey: string,
): { tax: Money; bandLines: TaxEstimateLine[] } {
  const zero = Money.zero(taxable.currency);
  const bandLines: TaxEstimateLine[] = [];
  let tax = zero;

  for (const [index, band] of brackets.entries()) {
    if (!taxable.greaterThan(band.from)) break;

    const ceiling = band.upTo ? Money.min(taxable, band.upTo) : taxable;
    const portion = ceiling.subtract(band.from);
    if (!portion.isPositive()) continue;

    const bandTax = portion.percentage(band.rate);
    tax = tax.add(bandTax);

    bandLines.push({
      key: `${ruleKey}.band.${String(index)}`,
      label: band.rate,
      amount: bandTax,
      ruleKey,
    });
  }

  return { tax, bandLines };
}

/**
 * Tax over gross income, 0–1.
 *
 * Null rather than zero when there was no income: a household with nothing
 * earned has no effective rate, and reporting 0% would suggest a favourable
 * outcome where there is simply no fact.
 */
function effectiveRate(tax: Money, gross: Money): number | null {
  if (!gross.isPositive()) return null;
  return Number((tax.scaledUnits * 1_000_000n) / gross.scaledUnits) / 1_000_000;
}
