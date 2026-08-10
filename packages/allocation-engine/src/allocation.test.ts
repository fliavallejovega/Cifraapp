import { Money, toPlainDate } from '@app/domain';
import type { Action } from '@app/rule-engine';
import { describe, expect, it } from 'vitest';

import { buildAllocationPlan } from './allocate.js';
import { applyRuleActions } from './rules.js';
import { DEFAULT_PRIORITY_ORDER, type Claim } from './types.js';

const usd = (value: string): Money => Money.fromDecimalString(value, 'USD');
const TODAY = toPlainDate('2026-08-15');

/**
 * The deterministic fixture household from the specification: Alex and Taylor,
 * a Visa at 18.9% and a Mastercard at 24.5%, an emergency fund target of $5,000
 * and a travel fund of $2,000.
 */
const RENT: Claim = {
  id: 'rent',
  kind: 'upcoming_essential',
  label: 'Rent',
  target: 'obligation:rent',
  requested: usd('900.00'),
  dueDate: toPlainDate('2026-09-01'),
};

const ELECTRICITY: Claim = {
  id: 'electricity',
  kind: 'overdue_essential',
  label: 'Electricity',
  target: 'obligation:electricity',
  requested: usd('86.40'),
  dueDate: toPlainDate('2026-08-10'),
};

const VISA_MINIMUM: Claim = {
  id: 'visa-min',
  kind: 'debt_minimum',
  label: 'Visa',
  target: 'debt:visa',
  requested: usd('96.00'),
  apr: '18.900',
};

const MASTERCARD_MINIMUM: Claim = {
  id: 'mastercard-min',
  kind: 'debt_minimum',
  label: 'Mastercard',
  target: 'debt:mastercard',
  requested: usd('54.00'),
  apr: '24.500',
};

const TAX_RESERVE: Claim = {
  id: 'tax',
  kind: 'tax_reserve',
  label: 'Tax reserve',
  target: 'tax:reserve',
  requested: usd('420.00'),
};

const EMERGENCY_FUND: Claim = {
  id: 'emergency',
  kind: 'emergency_fund',
  label: 'Emergency fund',
  target: 'goal:emergency-fund',
  requested: usd('300.00'),
};

const MASTERCARD_EXTRA: Claim = {
  id: 'mastercard-extra',
  kind: 'high_interest_debt',
  label: 'Mastercard',
  target: 'debt:mastercard-extra',
  requested: usd('600.00'),
  apr: '24.500',
};

const TRAVEL: Claim = {
  id: 'travel',
  kind: 'goal',
  label: 'Travel fund',
  target: 'goal:travel',
  requested: usd('200.00'),
};

const ALL_CLAIMS = [
  RENT,
  ELECTRICITY,
  VISA_MINIMUM,
  MASTERCARD_MINIMUM,
  TAX_RESERVE,
  EMERGENCY_FUND,
  MASTERCARD_EXTRA,
  TRAVEL,
];

describe('the waterfall', () => {
  it('pays the overdue bill before anything else', () => {
    const plan = buildAllocationPlan({
      incoming: usd('2400.00'),
      claims: ALL_CLAIMS,
      today: TODAY,
    });

    expect(plan.lines[0]?.claimId).toBe('electricity');
    expect(plan.lines[0]?.allocated.toCurrencyString()).toBe('86.40');
  });

  it('follows the ladder in order', () => {
    const plan = buildAllocationPlan({
      incoming: usd('2400.00'),
      claims: ALL_CLAIMS,
      today: TODAY,
    });

    const kinds = plan.lines.map((line) => line.kind);
    const rank = (kind: string): number => DEFAULT_PRIORITY_ORDER.indexOf(kind as never);

    for (let index = 1; index < kinds.length; index += 1) {
      expect(rank(kinds[index]!)).toBeGreaterThanOrEqual(rank(kinds[index - 1]!));
    }
  });

  it('never invents or loses a cent', () => {
    // Money.allocate was built exact in Phase 0 for exactly this: a plan whose
    // lines do not sum to its total is a plan nobody can reconcile.
    const plan = buildAllocationPlan({
      incoming: usd('1234.57'),
      claims: ALL_CLAIMS,
      today: TODAY,
    });

    const summed = Money.sum(
      plan.lines.map((line) => line.allocated),
      'USD',
    );

    expect(summed.equals(plan.allocated)).toBe(true);
    expect(plan.allocated.add(plan.unallocated).equals(plan.incoming)).toBe(true);
  });

  it('leaves the surplus unallocated rather than padding a tier', () => {
    const plan = buildAllocationPlan({
      incoming: usd('5000.00'),
      claims: ALL_CLAIMS,
      today: TODAY,
    });

    expect(plan.fullyFunded).toBe(true);
    expect(plan.unallocated.isPositive()).toBe(true);
    expect(plan.shortfall.isZero()).toBe(true);
  });

  it('is deterministic', () => {
    const first = buildAllocationPlan({
      incoming: usd('980.00'),
      claims: ALL_CLAIMS,
      today: TODAY,
    });
    const second = buildAllocationPlan({
      incoming: usd('980.00'),
      claims: [...ALL_CLAIMS].reverse(),
      today: TODAY,
    });

    expect(first.lines.map((line) => line.claimId)).toEqual(
      second.lines.map((line) => line.claimId),
    );
    expect(first.allocated.equals(second.allocated)).toBe(true);
  });
});

