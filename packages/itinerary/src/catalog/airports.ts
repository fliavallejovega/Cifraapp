import { toPlainDate } from '@app/domain';

import type { Certainty, SourceRef } from '../types.js';

/**
 * Airports: their city, zone, and how to get between the terminal and the
 * place people sleep. Durations are typical door-to-door minutes outside rush
 * hour; service hours matter for night arrivals («el metro no opera de
 * medianoche a las 6:00»). All of it is `estimated` until someone checks the
 * operator's own page, and the screen says so.
 */

export type TransferMode = 'taxi' | 'metro' | 'bus' | 'boat' | 'private';

export interface TransferOption {
  readonly mode: TransferMode;
  readonly minutes: number;
  /** Local `HH:MM`–`HH:MM` when the service runs; absent means always. */
  readonly serviceHours?: readonly [string, string];
  /** Extra minutes at rush hour (07:00–09:30 and 17:00–19:30 local). */
  readonly rushExtraMinutes?: number;
  readonly certainty: Certainty;
  readonly source: SourceRef;
}

export interface Airport {
  readonly iata: string;
  readonly name: string;
  readonly cityPlaceId: string;
  readonly country: string;
  readonly timeZone: string;
  readonly transfers: readonly TransferOption[];
}

const checkedOn = toPlainDate('2026-10-02');
const src = (name: string, url: string): SourceRef => ({
  name,
  url,
  checkedOn,
  mainPageOnly: true,
});

export const AIRPORTS: ReadonlyMap<string, Airport> = new Map(
  (
    [
      {
        iata: 'PTY',
        name: 'Aeropuerto Internacional de Tocumen',
        cityPlaceId: 'panama',
        country: 'PA',
        timeZone: 'America/Panama',
        transfers: [
          {
            mode: 'taxi',
            minutes: 35,
            rushExtraMinutes: 30,
            certainty: 'estimated',
            source: src('Aeropuerto de Tocumen', 'https://www.tocumenpanama.aero'),
          },
        ],
      },
      {
        iata: 'IST',
        name: 'Aeropuerto de Estambul',
        cityPlaceId: 'istanbul',
        country: 'TR',
        timeZone: 'Europe/Istanbul',
        transfers: [
          {
            mode: 'taxi',
            minutes: 60,
            rushExtraMinutes: 30,
            certainty: 'estimated',
            source: src('Istanbul Airport', 'https://www.istairport.com/en/transportation'),
          },
          {
            mode: 'metro',
            minutes: 80,
            serviceHours: ['06:00', '00:00'],
            certainty: 'estimated',
            source: src('Metro Istanbul (M11)', 'https://www.metro.istanbul/en'),
          },
          {
            mode: 'bus',
            minutes: 90,
            certainty: 'estimated',
            source: src('Havaist', 'https://hava.ist'),
          },
        ],
      },
      {
        iata: 'VCE',
        name: 'Aeropuerto Marco Polo de Venecia',
        cityPlaceId: 'venezia',
        country: 'IT',
        timeZone: 'Europe/Rome',
        transfers: [
          {
            mode: 'bus',
            minutes: 25,
            serviceHours: ['05:00', '01:00'],
            certainty: 'estimated',
            source: src('ATVO / ACTV', 'https://www.veneziaairport.it/en/getting-to-and-from/'),
          },
          {
            mode: 'boat',
            minutes: 75,
            serviceHours: ['06:00', '23:59'],
            certainty: 'estimated',
            source: src('Alilaguna', 'https://www.alilaguna.it/en/'),
          },
          {
            mode: 'private',
            minutes: 30,
            certainty: 'estimated',
            source: src('Taxi acuático (Consorzio Motoscafi)', 'https://www.motoscafivenezia.it'),
          },
        ],
      },
      {
        iata: 'CPH',
        name: 'Aeropuerto de Copenhague (Kastrup)',
        cityPlaceId: 'kobenhavn',
        country: 'DK',
        timeZone: 'Europe/Copenhagen',
        transfers: [
          {
            mode: 'metro',
            minutes: 15,
            certainty: 'estimated',
            source: src('Metro de Copenhague (M2)', 'https://intl.m.dk'),
          },
          {
            mode: 'taxi',
            minutes: 20,
            rushExtraMinutes: 15,
            certainty: 'estimated',
            source: src('Copenhagen Airport', 'https://www.cph.dk/en/parking-transport'),
          },
        ],
      },
    ] satisfies Airport[]
  ).map((a) => [a.iata, a]),
);

/**
 * Typical block times, gate to gate, used only to estimate a connection the
 * ticket does not print. Always `estimated`; the person is asked for the exact
 * time from «Itinerary details».
 */
export const TYPICAL_BLOCK_MINUTES: Readonly<Record<string, number>> = {
  'PTY-IST': 760,
  'IST-PTY': 820,
  'IST-VCE': 155,
  'VCE-IST': 145,
  'CPH-IST': 205,
  'IST-CPH': 215,
};

/** Arrive this long before an international departure. */
export const INTERNATIONAL_CHECKIN_MINUTES = 180;
/** Immigration and bags after a flight that crosses a border. */
export const ENTRY_MINUTES = 45;
/** Leaving a connection airport for a night in the city. */
export const LAYOVER_EXIT_MINUTES = 40;
/** A connection longer than this is worth a plan of its own. */
export const LONG_LAYOVER_MINUTES = 6 * 60;
