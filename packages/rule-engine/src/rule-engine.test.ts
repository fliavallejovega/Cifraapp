import { isErr, isOk, Money, toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { evaluateCondition, evaluateRules, recordExecution } from './evaluate.js';
import { isKnownFact, listFacts, type FactSet, type FactValue } from './facts.js';
import { MAX_CONDITION_DEPTH, validateRule, type Condition, type Rule } from './schema.js';

const TODAY = toPlainDate('2026-08-15');

const money = (value: string): FactValue => ({
  kind: 'money',
  value: Money.fromDecimalString(value, 'USD'),
});
const number = (value: number): FactValue => ({ kind: 'number', value });
const text = (value: string): FactValue => ({ kind: 'text', value });

function facts(entries: Record<string, FactValue>): FactSet {
  return new Map(Object.entries(entries));
}

function rule(overrides: Partial<Rule> & Pick<Rule, 'id' | 'when'>): Rule {
  return {
    name: 'A rule',
    then: [{ type: 'allocate_percentage', target: 'goal:emergency-fund', percent: '15' }],
    priority: 100,
    isActive: true,
    explanation: 'Because the emergency fund comes first.',
    ...overrides,
  };
}

/** The specification's own example rules. */
const EMERGENCY_FUND_LOW: Condition = {
  type: 'compare',
  fact: 'goal.balance.emergency-fund',
  operator: 'lt',
  value: { kind: 'money', amount: '5000.00', currency: 'USD' },
};

const HIGH_APR: Condition = {
  type: 'compare',
  fact: 'debt.apr.mastercard',
  operator: 'gt',
  value: { kind: 'number', value: 20 },
};

describe('the rule language is data, not code', () => {
  it('refuses a fact that is not in the catalogue', () => {
    // The catalogue is the sandbox. There is no property path to traverse and
    // nothing to escape from, because nothing is ever evaluated as an expression.
    const result = validateRule(
      rule({
        id: 'r1',
        when: {
          type: 'compare',
          fact: 'household.owner.password',
          operator: 'eq',
          value: { kind: 'text', value: 'x' },
        },
      }),
    );

    expect(isErr(result)).toBe(true);
    expect(isKnownFact('household.owner.password')).toBe(false);
  });

  it('accepts a scoped reference to one household record', () => {
    expect(isKnownFact('goal.balance.emergency-fund')).toBe(true);
    expect(isKnownFact('debt.apr.mastercard')).toBe(true);
    expect(isKnownFact('goal.balance')).toBe(true);
  });

  it('refuses a bare prefix pretending to be a scoped reference', () => {
    expect(isKnownFact('goal.balance.')).toBe(false);
    expect(isKnownFact('goal')).toBe(false);
  });

  it('publishes its field list for a builder', () => {
    const fields = listFacts();
    expect(fields.length).toBeGreaterThan(10);
    expect(fields.every((field) => field.kind.length > 0)).toBe(true);
  });
});

describe('rule validation', () => {
  it('refuses a condition nested past the limit', () => {
    // A thousand nested conditions is not a rule, it is a stack overflow with a
    // name — and it arrives as JSON from a customer.
    let condition: Condition = EMERGENCY_FUND_LOW;
    for (let depth = 0; depth < MAX_CONDITION_DEPTH + 2; depth += 1) {
      condition = { type: 'not', of: condition };
    }

    expect(isErr(validateRule(rule({ id: 'r1', when: condition })))).toBe(true);
  });

  it('refuses a rule that does nothing', () => {
    expect(isErr(validateRule(rule({ id: 'r1', when: EMERGENCY_FUND_LOW, then: [] })))).toBe(true);
  });

  it('refuses a rule with no explanation', () => {
    const result = validateRule(rule({ id: 'r1', when: EMERGENCY_FUND_LOW, explanation: '  ' }));
    expect(isErr(result)).toBe(true);
  });

  it('refuses comparing a money fact against a number', () => {
    const result = validateRule(
      rule({
        id: 'r1',
        when: {
          type: 'compare',
          fact: 'goal.balance.emergency-fund',
          operator: 'lt',
          value: { kind: 'number', value: 5000 },
        },
      }),
    );

    expect(isErr(result)).toBe(true);
  });

  it('refuses an allocation percentage outside 0–100', () => {
    const result = validateRule(
      rule({
        id: 'r1',
        when: EMERGENCY_FUND_LOW,
        then: [{ type: 'allocate_percentage', target: 'goal:x', percent: '150' }],
      }),
    );

    expect(isErr(result)).toBe(true);
  });

  it('refuses an empty group', () => {
    expect(isErr(validateRule(rule({ id: 'r1', when: { type: 'all', of: [] } })))).toBe(true);
  });

  it('accepts the examples from the specification', () => {
    expect(isOk(validateRule(rule({ id: 'r1', when: EMERGENCY_FUND_LOW })))).toBe(true);
    expect(
      isOk(
        validateRule(
          rule({
            id: 'r2',
            when: HIGH_APR,
            then: [{ type: 'set_priority', target: 'debt:mastercard', priority: 'critical' }],
          }),
        ),
      ),
    ).toBe(true);
    expect(
      isOk(
        validateRule(
          rule({
            id: 'r3',
            when: {
              type: 'compare',
              fact: 'income.type',
              operator: 'eq',
              value: { kind: 'text', value: 'freelance' },
            },
            then: [{ type: 'reserve_taxes_first' }],
          }),
        ),
      ),
    ).toBe(true);
  });
});

describe('three-valued evaluation', () => {
  it('fires when the condition holds', () => {
    const result = evaluateRules(
      [rule({ id: 'r1', when: EMERGENCY_FUND_LOW })],
      facts({ 'goal.balance.emergency-fund': money('1200.00') }),
      { on: TODAY },
    );

    expect(result.matched).toHaveLength(1);
    expect(result.actions).toHaveLength(1);
  });

  it('does not fire when the condition fails', () => {
    const result = evaluateRules(
      [rule({ id: 'r1', when: EMERGENCY_FUND_LOW })],
      facts({ 'goal.balance.emergency-fund': money('8000.00') }),
      { on: TODAY },
    );

    expect(result.matched).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('skips rather than guessing when the fact is missing', () => {
    // A household with no emergency fund. Treating the missing balance as zero
    // routes money into an account that does not exist; treating it as false
    // does nothing and never says why.
    const result = evaluateRules([rule({ id: 'r1', when: EMERGENCY_FUND_LOW })], facts({}), {
      on: TODAY,
    });

    expect(result.matched).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe('missing_fact');
    expect(result.skipped[0]?.missingFact).toBe('goal.balance.emergency-fund');
  });

  it('keeps unknown unknown through a negation', () => {
    expect(evaluateCondition({ type: 'not', of: EMERGENCY_FUND_LOW }, facts({}))).toBe('unknown');
  });

  it('settles an ALL group on a definite false despite an unknown', () => {
    // The group cannot become true whatever the missing fact turns out to be.
    const truth = evaluateCondition(
      { type: 'all', of: [EMERGENCY_FUND_LOW, HIGH_APR] },
      facts({ 'goal.balance.emergency-fund': money('9000.00') }),
    );

    expect(truth).toBe('false');
  });

  it('settles an ANY group on a definite true despite an unknown', () => {
    const truth = evaluateCondition(
      { type: 'any', of: [EMERGENCY_FUND_LOW, HIGH_APR] },
      facts({ 'goal.balance.emergency-fund': money('1200.00') }),
    );

    expect(truth).toBe('true');
  });

  it('refuses to compare across currencies', () => {
    // There is no exchange rate in this system, by design.
    const truth = evaluateCondition(
      EMERGENCY_FUND_LOW,
      facts({
        'goal.balance.emergency-fund': {
          kind: 'money',
          value: Money.fromDecimalString('1200.00', 'PAB'),
        },
      }),
    );

    expect(truth).toBe('unknown');
  });
});

describe('when a rule is in force', () => {
  it('ignores a rule that is switched off', () => {
    const result = evaluateRules(
      [rule({ id: 'r1', when: EMERGENCY_FUND_LOW, isActive: false })],
      facts({ 'goal.balance.emergency-fund': money('1200.00') }),
      { on: TODAY },
    );

    expect(result.skipped[0]?.reason).toBe('inactive');
  });

  it('ignores a rule that has expired', () => {
    const result = evaluateRules(
      [
        rule({
          id: 'r1',
          when: EMERGENCY_FUND_LOW,
          effectiveTo: toPlainDate('2026-06-30'),
        }),
      ],
      facts({ 'goal.balance.emergency-fund': money('1200.00') }),
      { on: TODAY },
    );

    expect(result.skipped[0]?.reason).toBe('expired');
  });

  it('ignores a rule that has not started', () => {
    const result = evaluateRules(
      [rule({ id: 'r1', when: EMERGENCY_FUND_LOW, effectiveFrom: toPlainDate('2026-09-01') })],
      facts({ 'goal.balance.emergency-fund': money('1200.00') }),
      { on: TODAY },
    );

    expect(result.skipped[0]?.reason).toBe('not_yet_effective');
  });

  it('refuses to run a rule that is no longer valid', () => {
    // Edited directly in the database, or written before a fact was renamed.
    const result = evaluateRules(
      [
        rule({
          id: 'r1',
          when: {
            type: 'compare',
            fact: 'nothing.at.all',
            operator: 'eq',
            value: { kind: 'text', value: 'x' },
          },
        }),
      ],
      facts({}),
      { on: TODAY },
    );

    expect(result.skipped[0]?.reason).toBe('invalid');
  });
});

describe('ordering and audit', () => {
  it('runs rules in priority order, deterministically', () => {
    const result = evaluateRules(
      [
        rule({ id: 'bbb', when: EMERGENCY_FUND_LOW, priority: 10 }),
        rule({ id: 'aaa', when: EMERGENCY_FUND_LOW, priority: 10 }),
        rule({ id: 'ccc', when: EMERGENCY_FUND_LOW, priority: 1 }),
      ],
      facts({ 'goal.balance.emergency-fund': money('1200.00') }),
      { on: TODAY },
    );

    expect(result.matched.map((entry) => entry.ruleId)).toEqual(['ccc', 'aaa', 'bbb']);
  });

  it('records the rules that did not fire, not only the ones that did', () => {
    // "Why did nothing happen?" cannot be answered from a log of matches only.
    const result = evaluateRules(
      [
        rule({ id: 'fired', when: EMERGENCY_FUND_LOW }),
        rule({ id: 'off', when: EMERGENCY_FUND_LOW, isActive: false }),
      ],
      facts({ 'goal.balance.emergency-fund': money('1200.00') }),
      { on: TODAY },
    );

    const executions = recordExecution(result);
    expect(executions).toHaveLength(2);
    expect(executions.find((entry) => entry.ruleId === 'off')?.matched).toBe(false);
    expect(executions.find((entry) => entry.ruleId === 'off')?.explanation).toContain('turned off');
  });
});

describe('text comparisons', () => {
  it('matches a value in a list', () => {
    const truth = evaluateCondition(
      {
        type: 'compare',
        fact: 'income.type',
        operator: 'in',
        value: { kind: 'text_list', values: ['freelance', 'consulting'] },
      },
      facts({ 'income.type': text('freelance') }),
    );

    expect(truth).toBe('true');
  });

  it('matches a substring case-insensitively', () => {
    const truth = evaluateCondition(
      {
        type: 'compare',
        fact: 'transaction.merchant',
        operator: 'contains',
        value: { kind: 'text', value: 'adobe' },
      },
      facts({ 'transaction.merchant': text('ADOBE INC') }),
    );

    expect(truth).toBe('true');
  });

  it('compares a plain number', () => {
    expect(evaluateCondition(HIGH_APR, facts({ 'debt.apr.mastercard': number(24.5) }))).toBe(
      'true',
    );
    expect(evaluateCondition(HIGH_APR, facts({ 'debt.apr.mastercard': number(18.9) }))).toBe(
      'false',
    );
  });
});