describe('how a tier splits money it cannot cover', () => {
  it('settles one essential in full rather than leaving two half-paid', () => {
    // A half-paid electric bill is still a disconnection. Ordering is what stops
    // the tier producing two of them — the remainder still reaches the second
    // bill, and the gap is reported rather than hidden.
    const water: Claim = {
      ...ELECTRICITY,
      id: 'water',
      label: 'Water',
      target: 'obligation:water',
    };
    const plan = buildAllocationPlan({
      incoming: usd('100.00'),
      claims: [ELECTRICITY, water],
      today: TODAY,
    });

    const settled = plan.lines.filter((line) => line.allocated.equals(line.requested));
    expect(settled).toHaveLength(1);
    expect(settled[0]?.claimId).toBe('electricity');

    const partial = plan.lines.find((line) => line.claimId === 'water');
    expect(partial?.allocated.toCurrencyString()).toBe('13.60');
    expect(partial?.shortfall.toCurrencyString()).toBe('72.80');
    expect(plan.fullyFunded).toBe(false);
  });

  it('splits two equal-priority goals proportionally', () => {
    // Giving two goals the same priority is the household saying "both".
    const boat: Claim = { ...TRAVEL, id: 'boat', label: 'Boat', target: 'goal:boat' };
    const plan = buildAllocationPlan({
      incoming: usd('100.00'),
      claims: [TRAVEL, boat],
      today: TODAY,
    });

    expect(plan.lines[0]?.allocated.toCurrencyString()).toBe('50.00');
    expect(plan.lines[1]?.allocated.toCurrencyString()).toBe('50.00');
    expect(plan.allocated.toCurrencyString()).toBe('100.00');
  });

  it('splits an odd amount exactly, with nothing left over', () => {
    const boat: Claim = { ...TRAVEL, id: 'boat', label: 'Boat', target: 'goal:boat' };
    const third: Claim = { ...TRAVEL, id: 'third', label: 'Roof', target: 'goal:roof' };

    const plan = buildAllocationPlan({
      incoming: usd('100.01'),
      claims: [TRAVEL, boat, third],
      today: TODAY,
    });

    expect(plan.allocated.toCurrencyString()).toBe('100.01');
    expect(plan.unallocated.isZero()).toBe(true);
  });
});

describe('every line is explainable', () => {
  it('cites the rate on the high-interest debt line', () => {
    const plan = buildAllocationPlan({
      incoming: usd('3000.00'),
      claims: ALL_CLAIMS,
      today: TODAY,
    });
    const line = plan.lines.find((entry) => entry.kind === 'high_interest_debt');

    expect(line?.explanation.key).toBe('highInterestDebt');
    expect(line?.explanation.values['apr']).toBe('24.500');
  });

  it('cites the due date on an overdue bill', () => {
    const plan = buildAllocationPlan({
      incoming: usd('3000.00'),
      claims: ALL_CLAIMS,
      today: TODAY,
    });
    const line = plan.lines.find((entry) => entry.kind === 'overdue_essential');

    expect(line?.explanation.key).toBe('overdueEssential');
    expect(line?.explanation.values['due']).toBe('2026-08-10');
  });

  it('calls the tax figure an estimate, never a bill', () => {
    const plan = buildAllocationPlan({
      incoming: usd('3000.00'),
      claims: ALL_CLAIMS,
      today: TODAY,
    });
    const line = plan.lines.find((entry) => entry.kind === 'tax_reserve');

    expect(line?.explanation.key).toBe('taxReserve');
  });

  it('says plainly when a claim got nothing', () => {
    const plan = buildAllocationPlan({ incoming: usd('90.00'), claims: ALL_CLAIMS, today: TODAY });
    const unfunded = plan.lines.find((line) => line.allocated.isZero());

    expect(unfunded?.explanation.key).toBe('nothingLeft');
    expect(plan.fullyFunded).toBe(false);
  });
});

