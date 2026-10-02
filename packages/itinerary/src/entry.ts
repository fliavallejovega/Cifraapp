import { addDays, daysBetween, type PlainDate } from '@app/domain';

import type { Certainty, CountryCode, Notice, SourceRef, Traveler } from './types.js';

/**
 * Entry requirements: for each traveller and each zone the trip enters, does
 * the person need a visa, for how long can they stay, and what else the
 * border may ask for.
 *
 * Rules are data with a source and a lookup date, never constants in code.
 * Schengen is one zone — Switzerland is in it without being in the EU — and
 * its 90 days in any 180 are counted with the trip's real days. A person with
 * more than one passport gets the most favourable rule, with a reminder to
 * present that passport at the border.
 *
 * Nothing here is legal advice; the screen says so and links the source.
 */

export type EntryStatus = 'visa_free' | 'evisa' | 'eta' | 'visa_required' | 'unknown';

export interface EntryRule {
  readonly passportCountry: CountryCode;
  readonly zone: string;
  readonly status: EntryStatus;
  readonly maxStayDays: number | null;
  readonly windowDays: number | null;
  /** Passport validity and anything else the rule states. */
  readonly conditions: {
    readonly passportValidMonthsAfterExit?: number;
    readonly passportValidDaysAfterExit?: number;
    readonly passportIssuedWithinYears?: number;
    readonly mayAsk?: readonly ('onward_ticket' | 'lodging_proof' | 'funds' | 'insurance')[];
  };
  readonly source: SourceRef;
  readonly validFrom: PlainDate | null;
  readonly validTo: PlainDate | null;
}

/** A system that starts on a date someone may move: EES, ETIAS. */
export interface BorderSystem {
  readonly id: 'ees' | 'etias';
  readonly zone: string;
  /** Null while it has no confirmed start. Editable, so a change reaches every trip. */
  readonly startsOn: PlainDate | null;
  /** Nationalities it does not apply to (EU citizens, residents…). */
  readonly exempt: readonly CountryCode[];
  readonly source: SourceRef;
}

export const SCHENGEN: ReadonlySet<CountryCode> = new Set([
  'AT',
  'BE',
  'BG',
  'CH',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IS',
  'IT',
  'LI',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
]);

export function zoneOf(country: CountryCode): string {
  return SCHENGEN.has(country) ? 'schengen' : country;
}

/** A day and the countries the travellers set foot in on it. */
export interface PresenceDay {
  readonly date: PlainDate;
  readonly countries: readonly CountryCode[];
}

/** Calendar days spent in each zone. Arrival and departure days both count. */
export function daysByZone(presence: readonly PresenceDay[]): Map<string, PlainDate[]> {
  const out = new Map<string, PlainDate[]>();
  for (const day of presence) {
    for (const zone of new Set(day.countries.map(zoneOf))) {
      const list = out.get(zone) ?? [];
      list.push(day.date);
      out.set(zone, list);
    }
  }
  return out;
}

/**
 * The largest number of days in any window of `windowDays` ending on one of
 * the trip's days, counting earlier stays the person reports.
 */
export function maxDaysInWindow(days: readonly PlainDate[], windowDays: number): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  for (const end of sorted) {
    const from = addDays(end, -(windowDays - 1));
    const n = sorted.filter((d) => d >= from && d <= end).length;
    if (n > best) best = n;
  }
  return best;
}

export interface EntryVerdict {
  readonly travelerId: string;
  readonly zone: string;
  readonly status: EntryStatus;
  /** The passport that gives this verdict. */
  readonly passport: CountryCode | null;
  readonly daysUsed: number;
  readonly maxStayDays: number | null;
  readonly windowDays: number | null;
  readonly exceeds: boolean;
  readonly certainty: Certainty;
  readonly rule: EntryRule | null;
  readonly systems: readonly BorderSystem['id'][];
  readonly notices: readonly Notice[];
}

const RANK: Readonly<Record<EntryStatus, number>> = {
  visa_free: 0,
  eta: 1,
  evisa: 2,
  visa_required: 3,
  unknown: 4,
};

/** Rules older than this read as «por verificar». */
export const RULE_FRESH_DAYS = 30;

