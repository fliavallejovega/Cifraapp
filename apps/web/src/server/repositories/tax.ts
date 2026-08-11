import 'server-only';

import { taxProfiles, taxRuleSets, taxRules } from '@app/database/schema';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';
import {
  computeReserve,
  estimateIncomeTax,
  validateRuleSet,
  type ReserveResult,
  type TaxBracket,
  type TaxRule,
  type TaxRuleSet,
  type TaxpayerProfile,
} from '@app/tax-engine';
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * Tax rules, read back out of the database.
 *
 * Rules live in rows so they can change without a release. That means they
 * arrive here as JSON written by an administrator, and are treated exactly like
 * a stored automation rule: parsed, validated, and rejected if the shape is
 * wrong — never trusted because it came from our own table.
 *
 * Only published sets are visible at all. The row-level security policy enforces
 * that, and this module does not have a path around it: an unreviewed rule is
 * working material, and a figure derived from one must never reach a household.
 *
 * As of this build the only rule set that exists is the Panama 2026 **draft**,
 * so every function here returns null for every household. That is the correct
 * behaviour, not a gap — the tax surface stays dark until somebody qualified
 * publishes a set.
 */

type Tx = Parameters<Parameters<typeof queryAsUser<unknown>>[1]>[0];

export interface TaxContext {
  readonly ruleSet: TaxRuleSet;
  readonly profile: TaxpayerProfile;
}

/**
 * The published rules in force for this household on a date, with their profile.
 *
 * Null when any of the three preconditions is missing: no published set, no
 * profile, or a set that does not survive validation. Each is a reason not to
 * compute rather than a reason to compute approximately.
 */
export async function loadTaxContext(
  session: Session,
  householdId: string,
  on: PlainDate,
): Promise<TaxContext | null> {
  return queryAsUser(session, async (tx) => {
    const [profileRow] = await tx
      .select({
        jurisdiction: taxProfiles.jurisdiction,
        status: taxProfiles.taxpayerStatus,
        ruc: taxProfiles.ruc,
        activity: taxProfiles.activity,
        accountingMethod: taxProfiles.accountingMethod,
        itbmsRegistered: taxProfiles.itbmsRegistered,
        fiscalYearStart: taxProfiles.fiscalYearStart,
      })
      .from(taxProfiles)
      .where(eq(taxProfiles.householdId, householdId))
      .limit(1);

    if (!profileRow) return null;

    const jurisdiction = profileRow.jurisdiction.trim();
    const ruleSet = await loadPublishedRuleSet(tx, jurisdiction, on);
    if (!ruleSet) return null;

    return {
      ruleSet,
      profile: {
        jurisdiction,
        status: profileRow.status,
        ruc: profileRow.ruc,
        activity: profileRow.activity,
        accountingMethod: profileRow.accountingMethod,
        itbmsRegistered: profileRow.itbmsRegistered,
        fiscalYearStart: profileRow.fiscalYearStart,
      },
    };
  });
}

async function loadPublishedRuleSet(
  tx: Tx,
  jurisdiction: string,
  on: PlainDate,
): Promise<TaxRuleSet | null> {
  const [setRow] = await tx
    .select({
      id: taxRuleSets.id,
      fiscalYear: taxRuleSets.fiscalYear,
      version: taxRuleSets.version,
      status: taxRuleSets.status,
      effectiveFrom: taxRuleSets.effectiveFrom,
      effectiveTo: taxRuleSets.effectiveTo,
      currency: taxRuleSets.currency,
    })
    .from(taxRuleSets)
    .where(
      and(
        eq(taxRuleSets.jurisdiction, jurisdiction),
        eq(taxRuleSets.status, 'published'),
        lte(taxRuleSets.effectiveFrom, on),
        or(isNull(taxRuleSets.effectiveTo), gte(taxRuleSets.effectiveTo, on)),
      ),
    )
    .orderBy(desc(taxRuleSets.version))
    .limit(1);

  if (!setRow) return null;

  const currency = setRow.currency.trim() as CurrencyCode;

  const ruleRows = await tx
    .select({
      taxType: taxRules.taxType,
      ruleKey: taxRules.ruleKey,
      kind: taxRules.kind,
      payload: taxRules.payload,
      source: taxRules.source,
      sourceUrl: taxRules.sourceUrl,
      sourceReference: taxRules.sourceReference,
      notes: taxRules.notes,
    })
    .from(taxRules)
    .where(eq(taxRules.ruleSetId, setRow.id));

  const parsed = ruleRows
    .map((row) => toRule(row, currency))
    .filter((rule): rule is TaxRule => rule !== null);

  const candidate: TaxRuleSet = {
    jurisdiction,
    fiscalYear: setRow.fiscalYear,
    version: setRow.version,
    status: setRow.status,
    effectiveFrom: setRow.effectiveFrom as PlainDate,
    effectiveTo: (setRow.effectiveTo as PlainDate | null) ?? null,
    currency,
    rules: parsed,
  };

  // A set that fails validation is not used, quietly or otherwise. Bands with a
  // gap in them would exempt a slice of income nobody meant to exempt.
  return validateRuleSet(candidate).ok ? candidate : null;
}

