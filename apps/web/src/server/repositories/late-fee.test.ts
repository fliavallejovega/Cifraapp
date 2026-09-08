import { Money, toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { penaltyStillAtStake } from './late-fee';

/**
 * Turning a stated late charge into money, which is where «5%» could become «$5».
 *
 * The household states the charge in one of two shapes and the shapes live in
 * separate columns precisely so they cannot be confused — but the confusion
 * would happen here, in the one function that reads both. On a nine-hundred
 * dollar rent the two answers are $45 and $5, and nothing about the digit 5
 * says which was meant.
 */

const usd = (value: string) => Money.fromDecimalString(value, 'USD');
const RENT = usd('900.00');
const DUE = toPlainDate('2026-09-05');
const TODAY = toPlainDate('2026-09-08');

const row = (over: Partial<Parameters<typeof penaltyStillAtStake>[0]> = {}) => ({
  lateFeeAmount: null,
  lateFeeRate: null,
  lateFeeAfterDays: null,
  ...over,
});

describe('what is still at stake on an unpaid bill', () => {
  it('reads a rate as a share of what is owed, not as an amount', () => {
    const stake = penaltyStillAtStake(
      row({ lateFeeRate: '5.000', lateFeeAfterDays: 10 }),
      RENT,
      DUE,
      TODAY,
    );
    expect(stake?.toDecimalString()).toBe('45.0000');
  });

  it('reads an amount as itself', () => {
    const stake = penaltyStillAtStake(
      row({ lateFeeAmount: '5.0000', lateFeeAfterDays: 10 }),
      RENT,
      DUE,
      TODAY,
    );
    expect(stake?.toDecimalString()).toBe('5.0000');
  });

  it('keeps every decimal of a rate the household actually stated', () => {
    // 5.125% of 900 is 46.125, which is a real figure and not 46.13 until
    // something decides to round it. Money rounds once, at the end.
    const stake = penaltyStillAtStake(
      row({ lateFeeRate: '5.125', lateFeeAfterDays: 10 }),
      RENT,
      DUE,
      TODAY,
    );
    expect(stake?.toDecimalString()).toBe('46.1250');
  });

  it('reports nothing when nothing was stated', () => {
    // Null is «nothing known to be at stake», which is not «there is no fee».
    // The product does not read a blank as a promise.
    expect(penaltyStillAtStake(row(), RENT, DUE, TODAY)).toBeNull();
  });

  it('reports nothing for a charge stated as zero', () => {
    expect(
      penaltyStillAtStake(row({ lateFeeAmount: '0.0000', lateFeeAfterDays: 10 }), RENT, DUE, TODAY),
    ).toBeNull();
    expect(
      penaltyStillAtStake(row({ lateFeeRate: '0.000', lateFeeAfterDays: 10 }), RENT, DUE, TODAY),
    ).toBeNull();
  });

  it('reports nothing once the charge has already been applied', () => {
    // Due the 5th with three days of grace. The boundary is fixed by the
    // zero-grace case below: «cobran desde el primer día» charges on the first
    // day late, so N days of grace charge on day N+1. Three days of grace
    // therefore stay avoidable through the 8th and are charged from the 9th.
    const stillAvoidable = penaltyStillAtStake(
      row({ lateFeeRate: '5.000', lateFeeAfterDays: 3 }),
      RENT,
      DUE,
      TODAY,
    );
    expect(stillAvoidable?.toDecimalString()).toBe('45.0000');

    // One day on, the fee is charged. Paying now does not undo it, so ranking
    // this bill above one whose charge can still be dodged would spend scarce
    // money to buy nothing.
    const sunk = penaltyStillAtStake(
      row({ lateFeeRate: '5.000', lateFeeAfterDays: 3 }),
      RENT,
      DUE,
      toPlainDate('2026-09-09'),
    );
    expect(sunk).toBeNull();
  });

  it('treats a stated fee with no stated grace as charging from day one', () => {
    // Which is what the form's own hint says, and the opposite of inventing a
    // grace period nobody mentioned.
    const onDueDate = penaltyStillAtStake(row({ lateFeeAmount: '25.0000' }), RENT, DUE, DUE);
    expect(onDueDate?.toDecimalString()).toBe('25.0000');

    const dayAfter = penaltyStillAtStake(
      row({ lateFeeAmount: '25.0000' }),
      RENT,
      DUE,
      toPlainDate('2026-09-06'),
    );
    expect(dayAfter).toBeNull();
  });
});
