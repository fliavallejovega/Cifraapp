import type { PlainDate } from '@app/domain';

import { sourceAuthority, type MerchantRule } from './types.js';

/**
 * Rule matching.
 *
 * A rule is data — a match kind and a literal pattern — never an expression to
 * evaluate. That constraint is the whole security model of this file: the worst
 * a malicious pattern can do is fail to match. Regular expressions were
 * considered and refused; catastrophic backtracking authored by a customer is
 * still a denial of service, and no categorization feature is worth that
 * (spec §110).
 */

/** Whether a rule applies on a given date. Rules may be scheduled or expired. */
export function isRuleActiveOn(rule: MerchantRule, date: PlainDate): boolean {
  if (!rule.isActive) return false;
  if (rule.effectiveFrom && date < rule.effectiveFrom) return false;
  if (rule.effectiveTo && date > rule.effectiveTo) return false;
  return true;
}

export function matchesPattern(descriptionNormalized: string, rule: MerchantRule): boolean {
  const pattern = rule.pattern.trim();
  if (!pattern) return false;

  switch (rule.matchKind) {
    case 'equals':
      return descriptionNormalized === pattern;
    case 'starts_with':
      return descriptionNormalized.startsWith(pattern);
    case 'contains':
      return descriptionNormalized.includes(pattern);
    case 'tokens': {
      const present = new Set(descriptionNormalized.split(' '));
      return pattern.split(' ').every((token) => present.has(token));
    }
  }
}

/**
 * How specific a rule is, used only to break ties.
 *
 * `equals` beats `starts_with` beats `contains` beats `tokens`, and a longer
 * pattern beats a shorter one — "adobe creative cloud" should win over "adobe"
 * when both are user rules at the same priority. Without this, which rule wins
 * would depend on row order, and the same import would categorize differently
 * on a different day.
 */
export function ruleSpecificity(rule: MerchantRule): number {
  const kindWeight: Record<MerchantRule['matchKind'], number> = {
    equals: 4000,
    starts_with: 3000,
    contains: 2000,
    tokens: 1000,
  };
  return kindWeight[rule.matchKind] + Math.min(rule.pattern.length, 999);
}

/**
 * Orders rules the way they must be applied: authority first, then the
 * household's own priority, then specificity, then id.
 *
 * The final tie-break on id is not decoration. Two rules that are equal in every
 * other respect must still resolve the same way on every run, or the engine is
 * not deterministic and its output cannot be reproduced when someone disputes it.
 */
export function orderRules(rules: readonly MerchantRule[]): MerchantRule[] {
  return [...rules].sort((a, b) => {
    const authority = sourceAuthority(b.source) - sourceAuthority(a.source);
    if (authority !== 0) return authority;

    if (a.priority !== b.priority) return a.priority - b.priority;

    const specificity = ruleSpecificity(b) - ruleSpecificity(a);
    if (specificity !== 0) return specificity;

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** The first rule that applies, or null. */
export function findMatchingRule(
  descriptionNormalized: string,
  rules: readonly MerchantRule[],
  on: PlainDate,
): MerchantRule | null {
  for (const rule of orderRules(rules)) {
    if (!isRuleActiveOn(rule, on)) continue;
    if (matchesPattern(descriptionNormalized, rule)) return rule;
  }
  return null;
}
