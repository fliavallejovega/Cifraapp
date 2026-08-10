import { err, isCurrencyCode, isPlainDate, ok, type PlainDate, type Result } from '@app/domain';

import { factKind, isKnownFact, type FactKind } from './facts.js';

/**
 * The rule language.
 *
 * A rule is `WHEN [condition] THEN [action]`, stored as structured JSON and
 * never as code. Nothing in this file evaluates an expression, compiles a
 * string, or reaches a property by name — a condition can only compare a fact
 * from the catalogue against a literal, and an action can only describe an
 * intent that some other part of the system decides whether to carry out.
 *
 * That separation is the security model and also the audit model. Because an
 * action is data, the same rule that fired can be replayed, explained, and shown
 * to the household months later exactly as it was written.
 *
 * The limits below exist because a rule arrives as JSON from a customer. A
 * thousand nested conditions is not a rule, it is a stack overflow with a name.
 */

export const MAX_CONDITION_DEPTH = 8;
export const MAX_CONDITIONS_PER_RULE = 32;
export const MAX_ACTIONS_PER_RULE = 8;

export type ComparisonOperator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq' | 'contains' | 'in';

export type Literal =
  | { readonly kind: 'money'; readonly amount: string; readonly currency: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'date'; readonly value: string }
  | { readonly kind: 'text_list'; readonly values: readonly string[] };

export interface FactComparison {
  readonly type: 'compare';
  /** A reference from the fact catalogue. Nothing else resolves. */
  readonly fact: string;
  readonly operator: ComparisonOperator;
  readonly value: Literal;
}

export type Condition =
  | FactComparison
  | { readonly type: 'all'; readonly of: readonly Condition[] }
  | { readonly type: 'any'; readonly of: readonly Condition[] }
  | { readonly type: 'not'; readonly of: Condition };

export type AllocationPriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * What a rule asks for. Every one of these is a request, not an effect — the
 * engine returns them and the allocation engine, the classifier or the
 * notification layer decides what to do about it.
 */
export type Action =
  | {
      readonly type: 'allocate_percentage';
      readonly target: string;
      /** Whole percent as a decimal string, `'15'` or `'12.5'`. */
      readonly percent: string;
    }
  | {
      readonly type: 'allocate_amount';
      readonly target: string;
      readonly amount: string;
      readonly currency: string;
    }
  | {
      readonly type: 'set_priority';
      readonly target: string;
      readonly priority: AllocationPriority;
    }
  | { readonly type: 'stop_allocation'; readonly target: string }
  | { readonly type: 'reserve_taxes_first' }
  | { readonly type: 'set_category'; readonly categoryId: string }
  | { readonly type: 'flag_for_review'; readonly reason: string };

export interface Rule {
  readonly id: string;
  readonly name: string;
  readonly when: Condition;
  readonly then: readonly Action[];
  /** Lower runs first. */
  readonly priority: number;
  readonly isActive: boolean;
  readonly effectiveFrom?: PlainDate | null;
  readonly effectiveTo?: PlainDate | null;
  /** Shown to the household verbatim. Written by whoever wrote the rule. */
  readonly explanation: string;
}

export interface RuleProblem {
  readonly path: string;
  readonly message: string;
}

/**
 * Checks a rule before it is stored or run.
 *
 * Called at both boundaries on purpose. Validating on write stops a bad rule
 * entering the database; validating on read stops a rule that was written before
 * a fact was renamed, or edited directly in the database, from reaching the
 * evaluator at all.
 */
export function validateRule(rule: Rule): Result<Rule, RuleProblem[]> {
  const problems: RuleProblem[] = [];

  if (!rule.name.trim()) {
    problems.push({ path: 'name', message: 'A rule needs a name the household will recognize.' });
  }
  if (!rule.explanation.trim()) {
    problems.push({
      path: 'explanation',
      message: 'A rule needs an explanation; an unexplained rule cannot be reviewed.',
    });
  }

  if (rule.effectiveFrom && !isPlainDate(rule.effectiveFrom)) {
    problems.push({ path: 'effectiveFrom', message: 'Not a calendar date.' });
  }
  if (rule.effectiveTo && !isPlainDate(rule.effectiveTo)) {
    problems.push({ path: 'effectiveTo', message: 'Not a calendar date.' });
  }
  if (rule.effectiveFrom && rule.effectiveTo && rule.effectiveTo < rule.effectiveFrom) {
    problems.push({ path: 'effectiveTo', message: 'A rule cannot end before it starts.' });
  }

  const counter = { conditions: 0 };
  validateCondition(rule.when, 'when', 1, counter, problems);

  if (rule.then.length === 0) {
    problems.push({ path: 'then', message: 'A rule that does nothing cannot be explained.' });
  }
  if (rule.then.length > MAX_ACTIONS_PER_RULE) {
    problems.push({
      path: 'then',
      message: `A rule may carry at most ${String(MAX_ACTIONS_PER_RULE)} actions.`,
    });
  }

  rule.then.forEach((action, index) => {
    validateAction(action, `then[${String(index)}]`, problems);
  });

  return problems.length === 0 ? ok(rule) : err(problems);
}

