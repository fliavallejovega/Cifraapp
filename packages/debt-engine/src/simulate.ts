import {
  addMonths,
  daysBetween,
  err,
  Money,
  monthKey,
  ok,
  type PlainDate,
  type Result,
} from '@app/domain';

import { accrueAcrossWindow } from './interest.js';
import { orderDebts, totalMinimums } from './strategy.js';
import type {
  Debt,
  DebtOutcome,
  DebtStrategy,
  PayoffMonth,
  PayoffPlan,
  SimulationProblem,
} from './types.js';

/**
 * Payoff simulation.
 *
 * Month by month: interest accrues daily across the month, every minimum is
 * paid, and whatever is left goes to whichever debt the strategy names. The
 * order is recomputed every month, because it changes — a snowball's target
 * changes the moment the smallest balance clears, and an avalanche's changes the
 * month a promotional rate expires.
 *
 * Two outcomes matter more than the payoff date, and both are reported rather
 * than smoothed over:
 *
 *   - A debt whose minimum payment does not cover its own interest never clears.
 *     Reporting a payoff date for it would be a fabrication; it goes into
 *     `unresolvedDebtIds` instead.
 *   - A monthly payment below the sum of the minimums is not a slower plan, it
 *     is not a plan. It comes back as a problem the caller can show, not an
 *     exception, because a household asking "what if I pay $300" against $420 of
 *     minimums deserves an answer (spec §35).
 */

/** Fifty years. Long enough for any real mortgage, short enough to terminate. */
export const MAX_SIMULATION_MONTHS = 600;

export interface SimulationInput {
  readonly debts: readonly Debt[];
  readonly strategy: DebtStrategy;
  /** Everything the household puts toward debt each month, minimums included. */
  readonly monthlyPayment: Money;
  readonly from: PlainDate;
  readonly maxMonths?: number;
}

export function simulatePayoff(input: SimulationInput): Result<PayoffPlan, SimulationProblem> {
  const live = input.debts.filter((debt) => debt.currentBalance.isPositive());
  if (live.length === 0) return err({ kind: 'no_debts' });

  const currency = input.monthlyPayment.currency;
  for (const debt of live) {
    if (debt.currentBalance.currency !== currency) {
      return err({
        kind: 'currency_mismatch',
        expected: currency,
        found: debt.currentBalance.currency,
      });
    }
  }

  const required = totalMinimums(live, currency);
  if (input.monthlyPayment.lessThan(required)) {
    return err({ kind: 'below_minimums', required, offered: input.monthlyPayment });
  }

  const horizon = input.maxMonths ?? MAX_SIMULATION_MONTHS;
  const zero = Money.zero(currency);

  const balances = new Map(live.map((debt) => [debt.id, debt.currentBalance]));
  const interestPaid = new Map(live.map((debt) => [debt.id, zero]));
  const payoffDates = new Map<string, PlainDate>();
  const payoffMonths = new Map<string, number>();

  const months: PayoffMonth[] = [];
  let cursor = input.from;

  for (let index = 0; index < horizon; index += 1) {
    const remainingDebts = live.filter((debt) => (balances.get(debt.id) ?? zero).isPositive());
    if (remainingDebts.length === 0) break;

    const daysInMonth = daysBetween(cursor, addMonths(cursor, 1));

    // 1. Interest, accrued daily and rounded once per debt per month.
    let interestThisMonth = zero;
    for (const debt of remainingDebts) {
      const opening = balances.get(debt.id) ?? zero;
      const interest = accrueAcrossWindow(debt, opening, cursor, daysInMonth);
      balances.set(debt.id, opening.add(interest));
      interestPaid.set(debt.id, (interestPaid.get(debt.id) ?? zero).add(interest));
      interestThisMonth = interestThisMonth.add(interest);
    }

    // 2. Every minimum, on every debt. No strategy skips one.
    let available = input.monthlyPayment;
    let paidThisMonth = zero;

    for (const debt of remainingDebts) {
      const outstanding = balances.get(debt.id) ?? zero;
      const settled = settle(outstanding, Money.min(debt.minimumPayment, available));
      balances.set(debt.id, outstanding.subtract(settled));
      available = available.subtract(settled);
      paidThisMonth = paidThisMonth.add(settled);
    }

    // 3. Everything left goes to the debt the strategy names. Recomputed every
    //    month, because the answer moves as balances clear and rates expire.
    const stillOwing = remainingDebts.filter((debt) =>
      (balances.get(debt.id) ?? zero).isPositive(),
    );
    const target = orderDebts(
      stillOwing.map((debt) => ({ ...debt, currentBalance: balances.get(debt.id) ?? zero })),
      input.strategy,
      cursor,
      { extraPayment: available },
    )[0]?.debt;

    if (target && available.isPositive()) {
      const outstanding = balances.get(target.id) ?? zero;
      const settled = settle(outstanding, available);
      balances.set(target.id, outstanding.subtract(settled));
      paidThisMonth = paidThisMonth.add(settled);
    }

    const cleared: string[] = [];
    for (const debt of remainingDebts) {
      if (!(balances.get(debt.id) ?? zero).isPositive() && !payoffDates.has(debt.id)) {
        payoffDates.set(debt.id, cursor);
        payoffMonths.set(debt.id, index + 1);
        cleared.push(debt.id);
      }
    }

    const closing = Money.sum([...balances.values()], currency);

    months.push({
      month: monthKey(cursor),
      interestAccrued: interestThisMonth,
      principalPaid: paidThisMonth.subtract(interestThisMonth),
      paid: paidThisMonth,
      closingBalance: closing,
      targetDebtId: target?.id ?? null,
      clearedDebtIds: cleared,
    });

    // A month where nothing was paid down and nothing cleared is a month that
    // will repeat forever: the minimums do not cover the interest.
    if (paidThisMonth.isZero() && cleared.length === 0) break;

    cursor = addMonths(cursor, 1);
  }

  const outcomes: DebtOutcome[] = live.map((debt) => ({
    debtId: debt.id,
    name: debt.name,
    payoffDate: payoffDates.get(debt.id) ?? null,
    monthsToPayoff: payoffMonths.get(debt.id) ?? null,
    interestPaid: interestPaid.get(debt.id) ?? zero,
  }));

  const unresolved = outcomes
    .filter((outcome) => outcome.payoffDate === null)
    .map((outcome) => outcome.debtId);

  const isDebtFree = unresolved.length === 0 && months.length > 0;

  return ok({
    strategy: input.strategy,
    months,
    outcomes,
    totalInterest: Money.sum(
      outcomes.map((outcome) => outcome.interestPaid),
      currency,
    ),
    debtFreeOn: isDebtFree ? lastPaymentDate(months, input.from) : null,
    monthsToDebtFree: isDebtFree ? months.length : null,
    unresolvedDebtIds: unresolved,
  });
}

