/**
 * A light catalogue of destinations for the trip wizard.
 *
 * Enough to autocomplete the places families from Panama actually travel to,
 * and to infer what a person would otherwise have to type: the currency, the
 * time zone and a starting cost level. Everything inferred stays editable — a
 * city missing from this list is still accepted as free text.
 *
 * The cost level is a starting point the family can change, never a claim
 * about the place: version 1 has no outside source for the cost of living.
 */

export type CostLevel = 'low' | 'medium' | 'high' | 'very_high';

export interface Country {
  readonly code: string;
  readonly es: string;
  readonly en: string;
  readonly currency: string;
  readonly timezone: string;
  readonly level: CostLevel;
}

export const COUNTRIES: readonly Country[] = [
  {
    code: 'PA',
    es: 'Panamá',
    en: 'Panama',
    currency: 'USD',
    timezone: 'America/Panama',
    level: 'medium',
  },
  {
    code: 'US',
    es: 'Estados Unidos',
    en: 'United States',
    currency: 'USD',
    timezone: 'America/New_York',
    level: 'high',
  },
  {
    code: 'CA',
    es: 'Canadá',
    en: 'Canada',
    currency: 'CAD',
    timezone: 'America/Toronto',
    level: 'high',
  },
  {
    code: 'MX',
    es: 'México',
    en: 'Mexico',
    currency: 'MXN',
    timezone: 'America/Mexico_City',
    level: 'low',
  },
  {
    code: 'CR',
    es: 'Costa Rica',
    en: 'Costa Rica',
    currency: 'CRC',
    timezone: 'America/Costa_Rica',
    level: 'medium',
  },
  {
    code: 'GT',
    es: 'Guatemala',
    en: 'Guatemala',
    currency: 'GTQ',
    timezone: 'America/Guatemala',
    level: 'low',
  },
  {
    code: 'SV',
    es: 'El Salvador',
    en: 'El Salvador',
    currency: 'USD',
    timezone: 'America/El_Salvador',
    level: 'low',
  },
  {
    code: 'DO',
    es: 'República Dominicana',
    en: 'Dominican Republic',
    currency: 'DOP',
    timezone: 'America/Santo_Domingo',
    level: 'low',
  },
  {
    code: 'CO',
    es: 'Colombia',
    en: 'Colombia',
    currency: 'COP',
    timezone: 'America/Bogota',
    level: 'low',
  },
  {
    code: 'EC',
    es: 'Ecuador',
    en: 'Ecuador',
    currency: 'USD',
    timezone: 'America/Guayaquil',
    level: 'low',
  },
  { code: 'PE', es: 'Perú', en: 'Peru', currency: 'PEN', timezone: 'America/Lima', level: 'low' },
  {
    code: 'CL',
    es: 'Chile',
    en: 'Chile',
    currency: 'CLP',
    timezone: 'America/Santiago',
    level: 'medium',
  },
  {
    code: 'AR',
    es: 'Argentina',
    en: 'Argentina',
    currency: 'ARS',
    timezone: 'America/Argentina/Buenos_Aires',
    level: 'low',
  },
  {
    code: 'BR',
    es: 'Brasil',
    en: 'Brazil',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    level: 'medium',
  },
  {
    code: 'ES',
    es: 'España',
    en: 'Spain',
    currency: 'EUR',
    timezone: 'Europe/Madrid',
    level: 'high',
  },
  {
    code: 'FR',
    es: 'Francia',
    en: 'France',
    currency: 'EUR',
    timezone: 'Europe/Paris',
    level: 'very_high',
  },
  {
    code: 'IT',
    es: 'Italia',
    en: 'Italy',
    currency: 'EUR',
    timezone: 'Europe/Rome',
    level: 'high',
  },
  {
    code: 'PT',
    es: 'Portugal',
    en: 'Portugal',
    currency: 'EUR',
    timezone: 'Europe/Lisbon',
    level: 'medium',
  },
  {
    code: 'DE',
    es: 'Alemania',
    en: 'Germany',
    currency: 'EUR',
    timezone: 'Europe/Berlin',
    level: 'high',
  },
  {
    code: 'NL',
    es: 'Países Bajos',
    en: 'Netherlands',
    currency: 'EUR',
    timezone: 'Europe/Amsterdam',
    level: 'very_high',
  },
  {
    code: 'GB',
    es: 'Reino Unido',
    en: 'United Kingdom',
    currency: 'GBP',
    timezone: 'Europe/London',
    level: 'very_high',
  },
  {
    code: 'CH',
    es: 'Suiza',
    en: 'Switzerland',
    currency: 'CHF',
    timezone: 'Europe/Zurich',
    level: 'very_high',
  },
  { code: 'JP', es: 'Japón', en: 'Japan', currency: 'JPY', timezone: 'Asia/Tokyo', level: 'high' },
];

