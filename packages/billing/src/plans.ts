import { Money } from '@app/domain';

import type { Entitlements, Plan, PlanCode } from './types.js';

/**
 * The plan catalogue — **as a seed, never as the source of truth**.
 *
 * Pricing and entitlements live in `platform.plans` and
 * `platform.plan_entitlements`. Running a promotion, correcting a limit or
 * adding a tier must not require a deployment, and a constant in a bundle is a
 * deployment by another name.
 *
 * What is here is the row set a fresh database is seeded with, and the fixture
 * the entitlement tests run against. The application reads plans from the
 * database and has no fallback to this object: a missing catalogue is a
 * misconfigured deployment, and silently serving prices from a build artifact
 * would hide it until a customer was charged the wrong amount.
 *
 * The figures below are the ones in the specification. They are **not final** —
 * final pricing is an open decision on the user's list — so nothing here should
 * be treated as a commercial commitment.
 */

const usd = (value: string) => Money.fromDecimalString(value, 'USD');

function entitlements(overrides: Partial<Entitlements>): Entitlements {
  return {
    transactions_per_month: 0,
    household_members: 0,
    document_imports: 0,
    rules: 0,
    goals: 0,
    reports: 0,
    tax_engine: 0,
    accountant_mode: 0,
    white_label: 0,
    ai_usage: 0,
    ...overrides,
  };
}

/**
 * The free plan is deliberately usable.
 *
 * It is also what an expired subscription falls back to. Locking a household out
 * of their own financial history because a card expired is not a decision anyone
 * would defend out loud, so the free tier has to be a place they can land.
 */
export const FREE_ENTITLEMENTS: Entitlements = entitlements({
  transactions_per_month: 250,
  household_members: 1,
  document_imports: 3,
  rules: 3,
  goals: 2,
  reports: 3,
  ai_usage: 0,
});

export const SEED_PLANS: readonly Plan[] = [
  {
    code: 'FREE',
    name: 'Free',
    price: usd('0'),
    interval: 'month',
    isActive: true,
    entitlements: FREE_ENTITLEMENTS,
  },
  {
    code: 'PLUS',
    name: 'Plus',
    price: usd('9.99'),
    interval: 'month',
    isActive: true,
    entitlements: entitlements({
      transactions_per_month: null,
      household_members: 1,
      document_imports: 25,
      rules: 25,
      goals: 10,
      reports: null,
      ai_usage: 200,
    }),
  },
  {
    code: 'COUPLE',
    name: 'Couple',
    price: usd('17.99'),
    interval: 'month',
    isActive: true,
    entitlements: entitlements({
      transactions_per_month: null,
      household_members: 2,
      document_imports: 50,
      rules: 50,
      goals: 20,
      reports: null,
      ai_usage: 400,
    }),
  },
  {
    code: 'PRO',
    name: 'Pro',
    price: usd('29.99'),
    interval: 'month',
    isActive: true,
    entitlements: entitlements({
      transactions_per_month: null,
      household_members: 2,
      document_imports: null,
      rules: null,
      goals: null,
      reports: null,
      tax_engine: 1,
      ai_usage: 1000,
    }),
  },
  {
    code: 'FAMILY',
    name: 'Family',
    price: usd('39.99'),
    interval: 'month',
    isActive: true,
    entitlements: entitlements({
      transactions_per_month: null,
      household_members: 6,
      document_imports: null,
      rules: null,
      goals: null,
      reports: null,
      tax_engine: 1,
      ai_usage: 1500,
    }),
  },
  {
    code: 'ACCOUNTANT',
    name: 'Accountant',
    price: usd('0'),
    interval: 'month',
    isActive: false,
    entitlements: entitlements({
      transactions_per_month: null,
      household_members: null,
      document_imports: null,
      rules: null,
      goals: null,
      reports: null,
      tax_engine: 1,
      accountant_mode: 1,
      ai_usage: 2000,
    }),
  },
  {
    code: 'WHITE_LABEL',
    name: 'White label',
    price: usd('0'),
    interval: 'month',
    isActive: false,
    entitlements: entitlements({
      transactions_per_month: null,
      household_members: null,
      document_imports: null,
      rules: null,
      goals: null,
      reports: null,
      tax_engine: 1,
      accountant_mode: 1,
      white_label: 1,
      ai_usage: 5000,
    }),
  },
];

export function seedPlan(code: PlanCode): Plan | undefined {
  return SEED_PLANS.find((plan) => plan.code === code);
}
