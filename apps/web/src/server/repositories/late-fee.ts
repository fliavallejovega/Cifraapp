import { addDays, Money, type PlainDate } from '@app/domain';

/**
 * What is still at stake on a bill that goes unpaid.
 *
 * The household stated the charge in one of two shapes, and the shape decides
 * the arithmetic: a fixed amount is the amount, a rate is a share of what is
 * owed. They are read from separate columns so that «5%» can never arrive here
 * as «$5».
 *
 * The grace period is what makes this a *stake* rather than a fact. A charge
 * that has already been incurred is sunk — paying today does not undo it — so
 * it must not push the bill up the queue ahead of one whose charge can still be
 * avoided. Once the grace has run out, this returns null and the bill is ranked
 * on everything else, which is the honest answer: there is nothing left to save
 * by hurrying.
 *
 * A commitment with no stated charge also returns null. That is «nothing known
 * to be at stake», not «no penalty exists» — the product does not invent a fee
 * any more than it invents an interest rate, and it does not read silence as a
 * promise either.
 */
export function penaltyStillAtStake(
  row: {
    readonly lateFeeAmount: string | null;
    readonly lateFeeRate: string | null;
    readonly lateFeeAfterDays: number | null;
  },
  amount: Money,
  due: PlainDate,
  today: PlainDate,
): Money | null {
  if (row.lateFeeAmount === null && row.lateFeeRate === null) return null;

  // Past the grace period the charge has already been applied. It is a real
  // cost and it is a sunk one: paying today does not undo it, so it must not
  // push this bill ahead of one whose charge can still be avoided. Ranking on
  // a fee nobody can dodge any more is spending scarce money to buy nothing.
  //
  // A stated fee with no stated grace is treated as charging from the first
  // day late, which is what «cobran desde el primer día» means and what the
  // form's own hint says. Assuming a grace nobody mentioned would invent one.
  const graceEnds = addDays(due, row.lateFeeAfterDays ?? 0);
  if (today > graceEnds) return null;

  if (row.lateFeeAmount !== null) {
    const fee = Money.fromDecimalString(row.lateFeeAmount, amount.currency);
    return fee.isPositive() ? fee : null;
  }

  // The rate as text, straight from the column into `percentage`, which parses
  // it exactly. Passing it through `Number` first would put a float between the
  // household's «5.125%» and the money it applies to, for no reason.
  if (row.lateFeeRate === null || Number(row.lateFeeRate) <= 0) return null;
  const fee = amount.percentage(row.lateFeeRate);
  return fee.isPositive() ? fee : null;
}
