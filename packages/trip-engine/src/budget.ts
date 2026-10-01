import { addDays, comparePlainDates, daysBetween, type PlainDate } from '@app/domain';

import { allocateUnits } from './allocate.js';
import {
  DAILY_CATEGORIES,
  isDailyCategory,
  sharesFor,
  type DailyCategory,
  type Shares,
} from './categories.js';
import { baseToLocalUnits } from './fx.js';
import { PROFILE_FACTOR, referenceDailyUnits } from './reference.js';
import type {
  BookingType,
  CategoryAmounts,
  DayKind,
  LegInput,
  LegSummary,
  Suggestion,
  TripBudget,
  TripBudgetInput,
  TripDay,
  Warning,
} from './types.js';
import { divide, fromMinor, maxUnits, minUnits, sumUnits, toMinor, toScaled } from './units.js';

export const ENGINE_VERSION = '1.0.0';

type Cells = Record<DailyCategory, bigint>;

interface Day {
  readonly index: number;
  readonly date: PlainDate;
  readonly leg: LegInput | null;
  readonly kind: DayKind;
  /** Scale 3: 1000 is a full day. */
  readonly weight: bigint;
  /** Scale 2: 100 is the reference cost. */
  readonly costIndex: bigint;
  /** A night is spent after this day: every day but the last of the trip. */
  readonly isNight: boolean;
}

const zeroCells = (): Cells => ({
  lodging: 0n,
  food: 0n,
  local_transport: 0n,
  activities: 0n,
  shopping: 0n,
  other: 0n,
});
const cellsTotal = (cells: Cells): bigint => sumUnits(DAILY_CATEGORIES.map((c) => cells[c]));

/**
 * Computes a trip's budget: what is committed, what is set aside, and what
 * every day may spend, by category, by leg and by traveller.
 *
 * Pure. `today` is an input, nothing is read from a clock or a database, and
 * the same input always produces the same output. Every split uses largest
 * remainder over integers, and before returning the engine proves that the
 * parts add back to the fund exactly — a mismatch throws, because a budget
 * that loses a cent is a bug, not a rounding choice.
 */