export interface City {
  readonly name: string;
  readonly country: string;
  readonly timezone?: string;
  readonly level?: CostLevel;
}

export const CITIES: readonly City[] = [
  { name: 'Ciudad de Panamá', country: 'PA' },
  { name: 'Boquete', country: 'PA', level: 'low' },
  { name: 'Bocas del Toro', country: 'PA', level: 'low' },
  { name: 'Miami', country: 'US', level: 'high' },
  { name: 'Orlando', country: 'US', level: 'high' },
  { name: 'Nueva York', country: 'US', level: 'very_high' },
  { name: 'Los Ángeles', country: 'US', timezone: 'America/Los_Angeles', level: 'very_high' },
  { name: 'Las Vegas', country: 'US', timezone: 'America/Los_Angeles', level: 'high' },
  { name: 'San Francisco', country: 'US', timezone: 'America/Los_Angeles', level: 'very_high' },
  { name: 'Houston', country: 'US', timezone: 'America/Chicago', level: 'medium' },
  { name: 'Toronto', country: 'CA', level: 'high' },
  { name: 'Vancouver', country: 'CA', timezone: 'America/Vancouver', level: 'high' },
  { name: 'Ciudad de México', country: 'MX', level: 'medium' },
  { name: 'Cancún', country: 'MX', timezone: 'America/Cancun', level: 'medium' },
  { name: 'Playa del Carmen', country: 'MX', timezone: 'America/Cancun', level: 'medium' },
  { name: 'San José', country: 'CR' },
  { name: 'Guanacaste', country: 'CR' },
  { name: 'Antigua Guatemala', country: 'GT' },
  { name: 'Punta Cana', country: 'DO', level: 'medium' },
  { name: 'Santo Domingo', country: 'DO' },
  { name: 'Bogotá', country: 'CO' },
  { name: 'Medellín', country: 'CO' },
  { name: 'Cartagena', country: 'CO', level: 'medium' },
  { name: 'San Andrés', country: 'CO', level: 'medium' },
  { name: 'Quito', country: 'EC' },
  { name: 'Lima', country: 'PE' },
  { name: 'Cusco', country: 'PE' },
  { name: 'Santiago', country: 'CL' },
  { name: 'Buenos Aires', country: 'AR' },
  { name: 'Río de Janeiro', country: 'BR' },
  { name: 'São Paulo', country: 'BR' },
  { name: 'Madrid', country: 'ES' },
  { name: 'Barcelona', country: 'ES', level: 'very_high' },
  { name: 'Sevilla', country: 'ES', level: 'medium' },
  { name: 'París', country: 'FR' },
  { name: 'Niza', country: 'FR', level: 'high' },
  { name: 'Roma', country: 'IT' },
  { name: 'Florencia', country: 'IT' },
  { name: 'Venecia', country: 'IT', level: 'very_high' },
  { name: 'Milán', country: 'IT', level: 'very_high' },
  { name: 'Lisboa', country: 'PT' },
  { name: 'Oporto', country: 'PT', level: 'low' },
  { name: 'Berlín', country: 'DE' },
  { name: 'Múnich', country: 'DE', level: 'very_high' },
  { name: 'Ámsterdam', country: 'NL' },
  { name: 'Londres', country: 'GB' },
  { name: 'Zúrich', country: 'CH' },
  { name: 'Tokio', country: 'JP' },
  { name: 'Kioto', country: 'JP' },
];

export const countryByCode = (code: string | null | undefined): Country | undefined =>
  COUNTRIES.find((country) => country.code === code);

const fold = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** The catalogue entry for what someone typed, accent- and case-insensitive. */
export function findCity(name: string): (City & { countryInfo: Country | undefined }) | null {
  const wanted = fold(name);
  if (!wanted) return null;
  const city = CITIES.find((entry) => fold(entry.name) === wanted);
  return city ? { ...city, countryInfo: countryByCode(city.country) } : null;
}

/** What the wizard can infer from a city and country: currency, zone, cost level. */
export function inferPlace(city: string, countryCode: string | null) {
  const known = findCity(city);
  const country = countryByCode(known?.country ?? countryCode) ?? undefined;
  return {
    countryCode: country?.code ?? countryCode ?? null,
    currency: country?.currency ?? null,
    timezone: known?.timezone ?? country?.timezone ?? null,
    level: known?.level ?? country?.level ?? 'medium',
  } as const;
}
