import { toPlainDate } from '@app/domain';

import type { Place, SourceRef } from '../types.js';

/**
 * Places the planner knows by name. Coordinates for towns and venues come from
 * OpenStreetMap through openrouteservice's geocoder; mountain passes, which
 * the geocoder does not find, were placed by hand and confirmed against
 * openrouteservice's elevation service (within 60 m of the published height).
 */

const checkedOn = toPlainDate('2026-10-02');

export const GEOCODER: SourceRef = {
  name: 'OpenStreetMap vía openrouteservice (geocodificador)',
  url: 'https://openrouteservice.org/dev/#/api-docs/geocode',
  checkedOn,
};

export const ELEVATION: SourceRef = {
  name: 'openrouteservice (servicio de elevación)',
  url: 'https://openrouteservice.org/dev/#/api-docs/elevation',
  checkedOn,
};

const IT = 'Europe/Rome';
const AT = 'Europe/Vienna';
const CH = 'Europe/Zurich';
const DE = 'Europe/Berlin';
const DK = 'Europe/Copenhagen';

const list: readonly Place[] = [
  // Cities reached by air
  {
    id: 'panama',
    name: 'Ciudad de Panamá',
    country: 'PA',
    lat: 8.9824,
    lon: -79.5199,
    timeZone: 'America/Panama',
    kind: 'city',
  },
  {
    id: 'istanbul',
    name: 'Estambul (Sultanahmet)',
    country: 'TR',
    lat: 41.0054,
    lon: 28.9768,
    timeZone: 'Europe/Istanbul',
    kind: 'city',
  },
  {
    id: 'venezia',
    name: 'Venecia',
    country: 'IT',
    lat: 45.439373,
    lon: 12.318316,
    timeZone: IT,
    kind: 'city',
  },
  {
    id: 'kobenhavn',
    name: 'Copenhague',
    country: 'DK',
    lat: 55.6761,
    lon: 12.5683,
    timeZone: DK,
    kind: 'city',
  },
  // Dolomites
  {
    id: 'cortina',
    name: "Cortina d'Ampezzo",
    country: 'IT',
    lat: 46.539244,
    lon: 12.140899,
    timeZone: IT,
    kind: 'town',
    altitudeM: 1224,
  },
  {
    id: 'falzarego',
    name: 'Passo Falzarego',
    country: 'IT',
    lat: 46.519,
    lon: 12.008,
    timeZone: IT,
    kind: 'pass',
    altitudeM: 2105,
  },
  {
    id: 'pordoi',
    name: 'Passo Pordoi',
    country: 'IT',
    lat: 46.4878,
    lon: 11.8117,
    timeZone: IT,
    kind: 'pass',
    altitudeM: 2239,
  },
  {
    id: 'canazei',
    name: 'Canazei (Val di Fassa)',
    country: 'IT',
    lat: 46.476185,
    lon: 11.770292,
    timeZone: IT,
    kind: 'town',
    altitudeM: 1465,
  },
  {
    id: 'sella',
    name: 'Passo Sella',
    country: 'IT',
    lat: 46.5087,
    lon: 11.757,
    timeZone: IT,
    kind: 'pass',
    altitudeM: 2240,
  },
  {
    id: 'ortisei',
    name: 'Ortisei',
    country: 'IT',
    lat: 46.575995,
    lon: 11.668347,
    timeZone: IT,
    kind: 'town',
    altitudeM: 1236,
  },
  {
    id: 'bolzano',
    name: 'Bolzano',
    country: 'IT',
    lat: 46.4983,
    lon: 11.354,
    timeZone: IT,
    kind: 'city',
    altitudeM: 262,
  },
  {
    id: 'merano',
    name: 'Merano',
    country: 'IT',
    lat: 46.6639,
    lon: 11.162179,
    timeZone: IT,
    kind: 'town',
    altitudeM: 325,
  },
  {
    id: 'reschen',
    name: 'Reschenpass',
    country: 'IT',
    lat: 46.8524,
    lon: 10.5108,
    timeZone: IT,
    kind: 'pass',
    altitudeM: 1504,
  },
  // Lakes corridor (the default when nobody asks for the Dolomites)
  {
    id: 'verona',
    name: 'Verona',
    country: 'IT',
    lat: 45.413277,
    lon: 10.977656,
    timeZone: IT,
    kind: 'city',
  },
  {
    id: 'como',
    name: 'Como',
    country: 'IT',
    lat: 45.800127,
    lon: 9.094613,
    timeZone: IT,
    kind: 'city',
  },
  {
    id: 'maloja',
    name: 'Passo del Maloja',
    country: 'CH',
    lat: 46.4027,
    lon: 9.6946,
    timeZone: CH,
    kind: 'pass',
    altitudeM: 1815,
  },
  {
    id: 'julier',
    name: 'Julierpass',
    country: 'CH',
    lat: 46.4719,
    lon: 9.7286,
    timeZone: CH,
    kind: 'pass',
    altitudeM: 2284,
  },
  // Austria and Switzerland
  {
    id: 'stanton',
    name: 'St. Anton am Arlberg',
    country: 'AT',
    lat: 47.128394,
    lon: 10.259895,
    timeZone: AT,
    kind: 'town',
    altitudeM: 1304,
  },
  {
    id: 'chur',
    name: 'Chur',
    country: 'CH',
    lat: 46.850722,
    lon: 9.53171,
    timeZone: CH,
    kind: 'city',
  },
  {
    id: 'arosa',
    name: 'Arosa',
    country: 'CH',
    lat: 46.785385,
    lon: 9.678935,
    timeZone: CH,
    kind: 'town',
    altitudeM: 1775,
  },
  {
    id: 'zurich',
    name: 'Zúrich',
    country: 'CH',
    lat: 47.373754,
    lon: 8.537087,
    timeZone: CH,
    kind: 'city',
  },
  {
    id: 'rheinfall',
    name: 'Cataratas del Rin',
    country: 'CH',
    lat: 47.682074,
    lon: 8.620597,
    timeZone: CH,
    kind: 'poi',
  },
  // Black Forest and the Rhine
  {
    id: 'hinterzarten',
    name: 'Hinterzarten (Selva Negra)',
    country: 'DE',
    lat: 47.90952,
    lon: 8.098658,
    timeZone: DE,
    kind: 'town',
    altitudeM: 893,
  },
  {
    id: 'ravenna',
    name: 'Mercado navideño de la Ravennaschlucht',
    country: 'DE',
    lat: 47.918211,
    lon: 8.079844,
    timeZone: DE,
    kind: 'market',
  },
  {
    id: 'freiburg',
    name: 'Friburgo',
    country: 'DE',
    lat: 47.9959,
    lon: 7.8494,
    timeZone: DE,
    kind: 'city',
  },
  {
    id: 'heidelberg',
    name: 'Heidelberg',
    country: 'DE',
    lat: 49.4093,
    lon: 8.6934,
    timeZone: DE,
    kind: 'city',
  },
  {
    id: 'ruedesheim',
    name: 'Rüdesheim am Rhein',
    country: 'DE',
    lat: 50.015995,
    lon: 7.891405,
    timeZone: DE,
    kind: 'town',
  },
  {
    id: 'koeln',
    name: 'Colonia',
    country: 'DE',
    lat: 50.9413,
    lon: 6.9583,
    timeZone: DE,
    kind: 'city',
  },
  {
    id: 'hamburg',
    name: 'Hamburgo',
    country: 'DE',
    lat: 53.5511,
    lon: 9.9937,
    timeZone: DE,
    kind: 'city',
  },
  {
    id: 'luebeck',
    name: 'Lübeck',
    country: 'DE',
    lat: 53.870029,
    lon: 10.68237,
    timeZone: DE,
    kind: 'city',
  },
  {
    id: 'puttgarden',
    name: 'Puttgarden (ferry)',
    country: 'DE',
    lat: 54.5013,
    lon: 11.2268,
    timeZone: DE,
    kind: 'port',
  },
  {
    id: 'roedby',
    name: 'Rødby (ferry)',
    country: 'DK',
    lat: 54.655802,
    lon: 11.357448,
    timeZone: DK,
    kind: 'port',
  },
  {
    id: 'kastrup',
    name: 'Aeropuerto de Copenhague (Kastrup)',
    country: 'DK',
    lat: 55.61792,
    lon: 12.65597,
    timeZone: DK,
    kind: 'airport',
  },
];

export const PLACES: ReadonlyMap<string, Place> = new Map(list.map((p) => [p.id, p]));

export function placeOf(id: string): Place {
  const p = PLACES.get(id);
  if (!p) throw new RangeError(`Unknown place: ${id}`);
  return p;
}
