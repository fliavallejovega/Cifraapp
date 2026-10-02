import { DAILY_CATEGORIES, type DailyCategory, type TripCategory } from './categories.js';
import type { TripBudget } from './types.js';
import { divide, fromMinor, maxUnits, sumUnits, toMinor } from './units.js';

/**
 * The closing report: what was planned against what happened.
 *
 * Built from the budget the engine computed with the whole trip's spending
 * (phase «after», where every day keeps its original plan) and the spending
 * itself, tagged by category, leg, day and payer. The insights are rules over
 * these numbers — «30 % more on food» — never a model's prose.
 */

export interface SpentLine {
  readonly day: string;
  readonly category: TripCategory | null;
  readonly legId: string | null;
  readonly travelerId: string | null;
  /** Base currency, positive. */
  readonly amount: string;
}

export interface ReportRow {
  readonly key: string;
  readonly planned: string;
  readonly actual: string;
  /** Actual over planned, in percent (100 = on plan); null when nothing was planned. */
  readonly ratio: number | null;
}

export type Insight =
  | { readonly kind: 'category_over'; readonly category: DailyCategory; readonly percent: number }
  | { readonly kind: 'category_under'; readonly category: DailyCategory; readonly percent: number }
  | { readonly kind: 'overall_under'; readonly amount: string }
  | { readonly kind: 'overall_over'; readonly amount: string }
  | { readonly kind: 'reserve_untouched' }
  | { readonly kind: 'reserve_used'; readonly percent: number }
  | { readonly kind: 'exchange'; readonly amount: string };

export interface TripReport {
  readonly engineVersion: string;
  readonly currency: string;
  /** What the days were planned to spend, and what they did. */
  readonly planned: string;
  readonly actual: string;
  /** Planned minus actual: positive is money left over. */
  readonly difference: string;
  /** Left over to return: days' fund + unused reserve − actual, never negative. */
  readonly surplus: string;
  /** Spent beyond fund and reserve, never negative. */
  readonly overrun: string;
  readonly byCategory: readonly ReportRow[];
  readonly byLeg: readonly ReportRow[];
  readonly byDay: readonly (ReportRow & {
    readonly cumulativePlanned: string;
    readonly cumulativeActual: string;
  })[];
  readonly byTraveler: readonly { readonly travelerId: string | null; readonly actual: string }[];
  readonly reserve: {
    readonly planned: string;
    readonly used: string;
    readonly usedPercent: number;
  };
  readonly exchangeEffect: string;
  readonly insights: readonly Insight[];
  /** The real split across daily categories, in basis points: the template's learned profile. */
  readonly learnedShares: Readonly<Record<DailyCategory, number>> | null;
}

const ratio = (actual: bigint, planned: bigint): number | null =>
  planned > 0n ? Number(divide(actual * 1000n, planned)) / 10 : null;

