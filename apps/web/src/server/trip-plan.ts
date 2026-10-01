import { Money, toPlainDate, type CurrencyCode, type PlainDate } from '@app/domain';
import {
  isDailyCategory,
  isTripCategory,
  shiftedRate,
  type BookingType,
  type Profile,
  type TripBudgetInput,
  type TripCategory,
} from '@app/trip-engine';

/**
 * The pure half of the trips server: database rows in, engine input out, and
 * the savings traffic light. Nothing here reads a request, a clock or a
 * connection, so all of it is tested without a database.
 */

export interface TripRow {
  readonly startDate: string;
  readonly endDate: string;
  readonly baseCurrency: string;
  readonly totalBudget: string;
  readonly contingencyType: 'percent' | 'fixed';
  readonly contingencyValue: string;
  readonly profile: Profile;
  readonly customShares: Record<string, number> | null;
  readonly includeArrivalDay: boolean;
  readonly includeDepartureDay: boolean;
  readonly partialDayWeight: string;
  readonly rollingPolicy: 'rolling' | 'fixed';
  readonly reserveReleased: string;
  readonly planningFx: Record<string, { rate: string; date: string }>;
}

export interface LegRow {
  readonly id: string;
  readonly arrivalDate: string;
  readonly departureDate: string;
  readonly costIndex: string;
  readonly lodgingMode: 'undecided' | 'prepaid' | 'pay_on_site' | 'none';
  readonly localCurrency: string;
}

export interface BookingRow {
  readonly id: string;
  readonly bookingType: BookingType;
  readonly paymentStatus: 'paid' | 'deposit_paid' | 'pay_later' | 'pay_on_site';
  readonly amountBase: string;
  readonly paidAmount: string;
  readonly amount: string;
  readonly legId: string | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
}

/** Spending grouped by day and category, as a positive base-currency figure. */
export interface SpentRow {
  readonly day: string;
  readonly category: string | null;
  readonly spent: string;
}

export interface ScenarioParams {
  readonly totalBudget?: string;
  readonly contingencyType?: 'percent' | 'fixed';
  readonly contingencyValue?: string;
  readonly profile?: Profile;
  readonly customShares?: Record<string, number>;
  /** Positive: the local currencies get this many percent more expensive. */
  readonly fxShiftPercent?: string;
}

/**
 * Which trip category a booking's cost belongs to, when it becomes a
 * transaction. A tour is an activity; a train between cities is the long
 * transport the daily budget never sees.
 */
export const BOOKING_CATEGORY: Readonly<Record<BookingType, TripCategory>> = {
  flight: 'flights',
  lodging: 'lodging',
  insurance: 'insurance',
  tour: 'activities',
  transport: 'long_transport',
  visa: 'visas',
  other: 'other',
};

const dateOf = (value: Date | null): PlainDate | null =>
  value ? toPlainDate(value.toISOString().slice(0, 10)) : null;

/**
 * The engine's input for a trip.
 *
 * A booking's paid amount is stored in its own currency; the engine works in
 * the base currency, so the paid share is scaled by the booking's own base
 * price. Rates come from the trip's planning rates first and the latest
 * reference rate second, shifted by a scenario's «what if» when there is one.
 */
export function toEngineInput(input: {
  readonly trip: TripRow;
  readonly legs: readonly LegRow[];
  readonly travelers: readonly { id: string; weight: string }[];
  readonly bookings: readonly BookingRow[];
  readonly overrides: readonly {
    tripDay: string | null;
    legId: string | null;
    category: string;
    amount: string;
  }[];
  readonly spent: readonly SpentRow[];
  readonly minorUnits: ReadonlyMap<string, number>;
  readonly latestRates: ReadonlyMap<string, string>;
  readonly today: PlainDate;
  readonly scenario?: ScenarioParams | null;
  readonly monthlySavingCapacity?: string | null;
}): TripBudgetInput {
  const { trip, scenario } = input;
  const base = {
    code: trip.baseCurrency,
    minorUnits: input.minorUnits.get(trip.baseCurrency) ?? 2,
  };

  const rateFor = (code: string): string | null => {
    const rate = trip.planningFx[code]?.rate ?? input.latestRates.get(code) ?? null;
    if (!rate) return null;
    return scenario?.fxShiftPercent ? shiftedRate(rate, scenario.fxShiftPercent) : rate;
  };

  return {
    currency: base,
    totalBudget: scenario?.totalBudget ?? trip.totalBudget,
    today: input.today,
    startDate: toPlainDate(trip.startDate),
    endDate: toPlainDate(trip.endDate),
    legs: input.legs.map((leg) => ({
      id: leg.id,
      arrivalDate: toPlainDate(leg.arrivalDate),
      departureDate: toPlainDate(leg.departureDate),
      costIndex: leg.costIndex,
      lodgingMode: leg.lodgingMode,
      localCurrency: {
        code: leg.localCurrency,
        minorUnits: input.minorUnits.get(leg.localCurrency) ?? 2,
      },
      fxRate: leg.localCurrency === trip.baseCurrency ? '1' : rateFor(leg.localCurrency),
    })),
    travelers: input.travelers,
    bookings: input.bookings.map((booking) => ({
      id: booking.id,
      type: booking.bookingType,
      paymentStatus: booking.paymentStatus,
      amountBase: booking.amountBase,
      paidBase: paidInBase(booking, base.minorUnits),
      legId: booking.legId,
      startsOn: dateOf(booking.startsAt),
      endsOn: dateOf(booking.endsAt),
    })),
    contingency: {
      type: scenario?.contingencyType ?? trip.contingencyType,
      value: scenario?.contingencyValue ?? trip.contingencyValue,
    },
    profile: scenario?.profile ?? trip.profile,
    customShares: scenario?.customShares ?? trip.customShares,
    partialDays: {
      includeArrival: trip.includeArrivalDay,
      includeDeparture: trip.includeDepartureDay,
      weight: trip.partialDayWeight,
    },
    overrides: input.overrides.flatMap((o) =>
      isDailyCategory(o.category)
        ? [
            {
              day: o.tripDay ? toPlainDate(o.tripDay) : null,
              legId: o.legId,
              category: o.category,
              amount: o.amount,
            },
          ]
        : [],
    ),
    spent: input.spent
      .filter((row) => !row.spent.startsWith('-') && row.spent !== '0')
      .map((row) => ({
        day: toPlainDate(row.day),
        category: row.category && isTripCategory(row.category) ? row.category : 'other',
        amount: row.spent,
      })),
    reserveReleased: trip.reserveReleased,
    rollingPolicy: trip.rollingPolicy,
    monthlySavingCapacity: input.monthlySavingCapacity ?? null,
  };
}

