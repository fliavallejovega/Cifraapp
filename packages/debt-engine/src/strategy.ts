import { Money, type PlainDate } from '@app/domain';

import { aprToThousandths, effectiveApr } from './interest.js';
import type { Debt, DebtStrategy, OrderedDebt } from './types.js';

/**
 * Which debt to attack.
 *
 * Every strategy pays every minimum. The ordering decides only where the money
 * *above* the minimums goes, which is the only place a strategy can make a
 * difference and the only place the household has a real choice.
 *
 * Ties are broken all the way down to the identifier, because the same set of
 * debts must produce the same plan on every run. A plan that reorders itself
 * between two page loads cannot be trusted or argued with.
 */

/**
 * How many months of extra payment make a balance a "quick win" under the hybrid
 * strategy. Three is short enough that the household sees an account close while
 * the decision is still fresh, and small enough that the detour costs little
 * against the avalanche it then falls back to.
 */
export const HYBRID_QUICK_WIN_MONTHS = 3;

export interface StrategyOptions {
  /** Money available above the minimums. Only the hybrid strategy needs it. */
  readonly extraPayment?: Money;
}

export function orderDebts(
  debts: readonly Debt[],
  strategy: DebtStrategy,
  on: PlainDate,
  options: StrategyOptions = {},
): OrderedDebt[] {
  const live = debts.filter((debt) => debt.currentBalance.isPositive());
  const ordered = sortForStrategy(live, strategy, on, options);

  return ordered.map((debt, index) => ({
    debt,
    position: index,
    effectiveApr: effectiveApr(debt, on),
    reason: explain(debt, strategy, on, index),
  }));
}

function sortForStrategy(
  debts: readonly Debt[],
  strategy: DebtStrategy,
  on: PlainDate,
  options: StrategyOptions,
): Debt[] {
  switch (strategy) {
    case 'avalanche':
      return [...debts].sort((a, b) => byRate(a, b, on));
    case 'snowball':
      return [...debts].sort(bySize);
    case 'custom':
      return [...debts].sort(byHouseholdPriority);
    case 'hybrid': {
      // Quick wins first, in snowball order; everything else by rate. The detour
      // is bounded by what the household can actually throw at a balance.
      const reach = options.extraPayment?.multiply(HYBRID_QUICK_WIN_MONTHS);
      const isQuickWin = (debt: Debt): boolean =>
        reach ? debt.currentBalance.lessThanOrEqual(reach) : false;

      const quick = debts.filter(isQuickWin).sort(bySize);
      const rest = debts.filter((debt) => !isQuickWin(debt)).sort((a, b) => byRate(a, b, on));
      return [...quick, ...rest];
    }
  }
}

/** Highest effective rate first. A promotional rate is a real rate until it ends. */
function byRate(a: Debt, b: Debt, on: PlainDate): number {
  const rateA = aprToThousandths(effectiveApr(a, on));
  const rateB = aprToThousandths(effectiveApr(b, on));
  if (rateA !== rateB) return rateA > rateB ? -1 : 1;

  // Same rate: the larger balance costs more per day, so it goes first.
  if (!a.currentBalance.equals(b.currentBalance)) {
    return a.currentBalance.greaterThan(b.currentBalance) ? -1 : 1;
  }
  return byId(a, b);
}

/** Smallest balance first — the account that closes soonest. */
function bySize(a: Debt, b: Debt): number {
  if (!a.currentBalance.equals(b.currentBalance)) {
    return a.currentBalance.lessThan(b.currentBalance) ? -1 : 1;
  }
  return byId(a, b);
}

/** The household's own order. Anything unranked falls to the back. */
function byHouseholdPriority(a: Debt, b: Debt): number {
  const rankA = a.strategyPriority ?? Number.MAX_SAFE_INTEGER;
  const rankB = b.strategyPriority ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;
  return byId(a, b);
}

function byId(a: Debt, b: Debt): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function explain(debt: Debt, strategy: DebtStrategy, on: PlainDate, position: number): string {
  const rate = effectiveApr(debt, on);
  const isPromotional = rate !== debt.apr;
  const promotionalNote = isPromotional
    ? ` Its promotional rate runs until ${String(debt.promotionalExpiresOn)}.`
    : '';

  if (position > 0) {
    return `${debt.name} keeps its minimum payment while the extra goes elsewhere.${promotionalNote}`;
  }

  switch (strategy) {
    case 'avalanche':
      return `${debt.name} carries the highest rate at ${rate}%, so it costs the most to keep.${promotionalNote}`;
    case 'snowball':
      return `${debt.name} has the smallest balance, so it clears first.${promotionalNote}`;
    case 'custom':
      return `${debt.name} is first in the order you set.${promotionalNote}`;
    case 'hybrid':
      return `${debt.name} is close enough to clear quickly, so it goes first.${promotionalNote}`;
  }
}

/** The minimum a plan must cover before any strategy is even possible. */
export function totalMinimums(debts: readonly Debt[], currency: Money['currency']): Money {
  return Money.sum(
    debts
      .filter((debt) => debt.currentBalance.isPositive())
      .map((debt) => Money.min(debt.minimumPayment, debt.currentBalance)),
    currency,
  );
}