/** Builds the report. `budget` must be computed with today after the trip's end. */
export function buildTripReport(input: {
  readonly budget: TripBudget;
  readonly spent: readonly SpentLine[];
  readonly exchangeEffect?: string;
}): TripReport {
  const { budget } = input;
  const mu = budget.currency.minorUnits;
  const m = (v: string) => toMinor(v, mu);
  const out = (u: bigint) => fromMinor(u, mu);

  const spentDaily = input.spent.filter(
    (s) => s.category === null || (DAILY_CATEGORIES as readonly string[]).includes(s.category),
  );
  const actualOf = (filter: (s: SpentLine) => boolean) =>
    sumUnits(spentDaily.filter(filter).map((s) => m(s.amount)));

  // Categories: planned from the days' original cells, actual from spending.
  const plannedByCategory = new Map<DailyCategory, bigint>(DAILY_CATEGORIES.map((c) => [c, 0n]));
  for (const day of budget.days) {
    for (const c of DAILY_CATEGORIES)
      plannedByCategory.set(c, (plannedByCategory.get(c) ?? 0n) + m(day.planned[c]));
  }
  const byCategory: ReportRow[] = DAILY_CATEGORIES.map((c) => {
    const planned = plannedByCategory.get(c) ?? 0n;
    const actual = actualOf((s) => (s.category ?? 'other') === c);
    return { key: c, planned: out(planned), actual: out(actual), ratio: ratio(actual, planned) };
  }).filter((row) => row.planned !== out(0n) || row.actual !== out(0n));

  const legIds = [...new Set(budget.days.map((d) => d.legId))];
  const byLeg: ReportRow[] = legIds.map((legId) => {
    const planned = sumUnits(
      budget.days.filter((d) => d.legId === legId).map((d) => m(d.originalTotal)),
    );
    const dates = new Set(
      budget.days.filter((d) => d.legId === legId).map((d) => d.date as string),
    );
    const actual = actualOf((s) => (s.legId ? s.legId === legId : dates.has(s.day)));
    return {
      key: legId ?? '',
      planned: out(planned),
      actual: out(actual),
      ratio: ratio(actual, planned),
    };
  });

  let cumPlanned = 0n;
  let cumActual = 0n;
  const first = budget.days[0]?.date ?? '';
  const last = budget.days[budget.days.length - 1]?.date ?? '';
  const byDay = budget.days.map((d, i) => {
    const planned = m(d.originalTotal);
    // Spending outside the dates lands on the first or last day, as in the engine.
    const actual = actualOf(
      (s) =>
        s.day === d.date ||
        (i === 0 && s.day < first) ||
        (i === budget.days.length - 1 && s.day > last),
    );
    cumPlanned += planned;
    cumActual += actual;
    return {
      key: d.date,
      planned: out(planned),
      actual: out(actual),
      ratio: ratio(actual, planned),
      cumulativePlanned: out(cumPlanned),
      cumulativeActual: out(cumActual),
    };
  });

  const travelers = new Map<string | null, bigint>();
  for (const s of spentDaily)
    travelers.set(s.travelerId, (travelers.get(s.travelerId) ?? 0n) + m(s.amount));
  const byTraveler = [...travelers.entries()].map(([travelerId, u]) => ({
    travelerId,
    actual: out(u),
  }));

  const plannedDays = sumUnits(budget.days.map((d) => m(d.originalTotal)));
  const actual = sumUnits(spentDaily.map((s) => m(s.amount)));
  const reservePlanned = m(budget.reserve.planned);
  const reserveReleased = m(budget.reserve.released);
  // The reserve is «used» by what was released plus whatever spending went past the days' fund.
  const fundForDays = maxUnits(0n, m(budget.fundForDays));
  const beyondDays = maxUnits(0n, actual - fundForDays);
  const reserveUsed =
    reservePlanned > 0n ? minUnits(reservePlanned, reserveReleased + beyondDays) : 0n;
  const surplus = maxUnits(0n, fundForDays + (reservePlanned - reserveReleased) - actual);
  const overrun = maxUnits(0n, actual - fundForDays - (reservePlanned - reserveReleased));

  // The three categories that moved furthest from their plan, largest gap first.
  const insights: Insight[] = byCategory
    .filter((row) => row.ratio !== null)
    .map((row) => ({ row, gap: m(row.actual) - m(row.planned) }))
    .filter(({ row, gap }) => {
      const meaningful = (gap < 0n ? -gap : gap) * 20n >= plannedDays; // at least 5 % of the days' plan
      return meaningful && row.ratio !== null && (row.ratio >= 120 || row.ratio <= 80);
    })
    .sort((a, b) => {
      const ga = a.gap < 0n ? -a.gap : a.gap;
      const gb = b.gap < 0n ? -b.gap : b.gap;
      return ga === gb ? 0 : ga > gb ? -1 : 1;
    })
    .slice(0, 3)
    .map(({ row }): Insight => {
      const r = row.ratio ?? 100;
      return r >= 120
        ? {
            kind: 'category_over',
            category: row.key as DailyCategory,
            percent: Math.round(r - 100),
          }
        : {
            kind: 'category_under',
            category: row.key as DailyCategory,
            percent: Math.round(100 - r),
          };
    });
  const difference = plannedDays - actual;
  if (difference > 0n) insights.push({ kind: 'overall_under', amount: out(difference) });
  else if (difference < 0n) insights.push({ kind: 'overall_over', amount: out(-difference) });
  if (reservePlanned > 0n) {
    insights.push(
      reserveUsed === 0n
        ? { kind: 'reserve_untouched' }
        : { kind: 'reserve_used', percent: Number(divide(reserveUsed * 100n, reservePlanned)) },
    );
  }
  const exchange = input.exchangeEffect ?? out(0n);
  if (m(exchange) !== 0n) insights.push({ kind: 'exchange', amount: exchange });

  const dailyActual = DAILY_CATEGORIES.map((c) => actualOf((s) => (s.category ?? 'other') === c));
  const dailySum = sumUnits(dailyActual);
  let learnedShares: Record<DailyCategory, number> | null = null;
  if (dailySum > 0n) {
    const raw = dailyActual.map((u) => (u * 10_000n) / dailySum);
    let left = 10_000n - sumUnits(raw);
    const order = dailyActual
      .map((u, i) => ({ i, rest: (u * 10_000n) % dailySum }))
      .sort((a, b) => (a.rest === b.rest ? a.i - b.i : a.rest > b.rest ? -1 : 1));
    for (const { i } of order) {
      if (left === 0n) break;
      raw[i] = (raw[i] ?? 0n) + 1n;
      left -= 1n;
    }
    learnedShares = Object.fromEntries(
      DAILY_CATEGORIES.map((c, i) => [c, Number(raw[i] ?? 0n)]),
    ) as Record<DailyCategory, number>;
  }

  return {
    engineVersion: budget.engineVersion,
    currency: budget.currency.code,
    planned: out(plannedDays),
    actual: out(actual),
    difference: out(difference),
    surplus: out(surplus),
    overrun: out(overrun),
    byCategory,
    byLeg,
    byDay,
    byTraveler,
    reserve: {
      planned: out(reservePlanned),
      used: out(reserveUsed),
      usedPercent: reservePlanned > 0n ? Number(divide(reserveUsed * 100n, reservePlanned)) : 0,
    },
    exchangeEffect: exchange,
    insights,
    learnedShares,
  };
}

const minUnits = (a: bigint, b: bigint): bigint => (a < b ? a : b);
