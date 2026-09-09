import { addDays, Money, type CurrencyCode, type PlainDate } from '@app/domain';

import { nextOccurrence } from './recurring.js';
import type { Frequency } from './types.js';

/**
 * The stretch between one payday and the next, which is the unit a household
 * actually lives in.
 *
 * Everything else in this system planned in months, and a month is an average
 * nobody is ever paid in. Somebody paid on the 15th and the 30th does not have
 * a monthly problem, they have two fortnightly ones — and the two are not the
 * same size, because the deductions are not spread evenly across them. The
 * quincena that carries the rent, the school and the loan is tight; the other
 * one is not. Telling that household «te sobran $600 este mes» is true and
 * useless: it is the answer to a question about a period they never experience.
 *
 * So the periods are not a calendar. They are derived from the days the
 * household is actually paid, whatever cadence that is — daily, weekly,
 * fortnightly, twice a month on two stated days, monthly, or several incomes at
 * once landing on different days. A period opens on a payday and runs to the
 * day before the next one.
 *
 * ## What «available» means here, and why it is not just what is left
 *
 * The naive figure — money in, minus what is owed — is wrong in the direction
 * that hurts. If the fortnight after this one owes more than it earns, spending
 * everything now guarantees that shortfall arrives with nothing behind it. So a
 * period's available figure is reduced by what the periods ahead of it cannot
 * cover on their own. That is precisely the difference the household already
 * feels between the 15th and the 30th, stated as a number instead of as a
 * recurring unpleasant surprise.
 *
 * Nothing here forecasts. Every figure is arithmetic over amounts and dates the
 * household stated or a statement reported: no growth assumed, no spending
 * predicted, no confidence interval invented.
 */

/** An income, as the periods need to see it: how much, how often, and when next. */
export interface IncomeStream {
  readonly id: string;
  readonly label: string;
  readonly amount: Money;
  readonly frequency: Frequency;
  /**
   * The calendar days a `semimonthly` income lands on, `31` meaning month end.
   *
   * This is the field that makes «la quincena del 15» a real thing rather than
   * an approximation. A salary paid on the 5th and the 20th produces different
   * periods from one paid on the 15th and the 30th, and averaging them into
   * «twice a month» loses the only detail that decides which fortnight is tight.
   */
  readonly anchorDays?: readonly number[] | undefined;
  /**
   * What lands on each of those days, when the two are not the same.
   *
   * A deduction taken once a month comes off one fortnight, not half off each,
   * so the same salary can arrive as $1,203.50 on the 15th and $1,053.50 on the
   * 30th. Using the average for both would be right about the month and wrong
   * about both halves — and the half that runs short is the whole reason this
   * type exists. In the same order as `anchorDays`; absent means the same
   * figure every time.
   */
  readonly anchorAmounts?: readonly Money[] | undefined;
  /** A day this income is known to land on. The walk forward starts here. */
  readonly nextPayday: PlainDate;
}

/** Something owed, on the day it is owed. */
export interface PeriodClaim {
  readonly id: string;
  readonly label: string;
  readonly amount: Money;
  readonly due: PlainDate;
  readonly isEssential: boolean;
}

export interface PayPeriod {
  /** The payday that opens it. */
  readonly start: PlainDate;
  /** The day before the next payday. Inclusive. */
  readonly end: PlainDate;
  /** Carried in from the period before, or the opening balance for the first. */
  readonly opening: Money;
  readonly income: Money;
  /** Which incomes landed, so the period can say whose money it is. */
  readonly paidBy: readonly string[];
  readonly claims: readonly PeriodClaim[];
  readonly committed: Money;
  /**
   * What can be taken out of this period without leaving a later one short.
   *
   * Never negative: a period that cannot cover itself has nothing available,
   * and the size of the hole is `shortfall`, which is a different statement.
   */
  readonly available: Money;
  /**
   * What this period must hold back so a later one is not left short.
   *
   * Measured against the later periods' *own income*, deliberately, and not
   * against what reaches them. «The next fortnight earns a thousand and owes
   * thirteen hundred» is a fact about that fortnight; whether it survives
   * depends on this one holding the difference back, which is the instruction
   * this field gives.
   */
  readonly reservedForLater: Money;
  /**
   * What this period owes beyond everything it actually has — its own income
   * plus what reached it from before.
   *
   * The other side of `reservedForLater`, and not the same number. A fortnight
   * that earns less than it owes still has no shortfall if the one before it
   * held enough back: that is the reserve working. A shortfall means it did not
   * work — there is no arrangement of this money that pays these bills — and
   * that is an alarm rather than an instruction.
   */
  readonly shortfall: Money;
  /**
   * What is left once this period's obligations are paid, before anything
   * discretionary is spent: opening + income − committed.
   *
   * Not the same as what reaches the next period. A household that spends the
   * `available` figure this period carries forward `closing − available`, and
   * that is what the next period actually opens with — otherwise every period
   * after the first would be quoting a figure that assumes the household
   * ignored the advice it was just given. Two «available» amounts that cannot
   * both be true is worse than either of them alone.
   */
  readonly closing: Money;
}