function validateCondition(
  condition: Condition,
  path: string,
  depth: number,
  counter: { conditions: number },
  problems: RuleProblem[],
): void {
  if (depth > MAX_CONDITION_DEPTH) {
    problems.push({
      path,
      message: `Conditions may nest ${String(MAX_CONDITION_DEPTH)} deep at most.`,
    });
    return;
  }

  counter.conditions += 1;
  if (counter.conditions > MAX_CONDITIONS_PER_RULE) {
    problems.push({
      path,
      message: `A rule may hold at most ${String(MAX_CONDITIONS_PER_RULE)} conditions.`,
    });
    return;
  }

  switch (condition.type) {
    case 'compare':
      validateComparison(condition, path, problems);
      return;
    case 'not':
      validateCondition(condition.of, `${path}.of`, depth + 1, counter, problems);
      return;
    case 'all':
    case 'any': {
      if (condition.of.length === 0) {
        problems.push({ path, message: 'An empty group decides nothing.' });
        return;
      }
      condition.of.forEach((child, index) => {
        validateCondition(child, `${path}.of[${String(index)}]`, depth + 1, counter, problems);
      });
      return;
    }
  }
}

function validateComparison(
  condition: FactComparison,
  path: string,
  problems: RuleProblem[],
): void {
  if (!isKnownFact(condition.fact)) {
    // The catalogue is the sandbox boundary. An unknown reference is refused
    // here rather than resolved to undefined somewhere downstream.
    problems.push({
      path: `${path}.fact`,
      message: `"${condition.fact}" is not something a rule can ask about.`,
    });
    return;
  }

  const kind = factKind(condition.fact);
  if (!kind) return;

  const literalKind = literalKindOf(condition.value);

  if (condition.operator === 'in') {
    if (condition.value.kind !== 'text_list') {
      problems.push({ path: `${path}.value`, message: '"in" compares against a list of values.' });
    } else if (kind !== 'text') {
      problems.push({
        path: `${path}.operator`,
        message: `"in" only applies to text, and ${condition.fact} is a ${kind}.`,
      });
    }
    return;
  }

  if (condition.operator === 'contains') {
    if (kind !== 'text' || literalKind !== 'text') {
      problems.push({
        path: `${path}.operator`,
        message: '"contains" only applies to text.',
      });
    }
    return;
  }

  if (literalKind !== kind) {
    problems.push({
      path: `${path}.value`,
      message: `${condition.fact} is a ${kind}; this compares it against a ${literalKind ?? 'list'}.`,
    });
    return;
  }

  if (condition.value.kind === 'money' && !isCurrencyCode(condition.value.currency)) {
    problems.push({ path: `${path}.value.currency`, message: 'Unknown currency.' });
  }
  if (condition.value.kind === 'date' && !isPlainDate(condition.value.value)) {
    problems.push({ path: `${path}.value.value`, message: 'Not a calendar date.' });
  }
}

function validateAction(action: Action, path: string, problems: RuleProblem[]): void {
  switch (action.type) {
    case 'allocate_percentage': {
      if (!action.target.trim()) {
        problems.push({ path: `${path}.target`, message: 'An allocation needs somewhere to go.' });
      }
      const percent = Number(action.percent);
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
        problems.push({
          path: `${path}.percent`,
          message: 'A percentage must be above 0 and at most 100.',
        });
      }
      return;
    }
    case 'allocate_amount': {
      if (!action.target.trim()) {
        problems.push({ path: `${path}.target`, message: 'An allocation needs somewhere to go.' });
      }
      if (!/^\d+(\.\d{1,4})?$/.test(action.amount)) {
        problems.push({ path: `${path}.amount`, message: 'Not a usable amount.' });
      }
      if (!isCurrencyCode(action.currency)) {
        problems.push({ path: `${path}.currency`, message: 'Unknown currency.' });
      }
      return;
    }
    case 'set_priority':
    case 'stop_allocation': {
      if (!action.target.trim()) {
        problems.push({ path: `${path}.target`, message: 'This action needs a target.' });
      }
      return;
    }
    case 'set_category': {
      if (!action.categoryId.trim()) {
        problems.push({ path: `${path}.categoryId`, message: 'This action needs a category.' });
      }
      return;
    }
    case 'flag_for_review': {
      if (!action.reason.trim()) {
        problems.push({
          path: `${path}.reason`,
          message: 'A review flag with no reason tells nobody anything.',
        });
      }
      return;
    }
    case 'reserve_taxes_first':
      return;
  }
}

function literalKindOf(literal: Literal): FactKind | null {
  switch (literal.kind) {
    case 'money':
      return 'money';
    case 'number':
      return 'number';
    case 'text':
      return 'text';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'text_list':
      return null;
  }
}
