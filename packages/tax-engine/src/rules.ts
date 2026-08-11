import { err, ok, type PlainDate, type Result } from '@app/domain';

import type { TaxRule, TaxRuleSet, TaxType } from './types.js';

/**
 * Choosing and trusting a rule set.
 *
 * Two questions, kept apart because they have different answers. *Which rules
 * applied on this date* is a lookup. *May a figure computed from them be shown
 * to a household as a tax estimate* is a judgement about review, and it lives in
 * exactly one function so that no component can quietly decide otherwise.
 */

/** The set in force on a date. Effective windows do not overlap within a jurisdiction. */
export function selectRuleSet(
  sets: readonly TaxRuleSet[],
  jurisdiction: string,
  on: PlainDate,
): TaxRuleSet | undefined {
  const candidates = sets
    .filter(
      (set) =>
        set.jurisdiction === jurisdiction &&
        set.effectiveFrom <= on &&
        (set.effectiveTo === null || on <= set.effectiveTo),
    )
    // Highest version wins when two overlap, which should not happen and does.
    .sort((a, b) => b.version - a.version);

  return candidates[0];
}

/**
 * Whether a figure from this set may be shown as a tax estimate.
 *
 * Only a published set qualifies, and publication requires a named reviewer on
 * every rule (see `validateRuleSet`). A draft computes — that is how it gets
 * reviewed — but nothing computed from it reaches a household, and
 * `is_supported` on the jurisdiction stays false until this returns true.
 */
export function mayPresent(set: TaxRuleSet): boolean {
  return set.status === 'published';
}

export function findRule(set: TaxRuleSet, key: string): TaxRule | undefined {
  return set.rules.find((rule) => rule.key === key);
}

export function rulesOfType(set: TaxRuleSet, taxType: TaxType): readonly TaxRule[] {
  return set.rules.filter((rule) => rule.taxType === taxType);
}

/**
 * Everything that must be true before a set may be published.
 *
 * The bracket checks are arithmetic hygiene: a gap between bands silently
 * exempts a slice of income, and an overlap taxes it twice. The provenance check
 * is the one that matters legally — a published rule without a named reviewer
 * and a date is an assertion this product does not make.
 */
export function validateRuleSet(set: TaxRuleSet): Result<TaxRuleSet, readonly string[]> {
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const rule of set.rules) {
    if (seen.has(rule.key)) issues.push(`${rule.key}: declared twice.`);
    seen.add(rule.key);

    if (set.status === 'published') {
      if (!rule.provenance.reviewedBy || !rule.provenance.reviewedAt) {
        issues.push(`${rule.key}: published without a reviewer.`);
      }
      if (rule.provenance.sourceReference.trim().length === 0) {
        issues.push(`${rule.key}: published without a source reference.`);
      }
    }

    if (rule.kind === 'brackets') {
      issues.push(...bracketIssues(rule));
    }
  }

  return issues.length > 0 ? err(issues) : ok(set);
}

function bracketIssues(rule: Extract<TaxRule, { kind: 'brackets' }>): string[] {
  const issues: string[] = [];
  const bands = rule.brackets;

  if (bands.length === 0) return [`${rule.key}: no bands.`];
  if (bands[0] && !bands[0].from.isZero()) {
    issues.push(`${rule.key}: the first band must start at zero.`);
  }

  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const next = bands[index + 1];
    if (!band) continue;

    if (band.upTo === null && next) {
      issues.push(`${rule.key}: band ${String(index)} is open-ended but is not the last.`);
      continue;
    }

    if (band.upTo && !band.upTo.greaterThan(band.from)) {
      issues.push(`${rule.key}: band ${String(index)} ends before it starts.`);
    }

    // Contiguity, in both directions. A gap exempts income nobody meant to
    // exempt; an overlap taxes the same slice twice.
    if (next && band.upTo && !next.from.equals(band.upTo)) {
      issues.push(`${rule.key}: band ${String(index + 1)} does not continue from the one before.`);
    }
  }

  if (bands[bands.length - 1]?.upTo !== null) {
    issues.push(`${rule.key}: the top band must be open-ended.`);
  }

  return issues;
}
