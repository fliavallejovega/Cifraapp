import { Money, toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { composeGround } from './compose.js';
import { buildItinerary } from './days.js';
import { flightStays } from './flights.js';
import {
  REAL_CASE_ANCHORS,
  realCaseComposeInput,
  realCaseFlights,
  realCasePlace,
  realCaseRoutes,
} from './fixtures/real-case.js';
import {
  airbnbListing,
  airbnbPhotos,
  airbnbSearch,
  bookingSearch,
  googleMapsDirections,
  stayDates,
} from './links.js';
import { lodgingNotices, lodgingTotals, summarizeStop, type LodgingStop } from './lodging.js';
import { generateTodos } from './todos.js';

const d = toPlainDate;

function realCaseTodos() {
  const composition = composeGround(realCaseComposeInput());
  const flights = realCaseFlights();
  const itinerary = buildItinerary({
    start: d('2026-12-09'),
    end: d('2026-12-27'),
    flights,
    flightStays: flightStays(flights, { groundStart: d('2026-12-12'), groundEnd: d('2026-12-23') }),
    composition,
    place: realCasePlace,
    routes: realCaseRoutes,
  });
  return generateTodos({ itinerary, flights, anchors: REAL_CASE_ANCHORS, place: realCasePlace });
}

describe('purchases list for the reference trip', () => {
  it('has both vignettes, the ferry, the market tickets with their sale date and the dawn transfer', () => {
    const todos = realCaseTodos();
    const keys = todos.map((t) => t.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'charge:at-vignette-10d',
        'charge:ch-vignette-year',
        'charge:at-arlberg-tunnel',
        'charge:scandlines-puttgarden-rodby',
        'event:ravenna:2026-12-19',
        'car:rental',
        'car:winter-kit',
        'dinner:2026-12-24',
      ]),
    );
    const market = todos.find((t) => t.kind === 'event_tickets');
    expect(market?.saleOpensOn).toBe('2026-10-14');
    expect(market?.certainty).toBe('confirmed');
    expect(market?.url).toBe('https://www.hochschwarzwald.de/weihnachtsmarkt-ravennaschlucht');

    const dawn = todos.filter((t) => t.kind === 'private_transfer');
    expect(dawn.map((t) => [t.params['date'], t.params['airport']])).toContainEqual([
      '2026-12-27',
      'IST',
    ]);
    const swiss = todos.find((t) => t.key === 'charge:ch-vignette-year');
    expect(swiss?.dueOn).toBe('2026-12-14');
  });

  it('keeps keys stable, so a bought item stays bought after recomposing', () => {
    expect(realCaseTodos().map((t) => t.key)).toEqual(realCaseTodos().map((t) => t.key));
  });
});

describe('lodging', () => {
  const usd = (v: string) => Money.fromDecimalString(v, 'USD');
  const stop = (over: Partial<LodgingStop>): LodgingStop => ({
    legId: 'l',
    placeId: 'cortina',
    placeName: "Cortina d'Ampezzo",
    firstNight: d('2026-12-12'),
    nights: 1,
    hosted: false,
    paid: false,
    myPrice: null,
    options: [
      {
        id: 'a',
        provider: 'airbnb',
        name: 'Chalet',
        kind: 'Casa',
        rating: '4.9',
        reviews: 120,
        total: usd('180'),
        recommended: true,
        certainty: 'unverified',
      },
      {
        id: 'b',
        provider: 'airbnb',
        name: 'Studio',
        kind: 'Apto',
        rating: '4.6',
        reviews: 40,
        total: usd('140'),
        recommended: false,
        certainty: 'unverified',
      },
      {
        id: 'c',
        provider: 'booking',
        name: 'Hotel Ancora',
        kind: null,
        rating: null,
        reviews: null,
        total: usd('210'),
        recommended: false,
        certainty: 'unverified',
      },
    ],
    ...over,
  });

  it('orders Airbnb by price and recomputes «Mi plan» when the person types a price', () => {
    const before = [
      summarizeStop(stop({})),
      summarizeStop(stop({ legId: 'h', placeId: 'arosa', hosted: true })),
    ];
    expect(before[0]?.airbnb.map((o) => o.id)).toEqual(['b', 'a']);
    const t1 = lodgingTotals(before, 'USD');
    expect(t1.myPlan.toDecimalString()).toBe('180.0000');
    expect(t1.cheapest.toDecimalString()).toBe('140.0000');
    expect(t1.stopsToPrice).toBe(1);

    const after = [summarizeStop(stop({ myPrice: usd('150') }))];
    const t2 = lodgingTotals(after, 'USD');
    expect(t2.myPlan.toDecimalString()).toBe('150.0000');
    expect(t2.stopsWithMyPrice).toBe(1);
  });

  it('says when nothing fits under $100 a night, with the nearby towns', () => {
    const notices = lodgingNotices([summarizeStop(stop({}))], usd('100'));
    expect(notices[0]?.code).toBe('lodging_over_cap');
    expect(notices[0]?.params?.['nearby']).toContain('San Vito di Cadore');
  });
});

describe('links', () => {
  const dates = stayDates(d('2026-12-15'), 2, 2);
  it('fills dates and party size', () => {
    expect(
      airbnbSearch({ name: 'Arosa' }, 'Switzerland', dates, { priceMax: 100, currency: 'USD' }),
    ).toBe(
      'https://www.airbnb.com/s/Arosa--Switzerland/homes?checkin=2026-12-15&checkout=2026-12-17&adults=2&price_max=100&currency=USD',
    );
    expect(airbnbListing('123', dates)).toBe(
      'https://www.airbnb.com/rooms/123?check_in=2026-12-15&check_out=2026-12-17&adults=2',
    );
    expect(airbnbPhotos('123', dates)).toMatch(/&modal=PHOTO_TOUR_SCROLLABLE$/);
    expect(bookingSearch('Hotel Ancora', dates)).toContain('group_adults=2&no_rooms=1');
  });

  it('builds a day of directions with waypoints', () => {
    const url = googleMapsDirections([
      realCasePlace('bolzano'),
      realCasePlace('reschen'),
      realCasePlace('arosa'),
    ]);
    expect(url).toContain('waypoints=46.8524%2C10.5108');
  });
});
