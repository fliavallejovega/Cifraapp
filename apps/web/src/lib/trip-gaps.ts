/**
 * What the trip still lacks, in nights.
 *
 * After each hotel or flight the family uploads, the screen says what is left
 * in between: nights that belong to no city yet, and cities whose nights have
 * no lodging decided. Deterministic, from the legs alone — the same legs a
 * confirmed hotel creates or fills — so what it says is what the trip holds.
 *
 * A night is the date one goes to sleep: a leg from the 10th to the 12th
 * covers the nights of the 10th and the 11th.
 */

export interface GapLeg {
  readonly city: string;
  readonly arrivalDate: string;
  readonly departureDate: string;
  /** `undecided` is the only one that is a gap; `none` means none is needed. */
  readonly lodgingMode: string;
}

export type TripGap =
  | { readonly kind: 'no_city'; readonly from: string; readonly to: string }
  | {
      readonly kind: 'no_lodging';
      readonly city: string;
      readonly from: string;
      readonly to: string;
    };

function nextDay(date: string): string {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Every night from `from` up to, not including, `until`. */
function nights(from: string, until: string): string[] {
  const out: string[] = [];
  for (let day = from; day < until && out.length < 400; day = nextDay(day)) out.push(day);
  return out;
}

/** Consecutive nights folded into ranges, `to` being the last night. */
function ranges(list: readonly string[]): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const night of list) {
    const last = out[out.length - 1];
    if (last && nextDay(last.to) === night) last.to = night;
    else out.push({ from: night, to: night });
  }
  return out;
}

export function findTripGaps(
  trip: { readonly startDate: string; readonly endDate: string },
  legs: readonly GapLeg[],
): TripGap[] {
  const covered = new Set<string>();
  const gaps: TripGap[] = [];

  for (const leg of [...legs].sort((a, b) => a.arrivalDate.localeCompare(b.arrivalDate))) {
    const legNights = nights(leg.arrivalDate, leg.departureDate);
    legNights.forEach((night) => covered.add(night));
    if (leg.lodgingMode === 'undecided' && legNights.length > 0) {
      for (const range of ranges(legNights)) {
        gaps.push({ kind: 'no_lodging', city: leg.city, ...range });
      }
    }
  }

  const loose = nights(trip.startDate, trip.endDate).filter((night) => !covered.has(night));
  for (const range of ranges(loose)) gaps.push({ kind: 'no_city', ...range });

  return gaps.sort((a, b) => a.from.localeCompare(b.from));
}
