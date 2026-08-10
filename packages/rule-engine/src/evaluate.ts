import { isErr, Money, type PlainDate } from '@app/domain';

import type { FactSet, FactValue } from './facts.js';
import {
  validateRule,
  type Action,
  type Condition,
  type FactComparison,
  type Literal,
  type Rule,
} from './schema.js';

/**
 * Rule evaluation.
 *
 * Three-valued, not boolean. A condition is true, false, or **unknown**, and
 * unknown is what a fact the caller did not supply resolves to.
 *
 * That third value is the whole correctness argument of this file. A household
 * writes `WHEN Emergency Fund < $5,000 THEN allocate 15%`. If the household has
 * no emergency fund, a missing fact treated as zero makes the condition true and
 * quietly routes money into an account that does not exist; treated as false, it
 * silently does nothing and the household never learns why. Unknown does neither:
 * the rule is skipped, and it is reported as skipped, with the fact that was
 * missing named.
 *
 * The engine performs nothing. It returns the actions of the rules that matched,
 * in priority order, and something else decides what to do with them.
 */

export type Truth = 'true' | 'false' | 'unknown';

export type SkipReason = 'inactive' | 'not_yet_effective' | 'expired' | 'invalid' | 'missing_fact';

export interface MatchedRule {
  readonly ruleId: string;
  readonly name: string;
  readonly priority: number;
  readonly actions: readonly Action[];
  readonly explanation: string;
}

export interface SkippedRule {
  readonly ruleId: string;
  readonly name: string;
  readonly reason: SkipReason;
  /** Which fact was missing, when that is why. */
  readonly missingFact?: string;
  readonly detail?: string;
}

export interface RuleEvaluation {
  readonly matched: readonly MatchedRule[];
  /** Every action from every matched rule, in priority order. */
  readonly actions: readonly Action[];
  readonly skipped: readonly SkippedRule[];
}

export interface EvaluationOptions {
  /** The date the rules are evaluated on. Decides which are in force. */
  readonly on: PlainDate;
}

export function evaluateRules(
  rules: readonly Rule[],
  facts: FactSet,
  options: EvaluationOptions,
): RuleEvaluation {
  const matched: MatchedRule[] = [];
  const skipped: SkippedRule[] = [];

  const ordered = [...rules].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  for (const rule of ordered) {
    const skipReason = whyNotInForce(rule, options.on);
    if (skipReason) {
      skipped.push({ ruleId: rule.id, name: rule.name, reason: skipReason });
      continue;
    }

    // Validated again here, not only on write. A rule edited straight in the
    // database, or written before a fact was renamed, must not reach evaluation.
    const validated = validateRule(rule);
    if (isErr(validated)) {
      const first = validated.error[0]?.message;
      skipped.push({
        ruleId: rule.id,
        name: rule.name,
        reason: 'invalid',
        ...(first ? { detail: first } : {}),
      });
      continue;
    }

    const missing: string[] = [];
    const truth = evaluateCondition(rule.when, facts, missing);

    if (truth === 'unknown') {
      skipped.push({
        ruleId: rule.id,
        name: rule.name,
        reason: 'missing_fact',
        ...(missing[0] ? { missingFact: missing[0] } : {}),
      });
      continue;
    }

    if (truth === 'true') {
      matched.push({
        ruleId: rule.id,
        name: rule.name,
        priority: rule.priority,
        actions: rule.then,
        explanation: rule.explanation,
      });
    }
  }

  return {
    matched,
    actions: matched.flatMap((rule) => rule.actions),
    skipped,
  };
}

function whyNotInForce(rule: Rule, on: PlainDate): SkipReason | null {
  if (!rule.isActive) return 'inactive';
  if (rule.effectiveFrom && on < rule.effectiveFrom) return 'not_yet_effective';
  if (rule.effectiveTo && on > rule.effectiveTo) return 'expired';
  return null;
}

export function evaluateCondition(
  condition: Condition,
  facts: FactSet,
  missing: string[] = [],
): Truth {
  switch (condition.type) {
    case 'compare':
      return evaluateComparison(condition, facts, missing);

    case 'not': {
      const inner = evaluateCondition(condition.of, facts, missing);
      // Unknown negated is still unknown. Nothing is learned by flipping a
      // question mark.
      return inner === 'unknown' ? 'unknown' : inner === 'true' ? 'false' : 'true';
    }

    case 'all': {
      let sawUnknown = false;
      for (const child of condition.of) {
        const truth = evaluateCondition(child, facts, missing);
        // One definite false settles it, even alongside unknowns: the group
        // cannot be true whatever the missing fact turns out to be.
        if (truth === 'false') return 'false';
        if (truth === 'unknown') sawUnknown = true;
      }
      return sawUnknown ? 'unknown' : 'true';
    }

    case 'any': {
      let sawUnknown = false;
      for (const child of condition.of) {
        const truth = evaluateCondition(child, facts, missing);
        if (truth === 'true') return 'true';
        if (truth === 'unknown') sawUnknown = true;
      }
      return sawUnknown ? 'unknown' : 'false';
    }
  }
}

