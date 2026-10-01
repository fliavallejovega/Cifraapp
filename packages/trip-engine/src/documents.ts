import { toPlainDate, type PlainDate } from '@app/domain';

import { isTripCategory, type TripCategory } from './categories.js';

/**
 * Normalizing what the document reader transcribed.
 *
 * The model copies text as printed — «12,50 €», «15 de marzo de 2027»,
 * «PTY 07:45» — and this module turns it into facts deterministically:
 * amounts as decimal strings, currencies as ISO codes, dates as calendar days.
 * Nothing here guesses past the text: an amount that cannot be read is null,
 * a «$» that could be several currencies is flagged as ambiguous, and the
 * screen asks the person.
 *
 * It also removes what the household should not keep: card numbers and
 * passport numbers are masked before anything is stored.
 */

export type DocumentKind =
  | 'flight_itinerary'
  | 'boarding_pass'
  | 'lodging_confirmation'
  | 'receipt'
  | 'invoice'
  | 'ticket'
  | 'insurance_policy'
  | 'other';

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/**
 * A printed amount as a decimal string: «1.234,56» and «1,234.56» are both
 * `1234.56`; «45.000» in a peso receipt is `45000`. The last separator is the
 * decimal mark when one or two digits follow it; three digits mean grouping.
 */
export function parsePrintedAmount(text: string | null | undefined): string | null {
  if (!text) return null;
  const negative = /^\s*[-−(]/.test(text) || /-\s*$/.test(text.trim());
  const digits = text.replace(/[^\d.,]/g, '');
  if (!/\d/.test(digits)) return null;
  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  const last = Math.max(lastDot, lastComma);
  let whole = digits;
  let fraction = '';
  if (last >= 0) {
    const after = digits.slice(last + 1);
    if (after.length > 0 && after.length <= 2) {
      whole = digits.slice(0, last);
      fraction = after;
    } else if (after.length === 3 && lastDot >= 0 && lastComma >= 0) {
      // «1,234.567»: three decimals after mixed separators are still decimals.
      whole = digits.slice(0, last);
      fraction = after;
    }
  }
  whole = whole.replace(/[.,]/g, '').replace(/^0+(?=\d)/, '') || '0';
  if (whole.length > 12) return null;
  const value = fraction ? `${whole}.${fraction.slice(0, 4)}` : whole;
  return negative ? `-${value}` : value;
}

// ---------------------------------------------------------------------------
// Currencies
// ---------------------------------------------------------------------------

const SYMBOLS: readonly [RegExp, string][] = [
  [/US\$|USD|U\$S/i, 'USD'],
  [/CA\$|CAD/i, 'CAD'],
  [/MX\$|MXN/i, 'MXN'],
  [/COL\$|COP/i, 'COP'],
  [/RD\$|DOP/i, 'DOP'],
  [/AR\$|ARS/i, 'ARS'],
  [/CLP\$|CLP/i, 'CLP'],
  [/R\$|BRL/i, 'BRL'],
  [/S\/\.?|PEN/i, 'PEN'],
  [/B\/\.|PAB/i, 'PAB'],
  [/€|EUR/i, 'EUR'],
  [/£|GBP/i, 'GBP'],
  [/CHF/i, 'CHF'],
  [/¥|JPY|円/i, 'JPY'],
  [/₡|CRC/i, 'CRC'],
  [/\bQ\s?\d|GTQ/i, 'GTQ'],
];

/** Currencies that print as a bare «$». */
const DOLLAR_SIGN = new Set(['USD', 'CAD', 'MXN', 'COP', 'DOP', 'ARS', 'CLP']);

/**
 * The currency a printed amount is in.
 *
 * An explicit code or symbol wins. A bare «$» is resolved by the country the
 * document is from when that country prints dollars-sign currencies, else
 * flagged as ambiguous with the fallback (the leg's currency) proposed.
 */
export function detectCurrency(
  text: string | null | undefined,
  context: { countryCurrency?: string | null; fallback: string },
): { code: string; ambiguous: boolean } {
  const sample = text ?? '';
  for (const [pattern, code] of SYMBOLS) {
    if (pattern.test(sample)) return { code, ambiguous: false };
  }
  if (sample.includes('$')) {
    const country = context.countryCurrency;
    if (country && DOLLAR_SIGN.has(country)) return { code: country, ambiguous: country !== 'USD' };
    return { code: context.fallback, ambiguous: true };
  }
  return { code: context.countryCurrency ?? context.fallback, ambiguous: !context.countryCurrency };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Readonly<Record<string, number>> = Object.fromEntries(
  (
    [
      // es, en, pt, fr, it, de — full names and common abbreviations.
      ['enero ene january jan janeiro jan janvier janv gennaio gen januar jän', 1],
      ['febrero feb february fevereiro fev février févr fevr febbraio februar', 2],
      ['marzo mar march março mars marzo märz maerz', 3],
      ['abril abr april avril avr aprile apr', 4],
      ['mayo may mai maio maggio mag', 5],
      ['junio jun june junho juin giugno giu juni', 6],
      ['julio jul july julho juillet juil luglio lug juli', 7],
      ['agosto ago august aug août aout agosto', 8],
      ['septiembre setiembre sep sept september setembro set septembre settembre', 9],
      ['octubre oct october outubro out octobre ottobre ott oktober okt', 10],
      ['noviembre nov november novembro novembre', 11],
      ['diciembre dic december dec dezembro dez décembre dicembre dezember', 12],
    ] as const
  ).flatMap(([names, month]) =>
    names
      .split(' ')
      .map((name) => [name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''), month] as const),
  ),
);

const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function makeDate(year: number, month: number, day: number): PlainDate | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return toPlainDate(date.toISOString().slice(0, 10));
}

