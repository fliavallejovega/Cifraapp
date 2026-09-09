import { Money, type PlainDate } from '@app/domain';

import type { RuleProvenance, TaxRuleSet } from '../types.js';

/**
 * Panama, fiscal year 2026 — **DRAFT. NOT REVIEWED. NOT PRESENTABLE.**
 *
 * Read this before touching anything below.
 *
 * These figures were transcribed from the commonly cited text of the Código
 * Fiscal. **They have not been verified against a primary publication of the
 * Dirección General de Ingresos**, and nobody named has checked them. That is
 * why every rule carries `reviewedBy: null`, why the set's status is `draft`,
 * and why `platform.tax_jurisdictions.is_supported` for `PA` stays `false`.
 *
 * `mayPresent()` returns false for a draft, so the engine will compute from this
 * set — which is how it gets checked — and the product will not show a household
 * a tax figure derived from it. Do not change the status to `published` to make
 * a screen work. Publication means: someone qualified read the primary source,
 * confirmed each figure, and put their name and the date on it. Until then this
 * file is a structure with plausible numbers in it, and the difference between
 * that and a tax engine is the entire legal risk in this project.
 *
 * What is deliberately absent, because it could not be sourced with confidence:
 * personal deductions and their caps, social security contributions for the
 * self-employed, and municipal rates. A deduction with an unverified cap is
 * worse than no deduction — it lowers a reserve a household is relying on.
 *
 * ## The payroll rules below, and what they may be used for
 *
 * `social_security.employee`, `social_security.education_employee` and the
 * income brackets together describe what comes off a Panamanian salary before
 * it is paid. They are here at the explicit request of the product owner, and
 * they carry exactly the same status as everything else in this file: draft,
 * unreviewed, `reviewedBy: null`.
 *
 * That status still decides what may be done with them. `mayPresent()` is
 * false, so nothing here may be shown to a household as *what they owe* — not
 * a reserve, not a filing figure, not an assertion about the law.
 *
 * They may be used for one thing: to prefill, as an editable suggestion, the
 * deduction lines a household is copying off their own payslip. The difference
 * is not cosmetic. A figure the person confirms against the paper in their hand
 * and can overwrite is their statement; the same figure presented as settled is
 * ours. Only the first is a claim this product is entitled to make, and the
 * prefill path says so on the screen.
 */

const UNREVIEWED: RuleProvenance = {
  source: 'Dirección General de Ingresos (DGI), Panamá',
  sourceUrl: 'https://dgi.mef.gob.pa/',
  sourceReference: 'Código Fiscal de Panamá, artículo 700',
  notes:
    'Transcribed from the commonly cited text. Not verified against a primary DGI publication. Must be confirmed by a qualified reviewer before publication.',
  reviewedBy: null,
  reviewedAt: null,
};

const ITBMS_PROVENANCE: RuleProvenance = {
  ...UNREVIEWED,
  sourceReference: 'ITBMS — general rate',
};

const DEADLINE_PROVENANCE: RuleProvenance = {
  ...UNREVIEWED,
  sourceReference: 'Annual income tax return, natural persons — filing deadline',
  notes:
    'Deadlines shift by resolution more often than rates do. Unverified; must be confirmed against the current DGI calendar before publication.',
};

const pab = (value: string) => Money.fromDecimalString(value, 'PAB');

export const PANAMA_2026_DRAFT: TaxRuleSet = {
  jurisdiction: 'PA',
  fiscalYear: 2026,
  version: 1,
  status: 'draft',
  effectiveFrom: '2026-01-01' as PlainDate,
  effectiveTo: '2026-12-31' as PlainDate,
  // The balboa is pegged 1:1 to the dollar and is kept as a distinct currency
  // anyway: a peg is a policy, not an identity, and the day it moves every
  // historical figure must still mean what it meant.
  currency: 'PAB',
  rules: [
    {
      kind: 'brackets',
      key: 'income.brackets',
      taxType: 'income',
      brackets: [
        { from: pab('0'), upTo: pab('11000.00'), rate: '0.000' },
        { from: pab('11000.00'), upTo: pab('50000.00'), rate: '15.000' },
        { from: pab('50000.00'), upTo: null, rate: '25.000' },
      ],
      provenance: UNREVIEWED,
    },
    /**
     * The employee's own contribution to the Caja de Seguro Social.
     *
     * The employer's share is a different, larger rate and is deliberately not
     * here: it never touches the household's money and putting it in a file
     * about what reaches a person would be an invitation to subtract it.
     */
    {
      kind: 'flat_rate',
      key: 'social_security.employee',
      taxType: 'social_security',
      rate: '9.750',
      provenance: {
        ...UNREVIEWED,
        sourceReference: 'Caja de Seguro Social — cuota obrera sobre el salario',
        notes:
          'Transcribed from the commonly cited rate. Not verified against a primary CSS publication. Prefill only: shown as an editable suggestion the household confirms against their own payslip, never as a figure this product asserts.',
      },
    },
    {
      kind: 'flat_rate',
      key: 'social_security.education_employee',
      taxType: 'social_security',
      rate: '1.250',
      provenance: {
        ...UNREVIEWED,
        sourceReference: 'Seguro Educativo — cuota del trabajador',
        notes:
          'Transcribed from the commonly cited rate. Not verified against a primary publication. Prefill only, editable by the household.',
      },
    },
    {
      kind: 'flat_rate',
      key: 'itbms.general',
      taxType: 'itbms',
      rate: '7.000',
      provenance: ITBMS_PROVENANCE,
    },
    {
      kind: 'deadline',
      key: 'income.return.natural_persons',
      taxType: 'income',
      monthDay: '03-15',
      label: 'Declaración jurada de rentas — personas naturales',
      provenance: DEADLINE_PROVENANCE,
    },
  ],
};

/**
 * Every rule set this build knows about.
 *
 * The application reads rule sets from the database so they can change without a
 * deployment. This constant is the seed for that table and the fixture the
 * engine's own tests run against — never a fallback the product silently uses
 * when the database has nothing.
 */
export const BUNDLED_RULE_SETS: readonly TaxRuleSet[] = [PANAMA_2026_DRAFT];