export interface PayPeriodInput {
  readonly currency: CurrencyCode;
  readonly today: PlainDate;
  /** What the household holds right now. */
  readonly opening: Money;
  readonly incomes: readonly IncomeStream[];
  readonly claims: readonly PeriodClaim[];
  /** Never spent down into. The household's own floor, not one we chose. */
  readonly keepAtLeast?: Money | undefined;
  /** How far ahead to build. Beyond this the claims are not known anyway. */
  readonly horizonDays?: number;
}

/** Two months. Far enough to see the next few paydays, short enough to be real. */
const DEFAULT_HORIZON_DAYS = 62;

/**
 * Bounded so a cadence that somehow fails to advance can never spin. A daily
 * income over the default horizon is sixty-two paydays; this is far past it.
 */
const MAX_PAYDAYS = 400;

/**
 * Every day an income lands on, between today and the horizon.
 *
 * Walked with the same stepper the recurrence pass uses, so a salary projected
 * here and the same salary projected on the forecast screen land on identical
 * dates. Two implementations of «when is the next payday» disagree eventually,
 * and then the household is told two different things about one salary.
 */
function paydaysWithin(
  income: IncomeStream,
  from: PlainDate,
  until: PlainDate,
): readonly PlainDate[] {
  const days: PlainDate[] = [];
  let date = income.nextPayday;

  // A stated next payday can be in the past on a household that has not opened
  // the app in a while. Walk it forward before collecting, rather than
  // reporting paydays that already happened as though they were coming.
  for (let step = 0; step < MAX_PAYDAYS && date < from; step += 1) {
    const next = nextOccurrence(income.frequency, date, income.anchorDays);
    if (next <= date) return days;
    date = next;
  }

  for (let step = 0; step < MAX_PAYDAYS && date <= until; step += 1) {
    days.push(date);
    const next = nextOccurrence(income.frequency, date, income.anchorDays);
    if (next <= date) break;
    date = next;
  }

  return days;
}

/**
 * The household's pay periods, with what each one earns, owes and can spare.
 *
 * Returns an empty list when no income is known. That is the honest answer:
 * without a payday there is no period to divide anything into, and inventing a
 * calendar month here would be exactly the averaging this module exists to
 * stop.
 */