export function computeTripBudget(input: TripBudgetInput): TripBudget {
  const mu = input.currency.minorUnits;
  const m = (value: string): bigint => toMinor(value, mu);
  const out = (units: bigint): string => fromMinor(units, mu);
  const warnings: Warning[] = [];
  const shares = sharesFor(input.profile, input.customShares);

  // --- 1. Days ---------------------------------------------------------------
  const days = buildDays(input);
  const effectiveWeight = sumUnits(days.map((d) => d.weight));
  if (input.legs.length === 0) warnings.push({ kind: 'no_legs' });
  else {
    const orphan = days.filter((d) => d.leg === null).length;
    if (orphan > 0) warnings.push({ kind: 'days_without_leg', days: orphan });
  }
  if (input.travelers.length === 0) warnings.push({ kind: 'no_travelers' });

  // --- 2. Commitments --------------------------------------------------------
  let prepaid = 0n;
  let pending = 0n;
  const byType: Partial<Record<BookingType, bigint>> = {};
  for (const booking of input.bookings) {
    const priceUnits = maxUnits(0n, m(booking.amountBase));
    const paid =
      booking.paymentStatus === 'paid'
        ? priceUnits
        : minUnits(priceUnits, maxUnits(0n, m(booking.paidBase ?? '0')));
    prepaid += paid;
    pending += priceUnits - paid;
    byType[booking.type] = (byType[booking.type] ?? 0n) + priceUnits;
    const before = booking.startsOn && daysBetween(booking.startsOn, input.startDate) > 1;
    const after = booking.endsOn && daysBetween(input.endDate, booking.endsOn) > 1;
    if (before || after) warnings.push({ kind: 'booking_outside_trip', bookingId: booking.id });
  }

  // --- 3. Reserve ------------------------------------------------------------
  const fund = m(input.totalBudget);
  const afterCommitments = fund - prepaid - pending;
  let reservePlanned = 0n;
  if (afterCommitments > 0n) {
    reservePlanned =
      input.contingency.type === 'percent'
        ? divide(afterCommitments * toScaled(input.contingency.value, 4), 1_000_000n, 'down')
        : minUnits(maxUnits(0n, m(input.contingency.value)), afterCommitments);
    reservePlanned = minUnits(maxUnits(0n, reservePlanned), afterCommitments);
  }
  const released = minUnits(maxUnits(0n, m(input.reserveReleased ?? '0')), reservePlanned);
  const reserveAvailable = reservePlanned - released;

  // --- 4. Fund for the days --------------------------------------------------
  const fundForDays = afterCommitments - reservePlanned + released;

  // --- 5–7. Spread over days and categories ------------------------------------
  const phase: TripBudget['phase'] =
    comparePlainDates(input.today, input.startDate) < 0
      ? 'before'
      : comparePlainDates(input.today, input.endDate) > 0
        ? 'after'
        : 'during';
  const todayIndex = phase === 'during' ? daysBetween(input.startDate, input.today) : -1;

  const original = spread(maxUnits(0n, fundForDays), days, days, input, shares, mu);
  if (original.excess > 0n)
    warnings.push({ kind: 'overrides_exceed_fund', excess: out(original.excess) });

  // Spending, by day. Anything dated before the trip lands on its first day,
  // anything after on its last.
  const spentCells = new Map<number, Partial<Record<string, bigint>>>();
  let spentBefore = 0n;
  let spentToday = 0n;
  let spentAhead = 0n;
  let spentAll = 0n;
  for (const s of input.spent ?? []) {
    const value = maxUnits(0n, m(s.amount));
    spentAll += value;
    const offset = daysBetween(input.startDate, s.day);
    const index = Math.min(Math.max(offset, 0), days.length - 1);
    const bucket = spentCells.get(index) ?? {};
    bucket[s.category] = (bucket[s.category] ?? 0n) + value;
    spentCells.set(index, bucket);
    if (phase === 'after') spentBefore += value;
    else if (phase === 'during') {
      if (offset < todayIndex) spentBefore += value;
      else if (offset === todayIndex) spentToday += value;
      // Paid ahead for a later day (a museum ticket): already gone from what remains.
      else spentAhead += value;
    }
  }
  const policy = input.rollingPolicy ?? 'rolling';

  // Rolling: what is left after the past is spread again over today and the days ahead.
  let current = original.cells;
  let rollingRemaining = fundForDays;
  let respreadExcess = 0n;
  const rolling = phase === 'during' && policy === 'rolling';
  if (phase === 'during') {
    rollingRemaining = fundForDays - spentBefore - spentAhead;
    if (rolling) {
      const ahead = days.filter((d) => d.index >= todayIndex);
      const respread = spread(maxUnits(0n, rollingRemaining), ahead, days, input, shares, mu);
      respreadExcess = respread.excess;
      current = days.map((d) =>
        d.index >= todayIndex
          ? (respread.cells[d.index] ?? zeroCells())
          : (original.cells[d.index] ?? zeroCells()),
      );
    }
  }

  // --- Invariant: the parts add back to the fund, exactly. --------------------
  // Checked whenever the fund covers what was asked of it; in a deficit there
  // is nothing to add back to.
  const sumCells = (from: number): bigint =>
    sumUnits(
      days.filter((d) => d.index >= from).map((d) => cellsTotal(current[d.index] ?? zeroCells())),
    );
  if (rolling) {
    if (rollingRemaining >= 0n && respreadExcess === 0n) {
      assertEqual(
        prepaid + pending + reserveAvailable + spentBefore + spentAhead + sumCells(todayIndex),
        fund,
        mu,
      );
    }
  } else if (fundForDays >= 0n && original.excess === 0n) {
    const planned = sumUnits(original.cells.map(cellsTotal)) + original.unallocated;
    assertEqual(prepaid + pending + reserveAvailable + planned, fund, mu);
  }

  // --- Days out ------------------------------------------------------------------
  const tripDays: TripDay[] = days.map((d) => {
    const planned = current[d.index] ?? zeroCells();
    const spentBucket = spentCells.get(d.index) ?? {};
    const spentTotal = sumUnits(
      Object.values(spentBucket).filter((v): v is bigint => v !== undefined),
    );
    const timing: TripDay['timing'] =
      phase === 'before'
        ? 'future'
        : phase === 'after'
          ? 'past'
          : d.index < todayIndex
            ? 'past'
            : d.index === todayIndex
              ? 'today'
              : 'future';
    const reference =
      timing === 'past' ? cellsTotal(original.cells[d.index] ?? zeroCells()) : cellsTotal(planned);
    const state: TripDay['state'] =
      timing === 'future' && spentTotal === 0n
        ? 'none'
        : spentTotal > reference
          ? 'over'
          : reference > 0n && spentTotal * 10n >= reference * 8n
            ? 'near'
            : 'ok';
    return {
      date: d.date,
      legId: d.leg?.id ?? null,
      kind: d.kind,
      weight: fromMinor(d.weight, 3),
      timing,
      planned: toAmounts(planned, mu),
      plannedTotal: out(cellsTotal(planned)),
      originalTotal: out(cellsTotal(original.cells[d.index] ?? zeroCells())),
      spent: Object.fromEntries(Object.entries(spentBucket).map(([k, v]) => [k, out(v ?? 0n)])),
      spentTotal: out(spentTotal),
      state,
    };
  });

  // --- Legs ------------------------------------------------------------------------
  const legs: LegSummary[] = input.legs.map((leg) => {
    const legDays = days.filter((d) => d.leg?.id === leg.id);
    const cellsOf = (d: Day): Cells => current[d.index] ?? zeroCells();
    const full = legDays.find((d) => d.kind === 'full' || d.kind === 'single');
    const partial = legDays.find(
      (d) => (d.kind === 'arrival' || d.kind === 'departure') && d.weight > 0n,
    );
    const local =
      leg.localCurrency && leg.fxRate && leg.localCurrency.code !== input.currency.code
        ? leg
        : null;
    if (leg.localCurrency && leg.localCurrency.code !== input.currency.code && !leg.fxRate) {
      warnings.push({ kind: 'missing_fx', legId: leg.id, currency: leg.localCurrency.code });
    }
    const toLocal = (units: bigint): string | null =>
      local?.localCurrency && local.fxRate
        ? fromMinor(
            baseToLocalUnits(units, local.fxRate, mu, local.localCurrency.minorUnits),
            local.localCurrency.minorUnits,
          )
        : leg.localCurrency?.code === input.currency.code
          ? out(units)
          : null;
    const nights = legDays.filter((d) => d.isNight).length;
    const lodgingPool = sumUnits(legDays.map((d) => cellsOf(d).lodging));
    if (leg.lodgingMode === 'undecided' && nights > 0) {
      warnings.push({ kind: 'lodging_undecided', legId: leg.id, nights });
    }
    return {
      legId: leg.id,
      days: legDays.length,
      nights,
      plannedTotal: out(sumUnits(legDays.map((d) => cellsTotal(cellsOf(d))))),
      perDiemFull: full ? out(cellsTotal(cellsOf(full))) : null,
      perDiemFullLocal: full ? toLocal(cellsTotal(cellsOf(full))) : null,
      perDiemPartial: partial ? out(cellsTotal(cellsOf(partial))) : null,
      perDiemPartialLocal: partial ? toLocal(cellsTotal(cellsOf(partial))) : null,
      fullDay: full ? toAmounts(cellsOf(full), mu) : null,
      lodgingToBook:
        leg.lodgingMode === 'undecided' && nights > 0
          ? { perNight: out(divide(lodgingPool, BigInt(nights), 'down')), nights }
          : null,
      localCurrency: leg.localCurrency?.code ?? null,
    };
  });

  // --- Totals by category ------------------------------------------------------------
  const byCategory = zeroCells();
  for (const d of days)
    for (const c of DAILY_CATEGORIES) byCategory[c] += (current[d.index] ?? zeroCells())[c];

  // --- Today ---------------------------------------------------------------------------
  let today: TripBudget['today'] = null;
  if (phase === 'during') {
    const allowedCells = current[todayIndex] ?? zeroCells();
    const spentBucket = spentCells.get(todayIndex) ?? {};
    const allowed = cellsTotal(allowedCells);
    const left = allowed - spentToday;
    today = {
      date: input.today,
      allowed: out(allowed),
      spent: out(spentToday),
      remaining: out(maxUnits(0n, left)),
      overspent: out(maxUnits(0n, -left)),
      byCategory: Object.fromEntries(
        DAILY_CATEGORIES.map((c) => {
          const s = spentBucket[c] ?? 0n;
          return [
            c,
            {
              allowed: out(allowedCells[c]),
              spent: out(s),
              remaining: out(maxUnits(0n, allowedCells[c] - s)),
            },
          ];
        }),
      ) as Record<DailyCategory, { allowed: string; spent: string; remaining: string }>,
    };
  }

  // --- Per traveller -----------------------------------------------------------------
  const representative =
    phase === 'during'
      ? cellsTotal(current[todayIndex] ?? zeroCells())
      : (() => {
          const full = days.find((d) => d.kind === 'full' || d.kind === 'single');
          return full ? cellsTotal(current[full.index] ?? zeroCells()) : 0n;
        })();
  const travelerWeights = input.travelers.map((t) => maxUnits(0n, toScaled(t.weight, 3)));
  const perTraveler =
    sumUnits(travelerWeights) > 0n
      ? allocateUnits(maxUnits(0n, representative), travelerWeights).map((units, i) => ({
          travelerId: input.travelers[i]?.id ?? '',
          amount: out(units),
        }))
      : [];

  // --- Drift (fixed policy) ------------------------------------------------------------
  const plannedPast = sumUnits(
    days
      .filter((d) => phase === 'after' || (phase === 'during' && d.index < todayIndex))
      .map((d) => cellsTotal(original.cells[d.index] ?? zeroCells())),
  );
  const drift = phase === 'before' ? 0n : plannedPast - spentBefore;

  // --- Diagnostics ---------------------------------------------------------------------
  const suggestions: Suggestion[] = [];
  let status: TripBudget['diagnostics']['status'] = 'healthy';
  let shortfall = 0n;

  if (fundForDays < 0n || original.excess > 0n) {
    status = 'deficit';
    shortfall = maxUnits(-fundForDays, original.excess);
    if (reservePlanned > 0n) {
      const kept = maxUnits(0n, reservePlanned - shortfall);
      suggestions.push({
        kind: 'lower_reserve',
        percent:
          afterCommitments > 0n
            ? fromMinor(divide(kept * 10_000n, afterCommitments, 'down'), 2)
            : '0.00',
        frees: out(reservePlanned - kept),
        fixes: reservePlanned >= shortfall,
      });
    }
  } else if (phase === 'during' && (rollingRemaining < 0n || respreadExcess > 0n)) {
    status = 'deficit';
    shortfall = maxUnits(-rollingRemaining, respreadExcess);
  }
  if (phase === 'during' && status === 'deficit' && reserveAvailable > 0n) {
    suggestions.push({
      kind: 'use_reserve',
      amount: out(minUnits(reserveAvailable, shortfall)),
      fixes: reserveAvailable >= shortfall,
    });
  }

  // Below the reference for the cost level: a hint, never a verdict.
  const people = sumUnits(travelerWeights);
  const belowReference: { legId: string; perPerson: string; reference: string }[] = [];
  if (people > 0n && status !== 'deficit') {
    for (const leg of legs) {
      const legInput = input.legs.find((l) => l.id === leg.legId);
      if (!legInput || !leg.fullDay) continue;
      const nonLodging = sumUnits(
        DAILY_CATEGORIES.filter((c) => c !== 'lodging').map((c) => m(leg.fullDay?.[c] ?? '0')),
      );
      const reference = referenceDailyUnits(
        mu,
        people,
        toScaled(legInput.costIndex, 2),
        input.profile,
      );
      if (nonLodging * 10n < reference * 7n) {
        belowReference.push({
          legId: leg.legId,
          perPerson: out(divide(nonLodging * 1000n, people, 'down')),
          reference: out(divide(reference * 1000n, people, 'down')),
        });
      }
    }
    if (belowReference.length > 0) status = 'tight';
  }

  if (status !== 'healthy') {
    if (shortfall > 0n || status === 'tight') {
      const need = shortfall > 0n ? shortfall : estimateGap(days, input, people, fundForDays, mu);
      if (need > 0n) {
        const capacity = input.monthlySavingCapacity ? m(input.monthlySavingCapacity) : 0n;
        suggestions.push({
          kind: 'add_money',
          amount: out(need),
          months: capacity > 0n ? Number(divide(need + capacity - 1n, capacity, 'down')) : null,
        });
      }
    }
    if (status === 'tight' && people > 0n && fundForDays > 0n) {
      const avgIndex = averageIndex(days);
      const perDay = referenceDailyUnits(mu, people, avgIndex, input.profile);
      const affordable = perDay > 0n ? Number(fundForDays / perDay) : days.length;
      if (affordable >= 1 && affordable < days.length)
        suggestions.push({ kind: 'fewer_days', days: affordable });
    }
    if (input.profile !== 'economy' && people > 0n) {
      const avgIndex = averageIndex(days);
      const now = referenceDailyUnits(mu, people, avgIndex, input.profile);
      const economy = divide(now * PROFILE_FACTOR.economy, PROFILE_FACTOR[input.profile], 'down');
      const saves = divide((now - economy) * effectiveWeight, 1000n, 'down');
      if (saves > 0n) suggestions.push({ kind: 'economy_profile', saves: out(saves) });
    }
  }

  return {
    engineVersion: ENGINE_VERSION,
    currency: input.currency,
    phase,
    totalBudget: out(fund),
    commitments: {
      prepaid: out(prepaid),
      pending: out(pending),
      byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, out(v)])),
    },
    reserve: {
      planned: out(reservePlanned),
      released: out(released),
      available: out(reserveAvailable),
    },
    fundForDays: out(fundForDays),
    effectiveDays: fromMinor(effectiveWeight, 3),
    days: tripDays,
    legs,
    byCategory: toAmounts(byCategory, mu),
    spent: { total: out(spentAll), beforeToday: out(spentBefore), today: out(spentToday) },
    today,
    perTraveler,
    drift: out(drift),
    diagnostics: { status, shortfall: out(shortfall), suggestions, warnings, belowReference },
  };
}