/** The base-currency share of a booking already paid. */
function paidInBase(booking: BookingRow, minorUnits: number): string {
  if (booking.paymentStatus === 'paid') return booking.amountBase;
  // Proportional: paid / price × base price, in integers at scale 4.
  const toUnits = (value: string): bigint => {
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0').slice(0, 4));
  };
  const paid = toUnits(booking.paidAmount);
  const full = toUnits(booking.amount);
  const baseFull = toUnits(booking.amountBase);
  if (full <= 0n) return '0';
  const share = (paid * baseFull) / full;
  const step = 10n ** BigInt(4 - minorUnits);
  const rounded = (share / step) * step;
  return `${(rounded / 10_000n).toString()}.${(rounded % 10_000n).toString().padStart(4, '0')}`;
}

export type GoalLight = 'green' | 'yellow' | 'red';

export interface GoalPlan {
  readonly remaining: Money;
  readonly months: number;
  readonly monthly: Money;
  readonly light: GoalLight;
  /** What is free each month once the other goals take theirs. */
  readonly free: Money;
  /** Yellow: how much other goals would have to give up each month. */
  readonly squeeze: Money | null;
  /** Red: the months it takes at the free capacity, and the fund that fits the date. */
  readonly monthsNeeded: number | null;
  readonly affordableTotal: Money | null;
}

/** Whole calendar months from `today` to `deadline`, at least one. */
export function monthsUntil(today: PlainDate, deadline: PlainDate): number {
  const [ty = 0, tm = 0, td = 0] = today.split('-').map(Number);
  const [dy = 0, dm = 0, dd = 0] = deadline.split('-').map(Number);
  let months = (dy - ty) * 12 + (dm - tm);
  if (dd < td) months -= 1;
  return Math.max(1, months);
}

/**
 * Whether the trip's saving plan fits the household.
 *
 * Green: the monthly contribution fits in what is free after the other goals.
 * Yellow: it fits only if the other goals give some of theirs up. Red: it does
 * not fit at all, and the options say by how much — more months at the free
 * capacity, or the fund that the date allows.
 */
export function planTripGoal(input: {
  readonly target: Money;
  readonly saved: Money;
  readonly today: PlainDate;
  readonly deadline: PlainDate;
  readonly monthlyCapacity: Money;
  readonly otherGoalsMonthly: Money;
}): GoalPlan {
  const currency: CurrencyCode = input.target.currency;
  const zero = Money.zero(currency);
  const remaining = Money.max(zero, input.target.subtract(input.saved));
  const months = monthsUntil(input.today, input.deadline);
  // Rounded up to the cent, so the plan reaches the target rather than missing it by one.
  const monthly = remaining.divide(months, 'down').roundToCurrencyPrecision('half-up');
  const monthlyUp = monthly.multiply(months).lessThan(remaining)
    ? monthly.add(Money.fromDecimalString('0.01', currency))
    : monthly;
  const free = Money.max(zero, input.monthlyCapacity.subtract(input.otherGoalsMonthly));

  if (remaining.isZero() || monthlyUp.lessThanOrEqual(free)) {
    return {
      remaining,
      months,
      monthly: monthlyUp,
      light: 'green',
      free,
      squeeze: null,
      monthsNeeded: null,
      affordableTotal: null,
    };
  }
  if (monthlyUp.lessThanOrEqual(input.monthlyCapacity)) {
    return {
      remaining,
      months,
      monthly: monthlyUp,
      light: 'yellow',
      free,
      squeeze: monthlyUp.subtract(free),
      monthsNeeded: null,
      affordableTotal: null,
    };
  }
  const monthsNeeded = free.isPositive()
    ? Number((remaining.scaledUnits + free.scaledUnits - 1n) / free.scaledUnits)
    : null;
  return {
    remaining,
    months,
    monthly: monthlyUp,
    light: 'red',
    free,
    squeeze: null,
    monthsNeeded,
    affordableTotal: input.saved.add(free.multiply(months)),
  };
}

/** The deadline a trip's goal gets: a week before departure. */
export const goalDeadline = (startDate: PlainDate): PlainDate => {
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  return toPlainDate(date.toISOString().slice(0, 10));
};
