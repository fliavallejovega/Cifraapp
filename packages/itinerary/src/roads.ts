import { toPlainDate, type PlainDate } from '@app/domain';

import type { Certainty, CountryCode, SourceRef } from './types.js';

/**
 * Winter driving rules, mountain passes and road charges, by country. These
 * are restrictions the planner obeys, not footnotes: a pass that may close
 * gets a valley alternative, and a country that charges for its motorways adds
 * a purchase to the to-do list with its deadline.
 *
 * Every figure here expires. Each carries its source and the day it was read;
 * anything not read on the operator's own page is `unverified`.
 */

const checkedOn = toPlainDate('2026-10-02');
const source = (name: string, url: string, mainPageOnly = true): SourceRef => ({
  name,
  url,
  checkedOn,
  mainPageOnly,
});

// ---------------------------------------------------------------------------
// Winter equipment
// ---------------------------------------------------------------------------

export type WinterRuleKind =
  'chains_or_winter_tyres' | 'winter_tyres_in_conditions' | 'no_specific_law';

export interface WinterRule {
  readonly country: CountryCode;
  readonly kind: WinterRuleKind;
  /** `MM-DD` inclusive window when the rule applies, if seasonal. */
  readonly season?: readonly [string, string];
  readonly certainty: Certainty;
  readonly source: SourceRef;
}

export const WINTER_RULES: ReadonlyMap<CountryCode, WinterRule> = new Map(
  (
    [
      {
        country: 'IT',
        kind: 'chains_or_winter_tyres',
        season: ['11-15', '04-15'],
        certainty: 'unverified',
        source: source('Ministero delle Infrastrutture e dei Trasporti', 'https://www.mit.gov.it'),
      },
      {
        country: 'AT',
        kind: 'winter_tyres_in_conditions',
        season: ['11-01', '04-15'],
        certainty: 'unverified',
        source: source('oesterreich.gv.at — Winterausrüstung', 'https://www.oesterreich.gv.at'),
      },
      {
        country: 'CH',
        kind: 'no_specific_law',
        certainty: 'unverified',
        source: source('TCS — Touring Club Schweiz', 'https://www.tcs.ch'),
      },
      {
        country: 'DE',
        kind: 'winter_tyres_in_conditions',
        certainty: 'unverified',
        source: source('ADAC — Winterreifenpflicht', 'https://www.adac.de'),
      },
      {
        country: 'DK',
        kind: 'no_specific_law',
        certainty: 'unverified',
        source: source('FDM', 'https://fdm.dk'),
      },
    ] satisfies WinterRule[]
  ).map((r) => [r.country, r]),
);

