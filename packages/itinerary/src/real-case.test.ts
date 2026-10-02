import { toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { composeGround } from './compose.js';
import { buildItinerary, drivesMinutes, presenceOf } from './days.js';
import { evaluateEntry, type BorderSystem, type EntryRule } from './entry.js';
import { AIRPORTS } from './catalog/airports.js';
import { flightStays } from './flights.js';
import {
  REAL_CASE_TRAVELERS,
  realCaseComposeInput,
  realCaseFlights,
  realCasePlace,
  realCaseRoutes,
} from './fixtures/real-case.js';

const d = toPlainDate;

function realCase() {
  const composition = composeGround(realCaseComposeInput());
  const flights = realCaseFlights();
  const stays = flightStays(flights, { groundStart: d('2026-12-12'), groundEnd: d('2026-12-23') });
  const itinerary = buildItinerary({
    start: d('2026-12-09'),
    end: d('2026-12-27'),
    flights,
    flightStays: stays,
    composition,
    place: realCasePlace,
    routes: realCaseRoutes,
  });
  return { composition, flights, itinerary };
}

describe('the Venice → Copenhagen trip comes out on its own', () => {
  it('has 19 days and 17 nights with lodging', () => {
    const { itinerary } = realCase();
    expect(itinerary.totals.days).toBe(19);
    expect(itinerary.totals.lodgingNights).toBe(17);
    expect(itinerary.notices.filter((n) => n.code === 'night_without_lodging')).toEqual([]);
  });

  it('sleeps where the plan says, night by night', () => {
    const { itinerary } = realCase();
    const beds = Object.fromEntries(
      itinerary.days.map((day) => [day.date.slice(8), day.sleep?.placeId ?? null]),
    );
    expect(beds).toEqual({
      '09': null,
      '10': 'istanbul',
      '11': 'venezia',
      '12': 'cortina',
      '13': 'canazei',
      '14': 'bolzano',
      '15': 'arosa',
      '16': 'arosa',
      '17': 'hinterzarten',
      '18': 'hinterzarten',
      '19': 'hinterzarten',
      '20': 'ruedesheim',
      '21': 'koeln',
      '22': 'hamburg',
      '23': 'kobenhavn',
      '24': 'kobenhavn',
      '25': 'kobenhavn',
      '26': 'istanbul',
      '27': null,
    });
  });

  it('follows the route through the passes, the Arlberg, the Black Forest and the ferry', () => {
    const { itinerary } = realCase();
    const points = itinerary.days.flatMap((day) => day.drives.flatMap((dr) => dr.points));
    const order = [
      'venezia',
      'cortina',
      'falzarego',
      'pordoi',
      'canazei',
      'sella',
      'ortisei',
      'bolzano',
      'merano',
      'reschen',
      'stanton',
      'chur',
      'arosa',
      'zurich',
      'rheinfall',
      'hinterzarten',
      'ravenna',
      'freiburg',
      'heidelberg',
      'ruedesheim',
      'koeln',
      'hamburg',
      'luebeck',
      'puttgarden',
      'roedby',
      'kastrup',
    ];
    let at = -1;
    for (const p of order) {
      const next = points.indexOf(p, at);
      expect(next, p).toBeGreaterThanOrEqual(at);
      at = next;
    }
    const ferry = itinerary.days
      .flatMap((day) => day.drives.flatMap((dr) => dr.legs))
      .filter((l) => l.mode === 'ferry');
    expect(ferry).toHaveLength(1);
  });

  // The hand-made plan said «unos 2,500 km y ~37 h». The router measures
  // 2,165 km; with winter added the wheel time is 35.5 h. The engine's
  // figures are the ones the product shows.
  it('drives on 10 days, about 2,165 km and 35–37 hours at the wheel with winter', () => {
    const { itinerary } = realCase();
    const t = itinerary.totals;
    expect(t.drivingDays).toBe(10);
    expect(
      itinerary.days.filter((day) => day.drivingMinutes > 0).map((day) => day.date.slice(8)),
    ).toEqual(['12', '13', '14', '15', '17', '19', '20', '21', '22', '23']);
    // The router's distance, which winter does not change.
    expect(Math.round(t.distanceM / 1000)).toBeGreaterThan(2100);
    expect(Math.round(t.distanceM / 1000)).toBeLessThan(2200);
    expect(t.drivingMinutes).toBeGreaterThanOrEqual(35 * 60);
    expect(t.drivingMinutes).toBeLessThanOrEqual(37 * 60);
    expect(t.routerMinutes).toBeLessThan(t.drivingMinutes);
  });

  it('warns about the long Alpine day and the passes that may close', () => {
    const { itinerary } = realCase();
    const day15 = itinerary.days.find((day) => day.date === d('2026-12-15'));
    expect(day15?.notices.map((n) => n.code)).toEqual(
      expect.arrayContaining(['over_driving_budget', 'mountain_after_dark', 'border_day']),
    );
    const day13 = itinerary.days.find((day) => day.date === d('2026-12-13'));
    expect(day13?.notices.filter((n) => n.code === 'pass_may_close')).toHaveLength(2);
    const day23 = itinerary.days.find((day) => day.date === d('2026-12-23'));
    expect(day23?.notices.map((n) => n.code)).toContain('ferry_book');
    expect(itinerary.notices.map((n) => n.code)).not.toContain('car_return_on_holiday');
  });

  it('explains what the Dolomites cost', () => {
    const { composition } = realCase();
    expect(composition.wishes).toEqual([
      { wishId: 'w-dolomitas', corridorId: 'venezia-arosa-dolomitas' },
    ]);
    expect(composition.sacrifices).toEqual(
      expect.arrayContaining([
        { kind: 'place_removed', placeId: 'verona' },
        { kind: 'place_removed', placeId: 'como' },
        { kind: 'place_removed', placeId: 'maloja' },
        { kind: 'place_removed', placeId: 'julier' },
        { kind: 'nights_removed', placeId: 'arosa', nights: 1 },
      ]),
    );
    expect(composition.sacrifices).toHaveLength(5);
    const withWish = drivesMinutes(composition.drives, realCaseRoutes);
    const without = drivesMinutes(composition.baselineDrives, realCaseRoutes);
    expect(withWish).not.toBeNull();
    expect(without).not.toBeNull();
  });

  it('without the wish, keeps the lakes and three nights in Arosa', () => {
    const composition = composeGround(realCaseComposeInput([]));
    expect(composition.stays.map((s) => [s.placeId, s.firstNight.slice(8), s.nights])).toEqual([
      ['verona', '12', 1],
      ['como', '13', 1],
      ['arosa', '14', 3],
      ['hinterzarten', '17', 3],
      ['ruedesheim', '20', 1],
      ['koeln', '21', 1],
      ['hamburg', '22', 1],
    ]);
    expect(composition.sacrifices).toEqual([]);
  });
});

describe('flight days', () => {
  it('has five flight days, «En su boleto» only on the four printed times', () => {
    const { itinerary } = realCase();
    const flightDays = itinerary.days.filter((day) => day.kind === 'flight');
    expect(flightDays.map((day) => day.date.slice(8))).toEqual(['09', '10', '11', '26', '27']);
    const confirmed = itinerary.days
      .flatMap((day) => day.flights.flatMap((f) => f.entries))
      .filter((e) => e.certainty === 'confirmed')
      .map((e) => `${e.airport} ${e.step} ${e.at.date.slice(8)} ${e.at.time}`);
    expect(confirmed).toEqual([
      'PTY departs 09 22:00',
      'VCE arrives 11 13:50',
      'CPH departs 26 10:35',
      'PTY arrives 27 17:10',
    ]);
  });

  it('shows local time and the zone difference on arrival', () => {
    const { itinerary } = realCase();
    const arrival = itinerary.days
      .flatMap((day) => day.flights.flatMap((f) => f.entries))
      .find((e) => e.step === 'arrives' && e.airport === 'IST');
    expect(arrival?.at.timeZone).toBe('Europe/Istanbul');
    expect(arrival?.zoneDifferenceMinutes).toBe(8 * 60);
  });

  it('keeps a transfer warning on the day it happens', () => {
    const { itinerary } = realCase();
    const rush = itinerary.days.filter((day) =>
      day.notices.some((n) => n.code === 'transfer_rush_hour' && n.params?.['airport'] === 'PTY'),
    );
    // Leaving at 17:55 on the 9th and landing at 17:10 on the 27th: both at rush hour, never the 10th.
    expect(rush.map((day) => day.date.slice(8))).toEqual(['09', '27']);
  });

  it('plans the Istanbul connections as nights in the city', () => {
    const { itinerary } = realCase();
    const layovers = itinerary.days.flatMap((day) => day.layovers);
    expect(layovers).toHaveLength(2);
    expect(layovers.every((l) => l.overnight && l.options.includes('hotel'))).toBe(true);
  });
});

describe('entry requirements', () => {
  const checkedOn = d('2026-10-02');
  const src = { name: 'test', url: 'https://example.org', checkedOn };
  const rule = (passportCountry: string, zone: string): EntryRule => ({
    passportCountry,
    zone,
    status: 'visa_free',
    maxStayDays: 90,
    windowDays: 180,
    conditions:
      zone === 'schengen' ? { passportValidMonthsAfterExit: 3, passportIssuedWithinYears: 10 } : {},
    source: src,
    validFrom: null,
    validTo: null,
  });
  const systems: BorderSystem[] = [
    { id: 'ees', zone: 'schengen', startsOn: d('2025-10-12'), exempt: [], source: src },
    { id: 'etias', zone: 'schengen', startsOn: null, exempt: [], source: src },
  ];

  it('needs no visa for Türkiye or Schengen, with 16 of 90 Schengen days used', () => {
    const { itinerary } = realCase();
    const presence = presenceOf(
      itinerary,
      realCasePlace,
      (iata) => AIRPORTS.get(iata)?.country ?? null,
    );
    const verdicts = evaluateEntry({
      travelers: REAL_CASE_TRAVELERS,
      presence,
      rules: [rule('CO', 'schengen'), rule('PA', 'schengen'), rule('CO', 'TR'), rule('PA', 'TR')],
      systems,
      today: checkedOn,
    });
    expect(verdicts).toHaveLength(4);
    expect(verdicts.every((v) => v.status === 'visa_free' && !v.exceeds)).toBe(true);
    const schengen = verdicts.filter((v) => v.zone === 'schengen');
    expect(schengen.map((v) => v.daysUsed)).toEqual([16, 16]);
    expect(schengen[0]?.systems).toEqual(['ees']);
    expect(schengen[0]?.notices.map((n) => n.code)).toContain('etias_not_started');
  });

  it('turns a rule older than 30 days into «por verificar»', () => {
    const { itinerary } = realCase();
    const presence = presenceOf(
      itinerary,
      realCasePlace,
      (iata) => AIRPORTS.get(iata)?.country ?? null,
    );
    const verdicts = evaluateEntry({
      travelers: REAL_CASE_TRAVELERS.slice(0, 1),
      presence,
      rules: [rule('CO', 'schengen'), rule('CO', 'TR')],
      systems,
      today: d('2026-11-15'),
    });
    expect(verdicts.every((v) => v.certainty === 'unverified')).toBe(true);
  });
});