export function buildPayPeriods(input: PayPeriodInput): readonly PayPeriod[] {
  const { currency, today } = input;
  const zero = Money.zero(currency);
  const horizon = addDays(today, input.horizonDays ?? DEFAULT_HORIZON_DAYS);

  // Every payday from every income, on one timeline. Several salaries landing
  // on different days make more and shorter periods, which is not a flaw: money
  // arriving is what opens a period, and a household with two incomes really
  // does live in the gaps between four paydays a month.
  const landings = new Map<PlainDate, { amount: Money; from: string[] }>();
  for (const income of input.incomes) {
    /**
     * Lo que trae este pago, que no es siempre la misma cifra.
     *
     * El monto se empareja con el día del mes en el que cae, igual que ya se
     * hace con lo que se debe. Sin `anchorAmounts` —el caso corriente— sigue
     * siendo el mismo número todas las veces.
     */
    const amountOn = (day: PlainDate): Money => {
      const perAnchor = income.anchorAmounts;
      const days = income.anchorDays;
      if (!perAnchor || !days) return income.amount;
      const at = days.indexOf(Number(day.slice(8, 10)));
      return at >= 0 ? (perAnchor[at] ?? income.amount) : income.amount;
    };

    for (const day of paydaysWithin(income, today, horizon)) {
      const arriving = amountOn(day);
      const existing = landings.get(day);
      if (existing) {
        landings.set(day, {
          amount: existing.amount.add(arriving),
          from: [...existing.from, income.label],
        });
      } else {
        landings.set(day, { amount: arriving, from: [income.label] });
      }
    }
  }

  const paydays = [...landings.keys()].sort();
  if (paydays.length === 0) return [];

  // The stretch before the first payday is a period too, and often the one that
  // matters most: it is the days the household is living through right now, on
  // money that already arrived. Leaving it out would answer «what can I spend»
  // with a figure that only applies from next Friday.
  const boundaries: PlainDate[] = paydays[0] === today ? [...paydays] : [today, ...paydays];

  interface Draft {
    start: PlainDate;
    end: PlainDate;
    income: Money;
    paidBy: string[];
    claims: PeriodClaim[];
  }

  const drafts: Draft[] = boundaries.map((start, at) => {
    const next = boundaries[at + 1];
    const landing = landings.get(start);
    return {
      start,
      end: next ? addDays(next, -1) : horizon,
      income: landing?.amount ?? zero,
      paidBy: landing?.from ?? [],
      claims: [],
    };
  });

  for (const claim of input.claims) {
    // Anything already due when the household opens the app belongs to the
    // period they are in now: it is owed today, not on some past date nobody
    // can act on any more.
    const at = drafts.findIndex((draft) => claim.due >= draft.start && claim.due <= draft.end);
    const target = at === -1 ? (claim.due < today ? drafts[0] : undefined) : drafts[at];
    target?.claims.push(claim);
  }

  const committed = drafts.map((draft) =>
    Money.sum(
      draft.claims.map((claim) => claim.amount),
      currency,
    ),
  );

  /**
   * What each period has to hold back for the ones after it.
   *
   * Computed backwards, because the question «how much must I keep» can only be
   * answered once you know what the periods ahead cannot cover themselves. A
   * fortnight that owes more than it earns propagates its gap to the fortnight
   * before it, and so on back to now — which is the arithmetic behind the thing
   * households already feel: the loose quincena is only loose until you count
   * what the tight one is short.
   */
  const reserve: Money[] = drafts.map(() => zero);
  for (let at = drafts.length - 2; at >= 0; at -= 1) {
    const nextDraft = drafts[at + 1];
    const nextCommitted = committed[at + 1];
    const nextReserve = reserve[at + 1];
    if (!nextDraft || !nextCommitted || !nextReserve) continue;
    const nextNeeds = nextCommitted.add(nextReserve).subtract(nextDraft.income);
    reserve[at] = nextNeeds.isPositive() ? nextNeeds : zero;
  }

  const keepAtLeast = input.keepAtLeast ?? zero;
  const periods: PayPeriod[] = [];
  let opening = input.opening;

  for (const [at, draft] of drafts.entries()) {
    const owed = committed[at] ?? zero;
    const held = reserve[at] ?? zero;
    const closing = opening.add(draft.income).subtract(owed);

    // The floor is applied to what can be spent, never to what is reported as
    // held: a household below its own buffer should see that it is, not have
    // the figure quietly adjusted.
    const spendable = closing.subtract(held).subtract(keepAtLeast);
    const gap = owed.subtract(opening.add(draft.income));

    periods.push({
      start: draft.start,
      end: draft.end,
      opening,
      income: draft.income,
      paidBy: draft.paidBy,
      claims: draft.claims,
      committed: owed,
      available: spendable.isPositive() ? spendable : zero,
      reservedForLater: held,
      shortfall: gap.isPositive() ? gap : zero,
      closing,
    });

    // What is left after this period spends what it was told it could. Quoting
    // the next period on the assumption that nothing was spent here is how a
    // plan produces two figures that cannot both be acted on.
    opening = spendable.isPositive() ? closing.subtract(spendable) : closing;
  }

  return periods;
}

/** The period a date falls in, or null when it is outside the horizon. */
export function periodContaining(periods: readonly PayPeriod[], date: PlainDate): PayPeriod | null {
  return periods.find((period) => date >= period.start && date <= period.end) ?? null;
}

export { DEFAULT_HORIZON_DAYS as PAY_PERIOD_HORIZON_DAYS };
