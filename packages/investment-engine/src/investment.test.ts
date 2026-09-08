import { Money } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { projectContribution, requiredContribution } from './contribution.js';
import { affordable, planForGoal } from './plan.js';
import { DEFAULT_BANDS, suitsHorizon } from './risk.js';

/**
 * The arithmetic a household could check on paper.
 *
 * Every case here is one somebody could verify with a calculator, which is the
 * standard this module has to meet: a figure telling a person how much to put
 * aside every month for five years has to be reproducible, or it is a number
 * they are being asked to take on faith.
 */

const usd = (value: string) => Money.fromDecimalString(value, 'USD');

describe('required contribution', () => {
  it('is the plain division when no growth is assumed', () => {
    // $6,000 in 24 months, nothing saved: $250 a month, and nothing subtle.
    const result = requiredContribution({
      target: usd('6000'),
      current: usd('0'),
      months: 24,
      annualRatePercent: '0',
    });

    expect(result.monthly.toDecimalString()).toBe('250.0000');
    expect(result.contributed.toDecimalString()).toBe('6000.0000');
    expect(result.growth.toDecimalString()).toBe('0.0000');
  });

  it('subtracts what is already saved before dividing', () => {
    const result = requiredContribution({
      target: usd('6000'),
      current: usd('1200'),
      months: 24,
      annualRatePercent: '0',
    });

    expect(result.monthly.toDecimalString()).toBe('200.0000');
  });

  it('rounds up, because rounding down misses the target by construction', () => {
    // $1,000 over 3 months is $333.33…; a third of a cent short every month.
    const result = requiredContribution({
      target: usd('1000'),
      current: usd('0'),
      months: 3,
      annualRatePercent: '0',
    });

    expect(result.monthly.toDecimalString()).toBe('333.3400');
    expect(result.contributed.greaterThanOrEqual(usd('1000'))).toBe(true);
  });

  it('asks for less when growth is assumed, and says how much less', () => {
    const flat = requiredContribution({
      target: usd('12000'),
      current: usd('0'),
      months: 60,
      annualRatePercent: '0',
    });

    const growing = requiredContribution({
      target: usd('12000'),
      current: usd('0'),
      months: 60,
      annualRatePercent: '6',
    });

    expect(growing.monthly.lessThan(flat.monthly)).toBe(true);
    // The difference is what the assumption is doing, and it is reported.
    expect(growing.growth.isPositive()).toBe(true);
  });

  it('asks for nothing when the balance gets there on its own', () => {
    const result = requiredContribution({
      target: usd('1000'),
      current: usd('900'),
      months: 120,
      annualRatePercent: '8',
    });

    expect(result.monthly.isZero()).toBe(true);
    expect(result.unreachable).toBe(false);
  });

  it('asks for nothing when the target is already met', () => {
    const result = requiredContribution({
      target: usd('5000'),
      current: usd('5000'),
      months: 12,
      annualRatePercent: '6',
    });

    expect(result.monthly.isZero()).toBe(true);
  });

  it('says «unreachable» rather than «$0 a month» when the date is today', () => {
    const result = requiredContribution({
      target: usd('5000'),
      current: usd('100'),
      months: 0,
      annualRatePercent: '6',
    });

    expect(result.unreachable).toBe(true);
    expect(result.monthly.isZero()).toBe(true);
  });

  it('round-trips against the projection it is derived from', () => {
    // The strongest check available: what the engine says to contribute must
    // land on the target when the engine projects that same contribution.
    const target = usd('20000');
    const required = requiredContribution({
      target,
      current: usd('2500'),
      months: 84,
      annualRatePercent: '7',
    });

    const landed = projectContribution({
      monthly: required.monthly,
      current: usd('2500'),
      months: 84,
      annualRatePercent: '7',
    });

    expect(landed.greaterThanOrEqual(target)).toBe(true);
    // And not wildly over: rounding up a cent a month, not a dollar.
    expect(landed.subtract(target).lessThan(usd('50'))).toBe(true);
  });
});