function inSeason(date: PlainDate, season: readonly [string, string]): boolean {
  const md = date.slice(5);
  const [from, to] = season;
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

/** The winter rule that binds on that day, if any. */
export function winterRuleOn(country: CountryCode, date: PlainDate): WinterRule | null {
  const rule = WINTER_RULES.get(country);
  if (!rule) return null;
  if (rule.season && !inSeason(date, rule.season)) return null;
  return rule;
}

// ---------------------------------------------------------------------------
// Mountain passes
// ---------------------------------------------------------------------------

export type PassWinterStatus = 'open_all_year' | 'may_close' | 'closed_in_winter';

export interface PassInfo {
  readonly placeId: string;
  readonly status: PassWinterStatus;
  /** Message key of the valley route to take if it closes. */
  readonly alternative?: string;
  readonly certainty: Certainty;
  readonly source: SourceRef;
}

const SOUTH_TYROL = source('Viabilità Alto Adige', 'https://www.provinz.bz.it/verkehr');
const VENETO = source('Veneto Strade — viabilità', 'https://www.venetostrade.it');
const ASTRA = source('ASTRA — estado de los pasos', 'https://www.astra.admin.ch');

export const PASSES: ReadonlyMap<string, PassInfo> = new Map(
  (
    [
      {
        placeId: 'falzarego',
        status: 'may_close',
        alternative: 'via_pusteria',
        certainty: 'unverified',
        source: VENETO,
      },
      {
        placeId: 'pordoi',
        status: 'may_close',
        alternative: 'via_pusteria',
        certainty: 'unverified',
        source: SOUTH_TYROL,
      },
      {
        placeId: 'sella',
        status: 'may_close',
        alternative: 'via_fassa_bolzano',
        certainty: 'unverified',
        source: SOUTH_TYROL,
      },
      { placeId: 'reschen', status: 'open_all_year', certainty: 'unverified', source: SOUTH_TYROL },
      { placeId: 'maloja', status: 'open_all_year', certainty: 'unverified', source: ASTRA },
      {
        placeId: 'julier',
        status: 'open_all_year',
        alternative: 'via_albula_tunnel',
        certainty: 'unverified',
        source: ASTRA,
      },
    ] satisfies PassInfo[]
  ).map((p) => [p.placeId, p]),
);

// ---------------------------------------------------------------------------
// Vignettes and tolls
// ---------------------------------------------------------------------------

export type RoadChargeKind = 'vignette' | 'tunnel_toll' | 'distance_toll' | 'ferry';

export interface RoadCharge {
  readonly id: string;
  readonly country: CountryCode;
  readonly kind: RoadChargeKind;
  /** Decimal string in `currency`, or null when it depends on the trip (distance, vehicle). */
  readonly price: string | null;
  readonly currency: string;
  /** Days of validity for a vignette. */
  readonly validDays?: number;
  /** Buy before entering the country. */
  readonly buyBeforeEntry: boolean;
  readonly bookingUrl: string;
  readonly certainty: Certainty;
  readonly source: SourceRef;
}

const ASFINAG = source('ASFINAG — Vignette', 'https://shop.asfinag.at');
const ARLBERG = source(
  'ASFINAG — Arlberg Straßentunnel',
  'https://www.asfinag.at/maut-vignette/streckenmaut/',
);
const EVIGNETTE = source('Confederación Suiza — e-vignette', 'https://via.admin.ch/shop');
const AUTOSTRADE = source('Autostrade per l’Italia', 'https://www.autostrade.it');
const SCANDLINES = source('Scandlines', 'https://www.scandlines.com');

export const ROAD_CHARGES: readonly RoadCharge[] = [
  {
    id: 'at-vignette-10d',
    country: 'AT',
    kind: 'vignette',
    price: '12.8000',
    currency: 'EUR',
    validDays: 10,
    buyBeforeEntry: true,
    bookingUrl: 'https://shop.asfinag.at/',
    certainty: 'unverified',
    source: ASFINAG,
  },
  {
    id: 'at-arlberg-tunnel',
    country: 'AT',
    kind: 'tunnel_toll',
    price: '12.5000',
    currency: 'EUR',
    buyBeforeEntry: false,
    bookingUrl: 'https://shop.asfinag.at/',
    certainty: 'unverified',
    source: ARLBERG,
  },
  {
    id: 'ch-vignette-year',
    country: 'CH',
    kind: 'vignette',
    price: '40.0000',
    currency: 'CHF',
    validDays: 425,
    buyBeforeEntry: true,
    bookingUrl: 'https://via.admin.ch/shop/dashboard',
    certainty: 'unverified',
    source: EVIGNETTE,
  },
  {
    id: 'it-motorway',
    country: 'IT',
    kind: 'distance_toll',
    price: null,
    currency: 'EUR',
    buyBeforeEntry: false,
    bookingUrl: 'https://www.autostrade.it/it/viaggiare/pedaggi',
    certainty: 'estimated',
    source: AUTOSTRADE,
  },
  {
    id: 'scandlines-puttgarden-rodby',
    country: 'DK',
    kind: 'ferry',
    price: null,
    currency: 'EUR',
    buyBeforeEntry: true,
    bookingUrl: 'https://www.scandlines.com/',
    certainty: 'unverified',
    source: SCANDLINES,
  },
];

/** Places whose crossing triggers a tunnel toll. */
const TUNNEL_TOLL_AT: Readonly<Record<string, string>> = { stanton: 'at-arlberg-tunnel' };

export interface ChargeNeed {
  readonly charge: RoadCharge;
  /** First day it is needed; the purchase must happen before this. */
  readonly firstUse: PlainDate;
}

/**
 * The charges a set of drives incurs: a vignette per country entered, a tunnel
 * toll per tunnel crossed, a ferry per crossing. Days per country decide the
 * vignette's length; the 10-day Austrian one covers a transit.
 */
export function chargesFor(
  drives: readonly {
    readonly date: PlainDate;
    readonly countries: readonly CountryCode[];
    readonly points: readonly string[];
    readonly ferry: boolean;
  }[],
): ChargeNeed[] {
  const needs = new Map<string, ChargeNeed>();
  const need = (id: string, date: PlainDate) => {
    const charge = ROAD_CHARGES.find((c) => c.id === id);
    if (charge && !needs.has(id)) needs.set(id, { charge, firstUse: date });
  };
  for (const d of drives) {
    if (d.countries.includes('AT')) need('at-vignette-10d', d.date);
    if (d.countries.includes('CH')) need('ch-vignette-year', d.date);
    if (d.countries.includes('IT')) need('it-motorway', d.date);
    for (const p of d.points) {
      const toll = TUNNEL_TOLL_AT[p];
      if (toll) need(toll, d.date);
    }
    if (d.ferry) need('scandlines-puttgarden-rodby', d.date);
  }
  return [...needs.values()];
}