const fullYear = (year: number, reference: number): number => {
  if (year >= 100) return year;
  const century = Math.floor(reference / 100) * 100;
  return century + year;
};

/**
 * A printed date as a calendar day.
 *
 * Understands ISO dates, numeric dates (day first unless the document is from
 * a month-first country), and written months in Spanish, English, Portuguese,
 * French, Italian and German. A missing year takes the reference year, or the
 * next one when the date would otherwise be in the past by months.
 */
export function parsePrintedDate(
  text: string | null | undefined,
  options: { dayFirst?: boolean; reference?: PlainDate } = {},
): PlainDate | null {
  if (!text) return null;
  const value = fold(text).trim();
  const ref = options.reference ?? toPlainDate('2026-01-01');
  const refYear = Number(ref.slice(0, 4));
  const dayFirst = options.dayFirst ?? true;

  let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(value);
  if (m) return makeDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(value);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = fullYear(Number(m[3]), refYear);
    // An impossible month settles the order whatever the convention.
    if (a > 12) return makeDate(year, b, a);
    if (b > 12) return makeDate(year, a, b);
    return dayFirst ? makeDate(year, b, a) : makeDate(year, a, b);
  }

  const words = value.replace(/[,.]/g, ' ').split(/\s+/).filter(Boolean);
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;
  for (const word of words) {
    const clean = word.replace(/(st|nd|rd|th|º|°)$/, '');
    if (month === null && MONTHS[clean] !== undefined) month = MONTHS[clean] ?? null;
    else if (/^\d{4}$/.test(clean)) year = Number(clean);
    else if (/^\d{1,2}$/.test(clean) && day === null) day = Number(clean);
  }
  if (day !== null && month !== null) {
    let y = year ?? refYear;
    if (year === null) {
      const candidate = makeDate(y, month, day);
      if (candidate && candidate < ref && Number(ref.slice(5, 7)) - month > 2) y += 1;
    }
    return makeDate(y, month, day);
  }
  return null;
}