export interface EntryInput {
  readonly travelers: readonly Traveler[];
  readonly presence: readonly PresenceDay[];
  readonly rules: readonly EntryRule[];
  readonly systems: readonly BorderSystem[];
  /** The day the screen is read, to age the rules. */
  readonly today: PlainDate;
  /** Days already spent in a zone in the last window, per traveller. */
  readonly priorDays?: Readonly<Record<string, Readonly<Record<string, readonly PlainDate[]>>>>;
}

export function evaluateEntry(input: EntryInput): EntryVerdict[] {
  const zones = daysByZone(input.presence);
  const firstDay = input.presence[0]?.date;
  const verdicts: EntryVerdict[] = [];

  for (const t of input.travelers) {
    for (const [zone, days] of zones) {
      if (t.residence && zoneOf(t.residence) === zone) continue;
      const tripStart = days[0] ?? firstDay;
      const candidates = t.nationalities
        .map((n) => {
          if (zoneOf(n) === zone)
            return { passport: n, rule: null as EntryRule | null, home: true };
          const rule =
            input.rules.find(
              (r) =>
                r.passportCountry === n &&
                r.zone === zone &&
                (r.validFrom === null || (tripStart !== undefined && r.validFrom <= tripStart)) &&
                (r.validTo === null || (tripStart !== undefined && r.validTo >= tripStart)),
            ) ?? null;
          return { passport: n, rule, home: false };
        })
        .sort((a, b) => {
          if (a.home !== b.home) return a.home ? -1 : 1;
          return RANK[a.rule?.status ?? 'unknown'] - RANK[b.rule?.status ?? 'unknown'];
        });
      const best = candidates[0];
      if (best?.home) continue; // Own country: nothing to check.

      const rule = best?.rule ?? null;
      const prior = input.priorDays?.[t.id]?.[zone] ?? [];
      const windowDays = rule?.windowDays ?? null;
      const daysUsed = windowDays ? maxDaysInWindow([...prior, ...days], windowDays) : days.length;
      const exceeds = rule?.maxStayDays != null && daysUsed > rule.maxStayDays;
      const stale = rule ? daysBetween(rule.source.checkedOn, input.today) > RULE_FRESH_DAYS : true;
      const notices: Notice[] = [];
      if (exceeds) {
        notices.push({
          code: 'stay_exceeds_limit',
          severity: 'critical',
          params: { zone, days: daysUsed, max: rule?.maxStayDays ?? 0 },
        });
      }
      if (t.nationalities.length > 1 && best?.passport) {
        notices.push({
          code: 'present_passport',
          severity: 'info',
          params: { zone, passport: best.passport },
        });
      }
      const c = rule?.conditions;
      const lastDay = days[days.length - 1];
      if (c?.passportValidMonthsAfterExit && lastDay) {
        notices.push({
          code: 'passport_valid_months',
          severity: 'info',
          params: { zone, months: c.passportValidMonthsAfterExit, exit: lastDay },
        });
      }
      if (c?.passportValidDaysAfterExit && lastDay) {
        notices.push({
          code: 'passport_valid_days',
          severity: 'info',
          params: {
            zone,
            days: c.passportValidDaysAfterExit,
            until: addDays(lastDay, c.passportValidDaysAfterExit),
          },
        });
      }
      if (c?.passportIssuedWithinYears) {
        notices.push({
          code: 'passport_issued_within',
          severity: 'info',
          params: { zone, years: c.passportIssuedWithinYears },
        });
      }
      if (c?.mayAsk && c.mayAsk.length > 0) {
        notices.push({
          code: 'border_may_ask',
          severity: 'info',
          params: { zone, items: c.mayAsk.join(',') },
        });
      }

      const systems = input.systems
        .filter(
          (s) =>
            s.zone === zone &&
            s.startsOn !== null &&
            tripStart !== undefined &&
            s.startsOn <= tripStart &&
            !t.nationalities.some((n) => s.exempt.includes(n)),
        )
        .map((s) => s.id);
      for (const s of input.systems) {
        if (s.zone === zone && s.startsOn === null) {
          notices.push({ code: `${s.id}_not_started`, severity: 'info', params: { zone } });
        }
      }

      verdicts.push({
        travelerId: t.id,
        zone,
        status: rule?.status ?? 'unknown',
        passport: best?.passport ?? null,
        daysUsed,
        maxStayDays: rule?.maxStayDays ?? null,
        windowDays,
        exceeds,
        certainty: !rule ? 'unverified' : stale ? 'unverified' : 'confirmed',
        rule,
        systems,
        notices,
      });
    }
  }
  return verdicts;
}