/**
 * The reserve this household should be holding, or null when tax is not
 * configured for them.
 *
 * Null is the common answer today and the caller must have an alternative — on
 * the plan screen that is the household's own configured rate, which is honest
 * about being their setting rather than a tax calculation.
 */
export async function estimateTaxReserve(
  session: Session,
  householdId: string,
  input: {
    on: PlainDate;
    projectedAnnualIncome: Money;
    incomeToDate: Money;
    reservedToDate: Money;
  },
): Promise<ReserveResult | null> {
  const context = await loadTaxContext(session, householdId, input.on);
  if (!context) return null;

  const annual = estimateIncomeTax({
    ruleSet: context.ruleSet,
    grossIncome: input.projectedAnnualIncome,
    deductions: [],
  });

  if (!annual.ok || !annual.value.presentable) return null;

  return computeReserve({
    annual: annual.value,
    incomeToDate: input.incomeToDate,
    reservedToDate: input.reservedToDate,
  });
}

/** Reads one stored rule into the engine's shape, or null if the row is unusable. */
function toRule(
  row: {
    taxType: string;
    ruleKey: string;
    kind: string;
    payload: unknown;
    source: string;
    sourceUrl: string | null;
    sourceReference: string;
    notes: string | null;
  },
  currency: CurrencyCode,
): TaxRule | null {
  const provenance = {
    source: row.source,
    sourceUrl: row.sourceUrl,
    sourceReference: row.sourceReference,
    notes: row.notes,
    // Review is recorded on the set, which is what the publication constraint
    // checks. A rule inherits it rather than carrying a second, divergent copy.
    reviewedBy: null,
    reviewedAt: null,
  };

  const taxType = row.taxType as TaxRule['taxType'];
  const payload = row.payload as Record<string, unknown>;

  switch (row.kind) {
    case 'brackets': {
      const bands = Array.isArray(payload['brackets']) ? payload['brackets'] : [];
      const brackets = bands
        .map((band: unknown) => toBracket(band, currency))
        .filter((band): band is TaxBracket => band !== null);

      return brackets.length > 0
        ? { kind: 'brackets', key: row.ruleKey, taxType, brackets, provenance }
        : null;
    }

    case 'flat_rate': {
      const rate = payload['rate'];
      return typeof rate === 'string'
        ? { kind: 'flat_rate', key: row.ruleKey, taxType, rate, provenance }
        : null;
    }

    case 'threshold': {
      const amount = payload['amount'];
      return typeof amount === 'string'
        ? {
            kind: 'threshold',
            key: row.ruleKey,
            taxType,
            amount: Money.fromDecimalString(amount, currency),
            provenance,
          }
        : null;
    }

    case 'deadline': {
      const monthDay = payload['monthDay'];
      const label = payload['label'];
      return typeof monthDay === 'string' && typeof label === 'string'
        ? { kind: 'deadline', key: row.ruleKey, taxType, monthDay, label, provenance }
        : null;
    }

    case 'deduction': {
      const rate = payload['rate'];
      const label = payload['label'];
      const cap = payload['cap'];
      if (typeof rate !== 'string' || typeof label !== 'string') return null;

      return {
        kind: 'deduction',
        key: row.ruleKey,
        taxType,
        deduction: {
          key: row.ruleKey,
          label,
          cap: typeof cap === 'string' ? Money.fromDecimalString(cap, currency) : null,
          rate,
          provenance,
        },
        provenance,
      };
    }

    default:
      return null;
  }
}

function toBracket(value: unknown, currency: CurrencyCode): TaxBracket | null {
  if (typeof value !== 'object' || value === null) return null;

  const band = value as { from?: unknown; upTo?: unknown; rate?: unknown };
  if (typeof band.from !== 'string' || typeof band.rate !== 'string') return null;

  return {
    from: Money.fromDecimalString(band.from, currency),
    upTo: typeof band.upTo === 'string' ? Money.fromDecimalString(band.upTo, currency) : null,
    rate: band.rate,
  };
}
