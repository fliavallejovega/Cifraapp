import { inferPlace, type CostLevel } from '../lib/places';

/**
 * A trip typed in one sentence — «Madrid y Lisboa del 10 al 20 de diciembre,
 * los cuatro, unos 6 mil dólares» — turned into the wizard's first answers.
 *
 * The model only transcribes: places, dates as written, how many nights,
 * how many people, the amount and whether it was per person or per day. Every
 * figure that needs arithmetic — a departure from nights, a total from a
 * per-person amount — is computed here, and anything that does not hold up
 * (a date in the past, a currency the household does not use) is dropped and
 * named, so the family sees what was not understood.
 */

export interface RawQuickTrip {
  readonly name: string;
  readonly legs: readonly {
    readonly city: string;
    readonly country: string;
    readonly arrival_date: string;
    readonly departure_date: string;
    readonly nights: string;
  }[];
  readonly adults: string;
  readonly children: string;
  readonly infants: string;
  readonly budget_amount: string;
  readonly budget_currency: string;
  readonly budget_scope: string;
  readonly style: string;
}

export interface QuickLeg {
  readonly city: string;
  readonly countryCode: string;
  readonly arrivalDate: string;
  readonly departureDate: string;
  readonly localCurrency: string;
  readonly timezone: string;
  readonly costLevel: CostLevel;
}

export interface QuickTrip {
  readonly name: string;
  readonly legs: readonly QuickLeg[];
  readonly travelers: {
    readonly adults: number;
    readonly children: number;
    readonly infants: number;
  } | null;
  readonly totalBudget: string | null;
  readonly profile: 'economy' | 'balanced' | 'comfort' | null;
  /** What was said but could not be used. */
  readonly dropped: readonly ('dates' | 'budget' | 'currency' | 'places')[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const COUNT = /^\d{1,2}$/;
const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

const validDate = (v: string) =>
  ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null;

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** «1500» × n, in cents, never through a float. */
const times = (amount: string, n: number): string => {
  const [w = '0', f = ''] = amount.split('.');
  const cents = (BigInt(w) * 100n + BigInt((f + '00').slice(0, 2))) * BigInt(n);
  return `${String(cents / 100n)}.${String(cents % 100n).padStart(2, '0')}`;
};

export function normalizeQuickTrip(
  raw: RawQuickTrip,
  context: { readonly today: string; readonly currency: string },
): QuickTrip {
  const dropped = new Set<QuickTrip['dropped'][number]>();
  const named = raw.legs.slice(0, 6).filter((leg) => {
    if (leg.city.trim()) return true;
    dropped.add('places');
    return false;
  });

  // The stays share their edges: leg i leaves the day leg i + 1 arrives.
  // Edges the text gave (or that follow from nights) are kept; edges between
  // two known ones are spread evenly, so «Madrid y Lisboa del 10 al 20» gives
  // five nights each instead of nothing.
  const edges: (string | null)[] = Array.from({ length: named.length + 1 }, () => null);
  named.forEach((leg, i) => {
    edges[i] ??= validDate(leg.arrival_date.trim());
    edges[i + 1] = validDate(leg.departure_date.trim()) ?? edges[i + 1] ?? null;
  });
  named.forEach((leg, i) => {
    const nights = COUNT.test(leg.nights.trim()) ? Number(leg.nights.trim()) : null;
    const from = edges[i];
    if (nights !== null && from && !edges[i + 1]) edges[i + 1] = addDays(from, nights);
  });
  for (let i = 0; i < edges.length; i += 1) {
    const from = edges[i];
    if (!from) continue;
    let j = i + 1;
    while (j < edges.length && !edges[j]) j += 1;
    const to = edges[j];
    if (j >= edges.length || !to || j === i + 1) continue;
    const span = daysBetween(from, to);
    const parts = j - i;
    for (let k = 1; k < parts; k += 1) {
      edges[i + k] = addDays(from, Math.floor((span * k) / parts));
    }
  }

  const legs: QuickLeg[] = [];
  named.forEach((leg, i) => {
    const arrival = edges[i] ?? null;
    const departure = edges[i + 1] ?? null;
    const usable =
      arrival !== null &&
      departure !== null &&
      arrival >= context.today &&
      departure >= arrival &&
      daysBetween(arrival, departure) <= 90;
    if (!usable) {
      dropped.add('dates');
      return;
    }
    const city = leg.city.trim().slice(0, 80);
    const place = inferPlace(city, leg.country.trim().toUpperCase().slice(0, 2) || null);
    legs.push({
      city,
      countryCode: place.countryCode ?? '',
      arrivalDate: arrival,
      departureDate: departure,
      localCurrency: place.currency ?? context.currency,
      timezone: place.timezone ?? 'America/Panama',
      costLevel: place.level,
    });
  });

  const count = (v: string) => (COUNT.test(v.trim()) ? Number(v.trim()) : 0);
  const adults = count(raw.adults);
  const children = count(raw.children);
  const infants = count(raw.infants);
  const travelers = adults + children + infants > 0 ? { adults, children, infants } : null;

  let totalBudget: string | null = null;
  const amount = raw.budget_amount.trim().replace(/,/g, '');
  if (amount) {
    const code = raw.budget_currency.trim().toUpperCase();
    const sameMoney =
      code === '' ||
      code === context.currency ||
      (['USD', 'PAB'].includes(code) && ['USD', 'PAB'].includes(context.currency));
    if (!AMOUNT.test(amount)) dropped.add('budget');
    else if (!sameMoney) dropped.add('currency');
    else if (raw.budget_scope === 'per_person') {
      const people = adults + children;
      if (people > 0) totalBudget = times(amount, people);
      else dropped.add('budget');
    } else if (raw.budget_scope === 'per_day') {
      const first = legs[0]?.arrivalDate;
      const last = legs[legs.length - 1]?.departureDate;
      if (first && last) totalBudget = times(amount, daysBetween(first, last) + 1);
      else dropped.add('budget');
    } else totalBudget = times(amount, 1);
  }

  const profile =
    raw.style === 'economy' || raw.style === 'balanced' || raw.style === 'comfort'
      ? raw.style
      : null;

  return {
    name: raw.name.trim().slice(0, 120),
    legs,
    travelers,
    totalBudget,
    profile,
    dropped: [...dropped],
  };
}