function assertEqual(parts: bigint, fund: bigint, mu: number): void {
  if (parts !== fund) {
    throw new Error(
      `trip-engine invariant violated: parts ${fromMinor(parts, mu)} != fund ${fromMinor(fund, mu)} (engine ${ENGINE_VERSION})`,
    );
  }
}

function toAmounts(cells: Cells, mu: number): CategoryAmounts {
  return Object.fromEntries(
    DAILY_CATEGORIES.map((c) => [c, fromMinor(cells[c], mu)]),
  ) as CategoryAmounts;
}

function averageIndex(days: readonly Day[]): bigint {
  const weighted = sumUnits(days.map((d) => d.weight * d.costIndex));
  const weight = sumUnits(days.map((d) => d.weight));
  return weight > 0n ? divide(weighted, weight) : 100n;
}

function estimateGap(
  days: readonly Day[],
  input: TripBudgetInput,
  people: bigint,
  fundForDays: bigint,
  mu: number,
): bigint {
  const perDay = referenceDailyUnits(mu, people, averageIndex(days), input.profile);
  const effective = sumUnits(days.map((d) => d.weight));
  const needed = divide(perDay * effective * 7n, 1000n * 10n);
  return maxUnits(0n, needed - fundForDays);
}

/** Builds the list of trip days with their leg, kind and weight. */
function buildDays(input: TripBudgetInput): Day[] {
  const count = daysBetween(input.startDate, input.endDate) + 1;
  const partial = maxUnits(0n, minUnits(1000n, toScaled(input.partialDays.weight, 3)));
  const legs = [...input.legs].sort((a, b) => comparePlainDates(a.arrivalDate, b.arrivalDate));
  const result: Day[] = [];
  for (let i = 0; i < count; i += 1) {
    const date = addDays(input.startDate, i);
    // The transition day belongs to the leg that arrives.
    const leg =
      [...legs]
        .reverse()
        .find(
          (l) =>
            comparePlainDates(l.arrivalDate, date) <= 0 &&
            comparePlainDates(date, l.departureDate) <= 0,
        ) ?? null;
    const kind: DayKind =
      count === 1 ? 'single' : i === 0 ? 'arrival' : i === count - 1 ? 'departure' : 'full';
    const weight =
      kind === 'arrival'
        ? input.partialDays.includeArrival
          ? partial
          : 0n
        : kind === 'departure'
          ? input.partialDays.includeDeparture
            ? partial
            : 0n
          : 1000n;
    result.push({
      index: i,
      date,
      leg,
      kind,
      weight,
      costIndex: leg ? maxUnits(1n, toScaled(leg.costIndex, 2)) : 100n,
      isNight: i < count - 1,
    });
  }
  return result;
}