describe('rules shaping a plan', () => {
  it('adds a claim the household asked for', () => {
    const actions: Action[] = [
      { type: 'allocate_percentage', target: 'goal:emergency-fund', percent: '15' },
    ];
    const applied = applyRuleActions([EMERGENCY_FUND], actions, usd('4000.00'));

    const claim = applied.claims.find((entry) => entry.target === 'goal:emergency-fund');
    expect(claim?.requested.toCurrencyString()).toBe('600.00');
    expect(applied.notes[0]?.key).toBe('raised.percentOfIncoming');
    expect(applied.notes[0]?.values['percent']).toBe('15');
  });

  it('raises a claim but never lowers one', () => {
    // Reducing what the household already committed to is what stop_allocation
    // is for, explicitly.
    const actions: Action[] = [
      { type: 'allocate_percentage', target: 'goal:emergency-fund', percent: '1' },
    ];
    const applied = applyRuleActions([EMERGENCY_FUND], actions, usd('4000.00'));

    expect(
      applied.claims
        .find((entry) => entry.target === 'goal:emergency-fund')
        ?.requested.toCurrencyString(),
    ).toBe('300.00');
  });

  it('stops a contribution, and a later rule does not resurrect it', () => {
    const actions: Action[] = [
      { type: 'stop_allocation', target: 'goal:travel' },
      { type: 'allocate_amount', target: 'goal:travel', amount: '500.00', currency: 'USD' },
    ];
    const applied = applyRuleActions([TRAVEL], actions, usd('4000.00'));

    expect(applied.claims.find((entry) => entry.target === 'goal:travel')).toBeUndefined();
  });

  it('moves the tax reserve to the front when asked', () => {
    const applied = applyRuleActions(
      [TAX_RESERVE],
      [{ type: 'reserve_taxes_first' }],
      usd('4000.00'),
    );

    expect(applied.order[0]).toBe('tax_reserve');
  });

  it('reorders inside a tier but cannot jump one', () => {
    // A rule that could move a travel fund ahead of rent is not expressing a
    // preference, it is arranging an eviction.
    const applied = applyRuleActions(
      [RENT, TRAVEL],
      [{ type: 'set_priority', target: 'goal:travel', priority: 'critical' }],
      usd('4000.00'),
    );

    const plan = buildAllocationPlan({
      incoming: usd('500.00'),
      claims: applied.claims,
      order: applied.order,
      today: TODAY,
    });

    expect(plan.lines[0]?.claimId).toBe('rent');
    expect(plan.lines.find((line) => line.claimId === 'travel')?.allocated.isZero()).toBe(true);
  });

  it('skips a rule written in another currency instead of converting it', () => {
    // There is no exchange rate in this system.
    const applied = applyRuleActions(
      [TRAVEL],
      [{ type: 'allocate_amount', target: 'goal:travel', amount: '900.00', currency: 'PAB' }],
      usd('4000.00'),
    );

    expect(
      applied.claims.find((entry) => entry.target === 'goal:travel')?.requested.toCurrencyString(),
    ).toBe('200.00');
    expect(applied.notes.some((note) => note.key === 'otherCurrency')).toBe(true);
  });

  it('refuses a target money cannot go to', () => {
    const applied = applyRuleActions(
      [],
      [{ type: 'allocate_amount', target: 'nonsense:x', amount: '10.00', currency: 'USD' }],
      usd('4000.00'),
    );

    expect(applied.claims).toHaveLength(0);
    expect(applied.notes[0]?.key).toBe('unreachableTarget');
  });

  it('ignores classification actions, which belong to another engine', () => {
    const applied = applyRuleActions(
      [TRAVEL],
      [{ type: 'set_category', categoryId: 'groceries' }],
      usd('4000.00'),
    );

    expect(applied.claims).toHaveLength(1);
    expect(applied.notes).toHaveLength(0);
  });
});

describe('nothing to allocate', () => {
  it('produces a plan of zeros rather than no plan', () => {
    const plan = buildAllocationPlan({ incoming: usd('0'), claims: ALL_CLAIMS, today: TODAY });

    expect(plan.lines).toHaveLength(ALL_CLAIMS.length);
    expect(plan.allocated.isZero()).toBe(true);
    expect(plan.fullyFunded).toBe(false);
  });

  it('produces an empty plan when there is nothing to pay', () => {
    const plan = buildAllocationPlan({ incoming: usd('1000.00'), claims: [], today: TODAY });

    expect(plan.lines).toHaveLength(0);
    expect(plan.unallocated.toCurrencyString()).toBe('1000.00');
    expect(plan.fullyFunded).toBe(true);
  });
});