export interface PlanComparison {
  readonly interestSaved: Money;
  readonly monthsSaved: number | null;
  readonly explanation: string;
}

/**
 * What choosing one plan over another actually costs.
 *
 * This is the honest way to present avalanche against snowball: not as a right
 * answer and a wrong one, but as a price. "Snowball closes your first account
 * four months sooner and costs $312 more" is a decision a person can make.
 */
export function comparePlans(chosen: PayoffPlan, alternative: PayoffPlan): PlanComparison {
  const interestSaved = alternative.totalInterest.subtract(chosen.totalInterest);
  const monthsSaved =
    chosen.monthsToDebtFree !== null && alternative.monthsToDebtFree !== null
      ? alternative.monthsToDebtFree - chosen.monthsToDebtFree
      : null;

  return {
    interestSaved,
    monthsSaved,
    explanation: interestSaved.isPositive()
      ? `This plan costs ${interestSaved.toCurrencyString()} less in interest.`
      : interestSaved.isNegative()
        ? `This plan costs ${interestSaved.abs().toCurrencyString()} more in interest.`
        : 'Both plans cost the same in interest.',
  };
}

/**
 * How much of a payment a balance can absorb.
 *
 * A partial payment is rounded down to the cent so a plan never spends more than
 * the household offered. A payment that clears the debt pays the balance exactly,
 * odd sub-cent remainder included — which is what a lender does, and what leaves
 * the account actually closed instead of open for four ten-thousandths of a
 * dollar.
 */
function settle(outstanding: Money, offered: Money): Money {
  if (!outstanding.isPositive() || !offered.isPositive()) {
    return Money.zero(outstanding.currency);
  }
  if (offered.greaterThanOrEqual(outstanding)) return outstanding;
  return offered.roundToCurrencyPrecision('down');
}

function lastPaymentDate(months: readonly PayoffMonth[], from: PlainDate): PlainDate {
  return addMonths(from, Math.max(months.length - 1, 0));
}