/**
 * Spreads `fund` over `subset` (a slice of `all` days): manual overrides
 * first, the rest by day weight × cost index, then within each day by the
 * profile's shares, with lodging moved onto nights for legs that still need a
 * bed. Returns cells for every day of `all` (zero outside the subset).
 */
function spread(
  fund: bigint,
  subset: readonly Day[],
  all: readonly Day[],
  input: TripBudgetInput,
  shares: Shares,
  mu: number,
): { cells: Cells[]; unallocated: bigint; excess: bigint } {
  const cells: Cells[] = all.map(() => zeroCells());
  const fixed: Partial<Record<DailyCategory, bigint>>[] = all.map(() => ({}));
  const inSubset = new Set(subset.map((d) => d.index));
  if (subset.length === 0) return { cells, unallocated: fund, excess: 0n };

  // Overrides: a day, a leg, or the whole trip.
  for (const override of input.overrides ?? []) {
    if (!isDailyCategory(override.category)) continue;
    const value = maxUnits(0n, toMinor(override.amount, mu));
    let targets: Day[];
    if (override.day) {
      const day = all.find((d) => d.date === override.day);
      targets = day && inSubset.has(day.index) ? [day] : [];
    } else {
      targets = subset.filter((d) => (override.legId ? d.leg?.id === override.legId : true));
    }
    if (targets.length === 0) continue;
    const weights = targets.map((d) => d.weight * d.costIndex);
    const parts =
      sumUnits(weights) > 0n
        ? allocateUnits(value, weights)
        : allocateUnits(
            value,
            targets.map(() => 1n),
          );
    targets.forEach((d, i) => {
      const slot = fixed[d.index];
      if (slot) slot[override.category] = (slot[override.category] ?? 0n) + (parts[i] ?? 0n);
    });
  }
  const fixedSum = sumUnits(
    fixed.flatMap((f) => Object.values(f).filter((v): v is bigint => v !== undefined)),
  );
  const excess = maxUnits(0n, fixedSum - fund);
  const free = maxUnits(0n, fund - fixedSum);

  // Days by weight × cost index; if every day weighs zero, evenly.
  let weights = subset.map((d) => d.weight * d.costIndex);
  if (sumUnits(weights) === 0n) weights = subset.map(() => 1n);
  const dayFree = allocateUnits(free, weights);

  subset.forEach((d, i) => {
    const target = cells[d.index];
    if (!target) return;
    const lodgingNeeded = d.leg?.lodgingMode === 'undecided';
    const fixedHere = fixed[d.index] ?? {};
    const eligible = DAILY_CATEGORIES.filter(
      (c) => fixedHere[c] === undefined && (c !== 'lodging' || lodgingNeeded),
    );
    const catWeights = eligible.map((c) => BigInt(shares[c]));
    const portion = dayFree[i] ?? 0n;
    if (eligible.length === 0 || sumUnits(catWeights) === 0n) {
      target.other += portion;
    } else {
      allocateUnits(portion, catWeights).forEach((units, k) => {
        const c = eligible[k];
        if (c) target[c] += units;
      });
    }
    for (const c of DAILY_CATEGORIES) target[c] += fixedHere[c] ?? 0n;
  });

  // Lodging is paid per night: move each leg's free lodging onto its nights.
  const legIds = new Set(subset.map((d) => d.leg?.id).filter((id): id is string => !!id));
  for (const legId of legIds) {
    const legDays = subset.filter(
      (d) => d.leg !== null && d.leg.id === legId && d.leg.lodgingMode === 'undecided',
    );
    if (legDays.length === 0) continue;
    const movable = legDays.filter((d) => fixed[d.index]?.lodging === undefined);
    const nights = movable.filter((d) => d.isNight);
    if (nights.length === 0 || nights.length === movable.length) continue;
    const pool = sumUnits(movable.map((d) => cells[d.index]?.lodging ?? 0n));
    for (const d of movable) {
      const target = cells[d.index];
      if (target) target.lodging = 0n;
    }
    allocateUnits(
      pool,
      nights.map(() => 1n),
    ).forEach((units, k) => {
      const night = nights[k];
      const target = night ? cells[night.index] : undefined;
      if (target) target.lodging += units;
    });
  }

  return { cells, unallocated: 0n, excess };
}