/** «14:35», «2:35 PM», «2.35 p. m.» → minutes after midnight, or null. */
export function parsePrintedTime(text: string | null | undefined): number | null {
  if (!text) return null;
  // A colon first: «15.03.2027 07:45» must not read the date as a time.
  const m =
    /(\d{1,2}):(\d{2})\s*([ap])?\.?\s*m?\.?/i.exec(text) ??
    /(\d{1,2})h(\d{2})/i.exec(text) ??
    /(?<![\d.])(\d{1,2})\.(\d{2})\s*([ap])\.?\s*m\.?/i.exec(text);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === 'p' && hours < 12) hours += 12;
  if (meridiem === 'a' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Countries that print dates month first. */
export const MONTH_FIRST_COUNTRIES = new Set(['US']);

// ---------------------------------------------------------------------------
// Personal data
// ---------------------------------------------------------------------------

/**
 * Masks card numbers (13–19 digits, spaces or dashes allowed, Luhn-checked)
 * down to their last four, and passport numbers next to their label.
 */
export function scrubSensitive(text: string): string {
  let out = text.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (match) => {
    const digits = match.replace(/\D/g, '');
    return luhn(digits) ? `•••• ${digits.slice(-4)}` : match;
  });
  out = out.replace(
    /(passport|pasaporte|passeport|passaporto|reisepass|n[ºo°]?\s*de\s*pasaporte)(\s*(?:no\.?|number|n[ºo°]|#|:)?\s*)([A-Z0-9]{6,12})/gi,
    (_all, label: string, sep: string) => `${label}${sep}•••`,
  );
  return out;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

// ---------------------------------------------------------------------------
// Flights: layovers versus destinations
// ---------------------------------------------------------------------------

export interface FlightSegment {
  readonly fromIata: string | null;
  readonly toIata: string | null;
  readonly fromCity: string | null;
  readonly toCity: string | null;
  readonly departure: { date: PlainDate; minutes: number | null } | null;
  readonly arrival: { date: PlainDate; minutes: number | null } | null;
  readonly flightNumber: string | null;
}

const at = (point: { date: PlainDate; minutes: number | null }): number =>
  Date.parse(`${point.date}T00:00:00Z`) / 60_000 + (point.minutes ?? 12 * 60);

/**
 * The places where the travellers actually stay: an arrival followed by a
 * departure less than 24 hours later is a layover, not a destination. The
 * last arrival is home when it matches the first departure.
 */
export function destinationsFromSegments(segments: readonly FlightSegment[]): {
  readonly stays: readonly {
    city: string | null;
    iata: string | null;
    from: PlainDate;
    to: PlainDate | null;
  }[];
  readonly outbound: PlainDate | null;
  readonly inbound: PlainDate | null;
  readonly layovers: readonly string[];
} {
  const ordered = segments
    .filter(
      (s): s is FlightSegment & { departure: NonNullable<FlightSegment['departure']> } =>
        s.departure !== null,
    )
    .sort((a, b) => at(a.departure) - at(b.departure));
  const origin = ordered[0]?.fromIata ?? ordered[0]?.fromCity ?? null;
  const stays: {
    city: string | null;
    iata: string | null;
    from: PlainDate;
    to: PlainDate | null;
  }[] = [];
  const layovers: string[] = [];
  ordered.forEach((segment, i) => {
    const next = ordered[i + 1];
    const arrival = segment.arrival ?? segment.departure;
    if (!arrival) return;
    const place = segment.toIata ?? segment.toCity;
    const isHome = place !== null && place === origin;
    if (next?.departure) {
      const hours = (at(next.departure) - at(arrival)) / 60;
      if (hours < 24) {
        if (place) layovers.push(place);
        return;
      }
      if (!isHome)
        stays.push({
          city: segment.toCity,
          iata: segment.toIata,
          from: arrival.date,
          to: next.departure.date,
        });
    } else if (!isHome) {
      stays.push({ city: segment.toCity, iata: segment.toIata, from: arrival.date, to: null });
    }
  });
  const last = ordered[ordered.length - 1];
  const lastPlace = last ? (last.toIata ?? last.toCity) : null;
  return {
    stays,
    outbound: ordered[0]?.departure?.date ?? null,
    inbound:
      lastPlace !== null && lastPlace === origin
        ? (last?.arrival?.date ?? last?.departure?.date ?? null)
        : null,
    layovers,
  };
}

// ---------------------------------------------------------------------------
// The proposal
// ---------------------------------------------------------------------------

/** What the reader returned, as text fields (empty when absent). */
export interface RawExtraction {
  readonly kind: string;
  readonly kindConfidence: number;
  readonly provider: string;
  readonly referenceCode: string;
  readonly totalAmount: string;
  readonly currencyText: string;
  readonly amountPaid: string;
  readonly amountDue: string;
  readonly dueDate: string;
  readonly city: string;
  readonly country: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly guests: string;
  readonly payAtProperty: string;
  readonly cityTaxPending: string;
  readonly breakfastIncluded: string;
  readonly cancellationDeadline: string;
  readonly purchaseDate: string;
  readonly datetimeLocal: string;
  readonly subtotal: string;
  readonly tax: string;
  readonly tip: string;
  readonly paymentMethod: string;
  readonly categoryGuess: string;
  readonly segments: readonly {
    from_iata: string;
    to_iata: string;
    from_city: string;
    to_city: string;
    departure_local: string;
    arrival_local: string;
    flight_number: string;
  }[];
  readonly passengers: readonly { name: string; type: string }[];
  readonly uncertainFields: readonly string[];
}

export interface Proposal {
  readonly kind: DocumentKind;
  readonly kindConfidence: number;
  readonly provider: string | null;
  readonly referenceCode: string | null;
  readonly amount: string | null;
  readonly currency: string;
  readonly currencyAmbiguous: boolean;
  readonly amountPaid: string | null;
  readonly amountDue: string | null;
  readonly dueDate: PlainDate | null;
  readonly city: string | null;
  readonly countryCode: string | null;
  readonly checkIn: PlainDate | null;
  readonly checkOut: PlainDate | null;
  readonly nights: number | null;
  readonly payAtProperty: boolean | null;
  readonly cityTaxPending: boolean | null;
  readonly breakfastIncluded: boolean | null;
  readonly cancellationDeadline: PlainDate | null;
  readonly purchaseDate: PlainDate | null;
  readonly day: PlainDate | null;
  readonly tip: string | null;
  readonly tax: string | null;
  readonly paymentMethod: 'cash' | 'card' | null;
  readonly category: TripCategory | null;
  readonly segments: readonly FlightSegment[];
  readonly stays: ReturnType<typeof destinationsFromSegments>['stays'];
  readonly outbound: PlainDate | null;
  readonly inbound: PlainDate | null;
  readonly layovers: readonly string[];
  readonly passengers: readonly { name: string; type: 'adult' | 'child' | 'infant' }[];
  /** Fields a person should look at before confirming. */
  readonly lowConfidence: readonly string[];
  /** Overall confidence: the kind's, lowered for each uncertain or missing key field. */
  readonly confidence: number;
}

const KINDS: readonly DocumentKind[] = [
  'flight_itinerary',
  'boarding_pass',
  'lodging_confirmation',
  'receipt',
  'invoice',
  'ticket',
  'insurance_policy',
  'other',
];

const passengerType = (value: string): 'adult' | 'child' | 'infant' =>
  value === 'child' ? 'child' : value === 'infant' ? 'infant' : 'adult';

const yesNo = (value: string): boolean | null =>
  /^(yes|si|sí|true)$/i.test(value.trim())
    ? true
    : /^(no|false)$/i.test(value.trim())
      ? false
      : null;

const clean = (value: string): string | null => {
  const trimmed = scrubSensitive(value.trim());
  return trimmed === '' ? null : trimmed.slice(0, 160);
};

/**
 * Turns the reader's transcription into a proposal the review screen shows.
 *
 * `context` carries what the household already knows: the trip's legs and
 * dates, to resolve a missing year, a bare «$», or a day-first date.
 */
export function normalizeExtraction(
  raw: RawExtraction,
  context: {
    readonly countryCode?: string | null;
    readonly countryCurrency?: string | null;
    readonly fallbackCurrency: string;
    readonly reference: PlainDate;
  },
): Proposal {
  const kind: DocumentKind = (KINDS as readonly string[]).includes(raw.kind)
    ? (raw.kind as DocumentKind)
    : 'other';
  const dayFirst = !MONTH_FIRST_COUNTRIES.has(context.countryCode ?? '');
  const date = (text: string) => parsePrintedDate(text, { dayFirst, reference: context.reference });
  const currency = detectCurrency(`${raw.currencyText} ${raw.totalAmount}`, {
    countryCurrency: context.countryCurrency ?? null,
    fallback: context.fallbackCurrency,
  });

  const segments: FlightSegment[] = raw.segments.slice(0, 12).map((s) => {
    const departureDate = date(s.departure_local);
    const arrivalDate = date(s.arrival_local) ?? departureDate;
    return {
      fromIata: /^[A-Z]{3}$/.test(s.from_iata.trim().toUpperCase())
        ? s.from_iata.trim().toUpperCase()
        : null,
      toIata: /^[A-Z]{3}$/.test(s.to_iata.trim().toUpperCase())
        ? s.to_iata.trim().toUpperCase()
        : null,
      fromCity: clean(s.from_city),
      toCity: clean(s.to_city),
      departure: departureDate
        ? { date: departureDate, minutes: parsePrintedTime(s.departure_local) }
        : null,
      arrival: arrivalDate
        ? { date: arrivalDate, minutes: parsePrintedTime(s.arrival_local) }
        : null,
      flightNumber: clean(s.flight_number.replace(/\s+/g, '')),
    };
  });
  const route = destinationsFromSegments(segments);

  const checkIn = date(raw.checkIn);
  const checkOut = date(raw.checkOut);
  const nights =
    checkIn && checkOut && checkOut > checkIn
      ? Math.round(
          (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000,
        )
      : null;
  const amount = parsePrintedAmount(raw.totalAmount);
  const category = isTripCategory(raw.categoryGuess)
    ? raw.categoryGuess
    : kind === 'flight_itinerary' || kind === 'boarding_pass'
      ? 'flights'
      : kind === 'lodging_confirmation'
        ? 'lodging'
        : kind === 'insurance_policy'
          ? 'insurance'
          : kind === 'ticket'
            ? 'activities'
            : null;

  const lowConfidence = new Set(raw.uncertainFields.map((f) => f.trim()).filter(Boolean));
  if (amount === null) lowConfidence.add('totalAmount');
  if (currency.ambiguous) lowConfidence.add('currency');
  if (kind === 'lodging_confirmation' && (!checkIn || !checkOut)) lowConfidence.add('dates');
  const keyMissing = amount === null ? 1 : 0;
  const confidence = Math.max(
    0,
    Math.min(1, raw.kindConfidence) - 0.1 * Math.min(lowConfidence.size, 5) - 0.2 * keyMissing,
  );

  return {
    kind,
    kindConfidence: Math.max(0, Math.min(1, raw.kindConfidence)),
    provider: clean(raw.provider),
    referenceCode: clean(raw.referenceCode),
    amount: amount?.startsWith('-') ? amount.slice(1) : amount,
    currency: currency.code,
    currencyAmbiguous: currency.ambiguous,
    amountPaid: parsePrintedAmount(raw.amountPaid),
    amountDue: parsePrintedAmount(raw.amountDue),
    dueDate: date(raw.dueDate),
    city: clean(raw.city),
    countryCode: /^[A-Z]{2}$/.test(raw.country.trim().toUpperCase())
      ? raw.country.trim().toUpperCase()
      : (context.countryCode ?? null),
    checkIn,
    checkOut,
    nights,
    payAtProperty: yesNo(raw.payAtProperty),
    cityTaxPending: yesNo(raw.cityTaxPending),
    breakfastIncluded: yesNo(raw.breakfastIncluded),
    cancellationDeadline: date(raw.cancellationDeadline),
    purchaseDate: date(raw.purchaseDate),
    day: date(raw.datetimeLocal) ?? date(raw.purchaseDate),
    tip: parsePrintedAmount(raw.tip),
    tax: parsePrintedAmount(raw.tax),
    paymentMethod: /cash|efectivo/i.test(raw.paymentMethod)
      ? 'cash'
      : /card|tarjeta/i.test(raw.paymentMethod)
        ? 'card'
        : null,
    category,
    segments,
    stays: route.stays,
    outbound: route.outbound,
    inbound: route.inbound,
    layovers: route.layovers,
    passengers: raw.passengers
      .slice(0, 12)
      .map((p) => ({
        name: scrubSensitive(p.name.trim()).slice(0, 120),
        type: passengerType(p.type),
      }))
      .filter((p) => p.name !== ''),
    lowConfidence: [...lowConfidence],
    confidence: Math.round(confidence * 1000) / 1000,
  };
}
