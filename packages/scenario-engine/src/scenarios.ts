import type { Debt } from '@app/debt-engine';
import type { Money } from '@app/domain';

import type { Scenario, ScenarioChange, ScenarioKind } from './types.js';

/**
 * The primitives every scenario is built from.
 *
 * The spec names ten scenarios — a car, a marriage, a child, income loss, a
 * bonus, paying off a card, a vacation, a move, a rent increase, a job change.
 * They are not ten mechanisms. Each one is a combination of four things
 * happening on a schedule: money leaves once, money leaves every month, money
 * arrives every month, and a debt is taken on.
 *
 * Writing ten near-identical factories would put the same arithmetic in ten
 * places and give the eleventh scenario nowhere to go. These four compose into
 * all of them, and the scenario's `kind` carries what it means so the product
 * can label and explain it.
 */

const DEFAULT_HORIZON_MONTHS = 60;

/** A single cost, in the month it happens. A deposit, a wedding, a flight. */
export function oneTime(label: string, amount: Money, startsInMonths = 0): ScenarioChange {
  return {
    label,
    startsInMonths,
    durationMonths: null,
    oneTimeCost: amount,
    monthlyExpenseDelta: null,
    monthlyIncomeDelta: null,
    addedDebt: null,
  };
}

/** A change to what leaves every month. Rent going up, a child's costs starting. */
export function recurringCost(
  label: string,
  monthly: Money,
  options: { startsInMonths?: number; durationMonths?: number | null } = {},
): ScenarioChange {
  return {
    label,
    startsInMonths: options.startsInMonths ?? 0,
    durationMonths: options.durationMonths ?? null,
    oneTimeCost: null,
    monthlyExpenseDelta: monthly,
    monthlyIncomeDelta: null,
    addedDebt: null,
  };
}

/**
 * A change to what arrives every month.
 *
 * Income loss is this with a negative delta and a duration — "no salary for four
 * months" — which is exactly how a household describes it.
 */
export function incomeChange(
  label: string,
  monthly: Money,
  options: { startsInMonths?: number; durationMonths?: number | null } = {},
): ScenarioChange {
  return {
    label,
    startsInMonths: options.startsInMonths ?? 0,
    durationMonths: options.durationMonths ?? null,
    oneTimeCost: null,
    monthlyExpenseDelta: null,
    monthlyIncomeDelta: monthly,
    addedDebt: null,
  };
}

/**
 * A purchase paid for partly now and partly over time.
 *
 * The down payment leaves in the month of the purchase and the financed balance
 * becomes a real debt in the projection — accruing at its own rate, with its own
 * minimum. That is the difference between "can I afford the deposit" and "can I
 * afford the car", and it is the reason this scenario is worth running.
 */
export function financedPurchase(
  label: string,
  options: { downPayment: Money | null; debt: Debt; startsInMonths?: number },
): ScenarioChange {
  return {
    label,
    startsInMonths: options.startsInMonths ?? 0,
    durationMonths: null,
    oneTimeCost: options.downPayment,
    monthlyExpenseDelta: null,
    monthlyIncomeDelta: null,
    addedDebt: options.debt,
  };
}

export function scenario(
  id: string,
  name: string,
  kind: ScenarioKind,
  changes: readonly ScenarioChange[],
  horizonMonths = DEFAULT_HORIZON_MONTHS,
): Scenario {
  return { id, name, kind, changes, horizonMonths };
}