describe('projection', () => {
  it('is contributions plus the balance when no growth is assumed', () => {
    const landed = projectContribution({
      monthly: usd('100'),
      current: usd('500'),
      months: 10,
      annualRatePercent: '0',
    });

    expect(landed.toDecimalString()).toBe('1500.0000');
  });

  it('returns today when the horizon is zero', () => {
    const landed = projectContribution({
      monthly: usd('100'),
      current: usd('500'),
      months: 0,
      annualRatePercent: '9',
    });

    expect(landed.toDecimalString()).toBe('500.0000');
  });

  it('handles a negative assumption without pretending it is growth', () => {
    const landed = projectContribution({
      monthly: usd('100'),
      current: usd('10000'),
      months: 36,
      annualRatePercent: '-2',
    });

    // Contributions still add up; the balance still shrinks against them.
    expect(landed.lessThan(usd('13600'))).toBe(true);
  });
});

describe('the plan across risk levels', () => {
  const goal = {
    id: 'goal-1',
    name: 'Fondo de emergencia',
    target: usd('12000'),
    current: usd('1000'),
    months: 48,
  };

  it('asks for less as the assumed return rises', () => {
    const plan = planForGoal(goal);
    const monthly = plan.outcomes.map((outcome) => Number(outcome.monthly.toDecimalString()));

    // cash → conservative → balanced → growth, each asking for less:
    // 218.73, 208.40, 198.35, 188.57 on this goal.
    expect(monthly).toEqual([...monthly].sort((a, b) => b - a));
    expect(monthly[0]).toBeGreaterThan(monthly[3] ?? 0);
    expect(plan.withoutGrowth.greaterThan(plan.outcomes[3]?.monthly ?? usd('0'))).toBe(true);
  });

  it('reports the range each level implies, not a single number', () => {
    const plan = planForGoal(goal);
    const growth = plan.outcomes.find((outcome) => outcome.level === 'growth');

    expect(growth).toBeDefined();
    expect(growth?.ifPoor.lessThan(growth.ifExpected)).toBe(true);
    expect(growth?.ifGood.greaterThan(growth.ifExpected)).toBe(true);
  });

  it('flags a level whose horizon is too short, whatever the arithmetic says', () => {
    const soon = planForGoal({ ...goal, months: 18 });

    expect(soon.outcomes.find((outcome) => outcome.level === 'growth')?.tooShort).toBe(true);
    expect(soon.outcomes.find((outcome) => outcome.level === 'cash')?.tooShort).toBe(false);
  });

  it('states the fall a bad year would take off the balance', () => {
    const plan = planForGoal(goal);
    const growth = plan.outcomes.find((outcome) => outcome.level === 'growth');

    // Half of where the money would be, for a mix that has historically halved.
    expect(growth?.drawdownAtWorst.isPositive()).toBe(true);
    expect(growth?.drawdownAtWorst.lessThan(growth.ifExpected)).toBe(true);
  });

  it('keeps only what the household can actually put in', () => {
    const plan = planForGoal(goal);

    // $11,000 over 48 months costs $229.17 with no growth and $188.57 at the
    // growth assumption, so $200 buys the two riskier levels and not the two
    // safer ones — which is exactly the trade the screen has to show.
    const within = affordable(plan, usd('200'));

    expect(within.map((outcome) => outcome.level)).toEqual(['balanced', 'growth']);
    for (const outcome of within) {
      expect(outcome.monthly.lessThanOrEqual(usd('200'))).toBe(true);
    }

    // And says nothing fits when nothing does, rather than proposing anyway.
    expect(affordable(plan, usd('5'))).toEqual([]);
  });
});

describe('risk bands', () => {
  it('never expresses a level as a single rate', () => {
    for (const band of Object.values(DEFAULT_BANDS)) {
      expect(Number(band.low)).toBeLessThan(Number(band.high));
    }
  });

  it('requires a longer horizon as the equity share rises', () => {
    expect(suitsHorizon(DEFAULT_BANDS.growth, 24)).toBe(false);
    expect(suitsHorizon(DEFAULT_BANDS.growth, 72)).toBe(true);
    expect(suitsHorizon(DEFAULT_BANDS.cash, 1)).toBe(true);
  });
});
