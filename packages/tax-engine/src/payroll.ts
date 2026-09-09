import { Money, type CurrencyCode } from '@app/domain';

import { applyBrackets } from './estimate.js';
import { findRule } from './rules.js';
import type { TaxRuleSet } from './types.js';

/**
 * What comes off a salary before it is paid, computed from the rule set.
 *
 * ## What this is for, and what it is not for
 *
 * It exists so a household does not have to transcribe three numbers off a
 * payslip by hand. It fills the fields; the person confirms them against the
 * paper in front of them and corrects whatever does not match. That
 * confirmation is the whole design: the figure that ends up stored is the
 * household's statement about their own pay, and this function's job is to make
 * that statement quick to produce rather than to replace it.
 *
 * It is **not** a filing figure and it is not what anybody owes. The rule set
 * it reads is a draft nobody qualified has reviewed, `mayPresent()` is false
 * for it, and none of that changes here. A caller that shows these numbers as
 * settled tax is misusing them, which is why they come back labelled as an
 * estimate with the rule keys they came from attached.
 *
 * ## The order of operations, which is where this goes wrong
 *
 * Income tax is not computed on the gross. The two contributions come off
 * first, and the tax bands apply to what is left — get that backwards and the
 * withholding is overstated on every salary, by more the higher it is. And the
 * bands are annual, so a fortnightly salary has to be annualised, taxed, and
 * divided back down: applying an annual threshold to a fortnight would exempt
 * almost everybody from a tax they actually pay.
 */

export interface PayrollLine {
  /** The rule this came from, so a screen can cite it. */
  readonly ruleKey: string;
  /** A stable key the app maps to its own translated label. */
  readonly key: 'socialSecurity' | 'educationTax' | 'incomeTax';
  readonly amount: Money;
}

export interface PayrollEstimate {
  readonly gross: Money;
  readonly lines: readonly PayrollLine[];
  readonly totalDeducted: Money;
  /** Gross minus everything above. What actually reaches an account. */
  readonly net: Money;
  /**
   * False when the rule set has not been reviewed, which is every set today.
   *
   * Carried so the caller cannot forget: it decides whether these numbers may
   * be *presented* as owed, and the answer is no. Prefilling an editable field
   * is a different act and stays allowed.
   */
  readonly mayPresentAsOwed: boolean;
}

export interface PayrollInput {
  readonly gross: Money;
  /**
   * How many times a year this salary is paid.
   *
   * Needed because the tax bands are annual. Twenty-four for a twice-monthly
   * salary, twelve for a monthly one, twenty-six for a fortnightly one.
   */
  readonly paymentsPerYear: number;
  readonly rules: TaxRuleSet;
}

/** A rate rule, or null when the set does not carry one. */
function flatRate(set: TaxRuleSet, key: string): string | null {
  const rule = findRule(set, key);
  return rule?.kind === 'flat_rate' ? rule.rate : null;
}

/**
 * The deductions on one paycheck.
 *
 * Returns null when the rule set is missing something it needs, rather than
 * computing around the gap. A withholding estimate that silently skipped income
 * tax because the brackets were absent would look complete and be wrong by the
 * largest line on the slip.
 */
export function estimatePayroll(input: PayrollInput): PayrollEstimate | null {
  const { gross, rules, paymentsPerYear } = input;
  if (!Number.isInteger(paymentsPerYear) || paymentsPerYear <= 0) return null;
  if (gross.isNegative()) return null;

  const socialRate = flatRate(rules, 'social_security.employee');
  const educationRate = flatRate(rules, 'social_security.education_employee');
  const bracketRule = findRule(rules, 'income.brackets');
  if (!socialRate || !educationRate || bracketRule?.kind !== 'brackets') return null;

  const currency: CurrencyCode = gross.currency;
  const zero = Money.zero(currency);

  const social = gross.percentage(socialRate);
  const education = gross.percentage(educationRate);

  /**
   * The tax, computed on the year and brought back to the paycheck.
   *
   * The contributions come off before the bands apply — that is the part that
   * is easy to get backwards and expensive when it is. The annual round trip is
   * the other part: the first band is an annual threshold, and testing a
   * fortnight against it would put almost every salary in Panama at zero.
   */
  const perYear = (value: Money) => value.multiply(paymentsPerYear);
  const taxableYear = perYear(gross).subtract(perYear(social)).subtract(perYear(education));
  const { tax: annualTax } = applyBrackets(
    taxableYear.isPositive() ? taxableYear : zero,
    bracketRule.brackets,
    bracketRule.key,
  );
  const incomeTax = annualTax.isPositive() ? annualTax.divide(paymentsPerYear) : zero;

  // Solo las líneas con monto. Una retención de cero no es una línea del
  // recibo: es la ausencia de una, y mostrarla vacía sugiere que se cobró algo.
  const lines: PayrollLine[] = (
    [
      { key: 'socialSecurity', ruleKey: 'social_security.employee', amount: social },
      { key: 'educationTax', ruleKey: 'social_security.education_employee', amount: education },
      { key: 'incomeTax', ruleKey: bracketRule.key, amount: incomeTax },
    ] as const satisfies readonly PayrollLine[]
  ).filter((line) => line.amount.isPositive());

  const totalDeducted = Money.sum(
    lines.map((line) => line.amount),
    currency,
  );
  const net = gross.subtract(totalDeducted);

  return {
    gross,
    lines,
    totalDeducted,
    // Never true while the set is a draft, which is every set today. Kept as a
    // field rather than a comment so a caller has to look at it.
    net: net.isPositive() ? net : zero,
    mayPresentAsOwed: rules.status === 'published',
  };
}
