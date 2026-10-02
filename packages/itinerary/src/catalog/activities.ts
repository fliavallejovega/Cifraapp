import { toPlainDate, type PlainDate } from '@app/domain';

import type { Certainty, SourceRef } from '../types.js';

/**
 * What to do at each place, and what has to be booked. Names are proper nouns
 * and stay as they are in every language; descriptions live in the message
 * catalogue. Closing days are restrictions: a museum closed on Mondays is not
 * offered on a Monday.
 */

const checkedOn = toPlainDate('2026-10-02');
const main = (name: string, url: string): SourceRef => ({
  name,
  url,
  checkedOn,
  mainPageOnly: true,
});

export interface Activity {
  readonly id: string;
  readonly placeId: string;
  readonly name: string;
  readonly kind: 'sight' | 'museum' | 'market' | 'nature' | 'cable_car' | 'walk';
  /** Timed entry or a quota: it goes on the purchases list. */
  readonly needsBooking: boolean;
  readonly url?: string;
  /** 0 = Sunday … 6 = Saturday. */
  readonly closedWeekdays?: readonly number[];
  /** Open only within these dates, inclusive. */
  readonly season?: readonly [PlainDate, PlainDate];
  readonly certainty: Certainty;
  readonly source?: SourceRef;
}

export const ACTIVITIES: readonly Activity[] = [
  {
    id: 'san-marco',
    placeId: 'venezia',
    name: 'Basilica di San Marco',
    kind: 'sight',
    needsBooking: true,
    url: 'https://www.basilicasanmarco.it',
    certainty: 'unverified',
    source: main('Basilica di San Marco', 'https://www.basilicasanmarco.it'),
  },
  {
    id: 'palazzo-ducale',
    placeId: 'venezia',
    name: 'Palazzo Ducale',
    kind: 'museum',
    needsBooking: true,
    url: 'https://palazzoducale.visitmuve.it',
    certainty: 'unverified',
    source: main('Fondazione Musei Civici di Venezia', 'https://palazzoducale.visitmuve.it'),
  },
  {
    id: 'rialto',
    placeId: 'venezia',
    name: 'Ponte di Rialto',
    kind: 'walk',
    needsBooking: false,
    certainty: 'estimated',
  },
  {
    id: 'cortina-corso',
    placeId: 'cortina',
    name: 'Corso Italia',
    kind: 'walk',
    needsBooking: false,
    certainty: 'estimated',
  },
  {
    id: 'sass-pordoi',
    placeId: 'canazei',
    name: 'Funivia Sass Pordoi',
    kind: 'cable_car',
    needsBooking: false,
    certainty: 'unverified',
    source: main('Funivia Sass Pordoi', 'https://www.funiviesasspordoi.it'),
  },
  {
    id: 'otzi',
    placeId: 'bolzano',
    name: 'Museo Archeologico dell’Alto Adige (Ötzi)',
    kind: 'museum',
    needsBooking: false,
    url: 'https://www.iceman.it',
    closedWeekdays: [1],
    certainty: 'unverified',
    source: main('Museo Archeologico dell’Alto Adige', 'https://www.iceman.it'),
  },
  {
    id: 'bolzano-market',
    placeId: 'bolzano',
    name: 'Mercatino di Natale (Piazza Walther)',
    kind: 'market',
    needsBooking: false,
    certainty: 'unverified',
  },
  {
    id: 'merano-market',
    placeId: 'merano',
    name: 'Mercatino di Natale di Merano',
    kind: 'market',
    needsBooking: false,
    certainty: 'unverified',
  },
  {
    id: 'weisshorn',
    placeId: 'arosa',
    name: 'Weisshornbahn',
    kind: 'cable_car',
    needsBooking: false,
    certainty: 'unverified',
    source: main('Arosa Bergbahnen', 'https://arosalenzerheide.swiss'),
  },
  {
    id: 'zurich-old-town',
    placeId: 'zurich',
    name: 'Altstadt y Bahnhofstrasse',
    kind: 'walk',
    needsBooking: false,
    certainty: 'estimated',
  },
  {
    id: 'rheinfall-view',
    placeId: 'rheinfall',
    name: 'Schloss Laufen',
    kind: 'nature',
    needsBooking: false,
    certainty: 'unverified',
  },
  {
    id: 'freiburg-muenster',
    placeId: 'freiburg',
    name: 'Freiburger Münster',
    kind: 'sight',
    needsBooking: false,
    certainty: 'estimated',
  },
  {
    id: 'heidelberg-schloss',
    placeId: 'heidelberg',
    name: 'Schloss Heidelberg',
    kind: 'sight',
    needsBooking: false,
    url: 'https://www.schloss-heidelberg.de',
    certainty: 'unverified',
    source: main('Schloss Heidelberg', 'https://www.schloss-heidelberg.de'),
  },
  {
    id: 'ruedesheim-market',
    placeId: 'ruedesheim',
    name: 'Weihnachtsmarkt der Nationen',
    kind: 'market',
    needsBooking: false,
    certainty: 'unverified',
  },
  {
    id: 'koelner-dom',
    placeId: 'koeln',
    name: 'Kölner Dom',
    kind: 'sight',
    needsBooking: false,
    certainty: 'estimated',
  },
  {
    id: 'elphi-plaza',
    placeId: 'hamburg',
    name: 'Elbphilharmonie Plaza',
    kind: 'sight',
    needsBooking: true,
    url: 'https://www.elbphilharmonie.de/en/plaza',
    certainty: 'unverified',
    source: main('Elbphilharmonie', 'https://www.elbphilharmonie.de'),
  },
  {
    id: 'holstentor',
    placeId: 'luebeck',
    name: 'Holstentor',
    kind: 'sight',
    needsBooking: false,
    certainty: 'estimated',
  },
  {
    id: 'tivoli',
    placeId: 'kobenhavn',
    name: 'Jul i Tivoli',
    kind: 'market',
    needsBooking: true,
    url: 'https://www.tivoli.dk',
    certainty: 'unverified',
    source: main('Tivoli', 'https://www.tivoli.dk'),
  },
  {
    id: 'nyhavn',
    placeId: 'kobenhavn',
    name: 'Nyhavn',
    kind: 'walk',
    needsBooking: false,
    certainty: 'estimated',
  },
  {
    id: 'hagia-sophia',
    placeId: 'istanbul',
    name: 'Ayasofya',
    kind: 'sight',
    needsBooking: false,
    certainty: 'estimated',
  },
  {
    id: 'grand-bazaar',
    placeId: 'istanbul',
    name: 'Kapalıçarşı (Gran Bazar)',
    kind: 'market',
    needsBooking: false,
    closedWeekdays: [0],
    certainty: 'unverified',
  },
];

function weekday(date: PlainDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The activities at a place that are open that day, plus the ones that are closed and why. */
export function activitiesOn(
  placeId: string,
  date: PlainDate,
): { open: Activity[]; closed: Activity[] } {
  const open: Activity[] = [];
  const closed: Activity[] = [];
  const wd = weekday(date);
  for (const a of ACTIVITIES) {
    if (a.placeId !== placeId) continue;
    const outOfSeason = a.season ? date < a.season[0] || date > a.season[1] : false;
    if (outOfSeason || a.closedWeekdays?.includes(wd)) closed.push(a);
    else open.push(a);
  }
  return { open, closed };
}

export { weekday };
