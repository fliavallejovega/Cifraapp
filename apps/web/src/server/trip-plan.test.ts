import { Money, toPlainDate } from '@app/domain';
import { computeTripBudget } from '@app/trip-engine';
import { describe, expect, it } from 'vitest';

import { goalDeadline, monthsUntil, planTripGoal, toEngineInput, type TripRow } from './trip-plan';

const usd = (value: string) => Money.fromDecimalString(value, 'USD');

const trip: TripRow = {
  startDate: '2027-07-01',
  endDate: '2027-07-07',
  baseCurrency: 'USD',
  totalBudget: '3000.0000',
  contingencyType: 'percent',
  contingencyValue: '10.0000',
  profile: 'balanced',
  customShares: null,
  includeArrivalDay: true,
  includeDepartureDay: true,
  partialDayWeight: '0.500',
  rollingPolicy: 'rolling',
  reserveReleased: '0.0000',
  planningFx: { EUR: { rate: '0.9200000000', date: '2027-01-15' } },
};

const minorUnits = new Map([
  ['USD', 2],
  ['EUR', 2],
]);

function input(overrides: Partial<Parameters<typeof toEngineInput>[0]> = {}) {
  return toEngineInput({
    trip,
    legs: [
      {
        id: 'mad',
        arrivalDate: '2027-07-01',
        departureDate: '2027-07-07',
        costIndex: '1.00',
        lodgingMode: 'prepaid',
        localCurrency: 'EUR',
      },
    ],
    travelers: [{ id: 't', weight: '1.000' }],
    bookings: [
      {
        id: 'f',
        bookingType: 'flight',
        paymentStatus: 'paid',
        amountBase: '1200.0000',
        amount: '1200.0000',
        paidAmount: '0',
        legId: null,
        startsAt: null,
        endsAt: null,
      },
      {
        id: 'h',
        bookingType: 'lodging',
        paymentStatus: 'deposit_paid',
        amountBase: '700.0000',
        amount: '644.0000',
        paidAmount: '322.0000',
        legId: 'mad',
        startsAt: null,
        endsAt: null,
      },
    ],
    overrides: [{ tripDay: null, legId: null, category: 'flights', amount: '1' }],
    spent: [],
    minorUnits,
    latestRates: new Map(),
    today: toPlainDate('2027-01-15'),
    ...overrides,
  });
}

describe('toEngineInput', () => {
  it('reads the database rows into the engine’s shape and computes', () => {
    const budget = computeTripBudget(input());
    expect(budget.commitments.prepaid).toBe('1550.00');
    expect(budget.commitments.pending).toBe('350.00');
    expect(budget.legs[0]?.perDiemFullLocal).toBe('151.80');
  });

  it('scales a partly paid booking by its own base price', () => {
    expect(input().bookings[1]?.paidBase).toBe('350.0000');
  });

  it('drops overrides for categories the days do not have', () => {
    expect(input().overrides).toEqual([]);
  });

  it('applies a scenario’s fund, profile and exchange shift', () => {
    const shifted = input({
      scenario: { totalBudget: '4000.00', profile: 'comfort', fxShiftPercent: '10' },
    });
    expect(shifted.totalBudget).toBe('4000.00');
    expect(shifted.profile).toBe('comfort');
    // EUR 10 % more expensive: fewer euros per dollar.
    expect(shifted.legs[0]?.fxRate).toBe('0.8363636364');
  });

  it('turns spending into positive amounts and files unknown categories under other', () => {
    const spent = input({ spent: [{ day: '2027-07-02', category: null, spent: '12.5000' }] }).spent;
    expect(spent).toEqual([{ day: '2027-07-02', category: 'other', amount: '12.5000' }]);
  });
});

describe('planTripGoal', () => {
  const today = toPlainDate('2027-01-15');
  const deadline = toPlainDate('2027-06-24');

  it('counts whole months to the deadline', () => {
    expect(monthsUntil(today, deadline)).toBe(5);
    expect(monthsUntil(today, toPlainDate('2027-01-20'))).toBe(1);
    expect(goalDeadline(toPlainDate('2027-07-01'))).toBe('2027-06-24');
  });

  it('is green when the contribution fits after the other goals', () => {
    const plan = planTripGoal({
      target: usd('3000'),
      saved: usd('500'),
      today,
      deadline,
      monthlyCapacity: usd('900'),
      otherGoalsMonthly: usd('200'),
    });
    expect(plan.light).toBe('green');
    expect(plan.monthly.toDecimalString()).toBe('500.0000');
  });

  it('is yellow when other goals must give up some of theirs, and says how much', () => {
    const plan = planTripGoal({
      target: usd('3000'),
      saved: usd('500'),
      today,
      deadline,
      monthlyCapacity: usd('600'),
      otherGoalsMonthly: usd('300'),
    });
    expect(plan.light).toBe('yellow');
    expect(plan.squeeze?.toDecimalString()).toBe('200.0000');
  });

  it('is red when it does not fit, with the months and the fund that would', () => {
    const plan = planTripGoal({
      target: usd('3000'),
      saved: usd('500'),
      today,
      deadline,
      monthlyCapacity: usd('400'),
      otherGoalsMonthly: usd('150'),
    });
    expect(plan.light).toBe('red');
    expect(plan.monthsNeeded).toBe(10);
    expect(plan.affordableTotal?.toDecimalString()).toBe('1750.0000');
  });

  it('rounds the monthly figure up so the plan reaches the target', () => {
    const plan = planTripGoal({
      target: usd('1000'),
      saved: usd('0'),
      today,
      deadline: toPlainDate('2027-04-15'),
      monthlyCapacity: usd('5000'),
      otherGoalsMonthly: usd('0'),
    });
    expect(plan.months).toBe(3);
    expect(plan.monthly.toDecimalString()).toBe('333.3400');
  });
});