function evaluateComparison(condition: FactComparison, facts: FactSet, missing: string[]): Truth {
  const fact = facts.get(condition.fact);
  if (!fact) {
    missing.push(condition.fact);
    return 'unknown';
  }

  const outcome = compare(fact, condition.operator, condition.value);
  if (outcome === null) {
    // A type mismatch that validation should have caught. Refusing to decide is
    // safer than picking a comparison and hoping.
    missing.push(condition.fact);
    return 'unknown';
  }

  return outcome ? 'true' : 'false';
}

function compare(
  fact: FactValue,
  operator: FactComparison['operator'],
  literal: Literal,
): boolean | null {
  if (operator === 'in') {
    if (fact.kind !== 'text' || literal.kind !== 'text_list') return null;
    return literal.values.includes(fact.value);
  }

  if (operator === 'contains') {
    if (fact.kind !== 'text' || literal.kind !== 'text') return null;
    return fact.value.toLowerCase().includes(literal.value.toLowerCase());
  }

  const ordering = order(fact, literal);
  if (ordering === null) return null;

  switch (operator) {
    case 'lt':
      return ordering < 0;
    case 'lte':
      return ordering <= 0;
    case 'gt':
      return ordering > 0;
    case 'gte':
      return ordering >= 0;
    case 'eq':
      return ordering === 0;
    case 'neq':
      return ordering !== 0;
  }
}

/** -1, 0 or 1 comparing the fact to the literal, or null if they are not comparable. */
function order(fact: FactValue, literal: Literal): number | null {
  if (fact.kind === 'money' && literal.kind === 'money') {
    // A rule written in one currency must not silently compare against a balance
    // held in another. There is no exchange rate in this system, by design.
    if (fact.value.currency !== literal.currency) return null;
    const other = Money.fromDecimalString(literal.amount, fact.value.currency);
    return fact.value.compare(other);
  }

  if (fact.kind === 'number' && literal.kind === 'number') {
    return fact.value === literal.value ? 0 : fact.value < literal.value ? -1 : 1;
  }

  if (fact.kind === 'text' && literal.kind === 'text') {
    return fact.value === literal.value ? 0 : fact.value < literal.value ? -1 : 1;
  }

  if (fact.kind === 'boolean' && literal.kind === 'boolean') {
    return fact.value === literal.value ? 0 : fact.value ? 1 : -1;
  }

  if (fact.kind === 'date' && literal.kind === 'date') {
    return fact.value === literal.value ? 0 : fact.value < literal.value ? -1 : 1;
  }

  return null;
}

/** One row of the audit trail: which rule fired, when, and what it asked for. */
export interface RuleExecution {
  readonly ruleId: string;
  readonly matched: boolean;
  readonly skipReason: SkipReason | null;
  readonly actions: readonly Action[];
  readonly explanation: string;
}

/**
 * Turns an evaluation into the rows that record it.
 *
 * Every run is recorded, including the rules that did not fire. "Why did nothing
 * happen?" is the question a household actually asks, and it cannot be answered
 * from a log that only holds the matches.
 */
export function recordExecution(evaluation: RuleEvaluation): RuleExecution[] {
  const matched = evaluation.matched.map((rule): RuleExecution => ({
    ruleId: rule.ruleId,
    matched: true,
    skipReason: null,
    actions: rule.actions,
    explanation: rule.explanation,
  }));

  const skipped = evaluation.skipped.map((rule): RuleExecution => ({
    ruleId: rule.ruleId,
    matched: false,
    skipReason: rule.reason,
    actions: [],
    explanation: describeSkip(rule),
  }));

  return [...matched, ...skipped];
}

function describeSkip(rule: SkippedRule): string {
  switch (rule.reason) {
    case 'inactive':
      return 'This rule is turned off.';
    case 'not_yet_effective':
      return 'This rule has not started yet.';
    case 'expired':
      return 'This rule has ended.';
    case 'invalid':
      return `This rule cannot run: ${rule.detail ?? 'it is no longer valid.'}`;
    case 'missing_fact':
      return rule.missingFact
        ? `We do not have ${rule.missingFact} yet, so this rule was left alone.`
        : 'Something this rule needs is missing, so it was left alone.';
  }
}
