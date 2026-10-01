import { toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import {
  destinationsFromSegments,
  detectCurrency,
  normalizeExtraction,
  parsePrintedAmount,
  parsePrintedDate,
  parsePrintedTime,
  scrubSensitive,
  type RawExtraction,
} from './documents.js';

const ref = toPlainDate('2027-01-15');

function raw(patch: Partial<RawExtraction>): RawExtraction {
  return {
    kind: 'other',
    kindConfidence: 0.9,
    provider: '',
    referenceCode: '',
    totalAmount: '',
    currencyText: '',
    amountPaid: '',
    amountDue: '',
    dueDate: '',
    city: '',
    country: '',
    checkIn: '',
    checkOut: '',
    guests: '',
    payAtProperty: '',
    cityTaxPending: '',
    breakfastIncluded: '',
    cancellationDeadline: '',
    purchaseDate: '',
    datetimeLocal: '',
    subtotal: '',
    tax: '',
    tip: '',
    paymentMethod: '',
    categoryGuess: '',
    segments: [],
    passengers: [],
    uncertainFields: [],
    ...patch,
  };
}

const seg = (from: string, to: string, dep: string, arr: string, fromCity = '', toCity = '') => ({
  from_iata: from,
  to_iata: to,
  from_city: fromCity,
  to_city: toCity,
  departure_local: dep,
  arrival_local: arr,
  flight_number: 'CM 123',
});

describe('parsePrintedAmount', () => {
  it.each([
    ['1.234,56 €', '1234.56'],
    ['$1,234.56', '1234.56'],
    ['12,50 €', '12.50'],
    ['COP 45.000', '45000'],
    ['B/. 125.40', '125.40'],
    ['¥1,200', '1200'],
    ['R$ 89,9', '89.9'],
    ['-40.00', '-40.00'],
    ['1 250,00 CHF', '1250.00'],
    ['total', null],
    ['', null],
  ])('%s → %s', (text, expected) => {
    expect(parsePrintedAmount(text)).toBe(expected);
  });
});

describe('detectCurrency', () => {
  it('takes an explicit symbol or code', () => {
    expect(detectCurrency('12,50 €', { fallback: 'USD' })).toEqual({
      code: 'EUR',
      ambiguous: false,
    });
    expect(detectCurrency('£40', { fallback: 'USD' })).toEqual({ code: 'GBP', ambiguous: false });
    expect(detectCurrency('MX$ 350', { fallback: 'USD' })).toEqual({
      code: 'MXN',
      ambiguous: false,
    });
  });

  it('resolves a bare $ from the country, and flags it when it could be wrong', () => {
    expect(detectCurrency('$ 45.000', { countryCurrency: 'COP', fallback: 'USD' })).toEqual({
      code: 'COP',
      ambiguous: true,
    });
    expect(detectCurrency('$12.00', { countryCurrency: 'USD', fallback: 'EUR' })).toEqual({
      code: 'USD',
      ambiguous: false,
    });
    expect(detectCurrency('$12.00', { countryCurrency: 'EUR', fallback: 'USD' })).toEqual({
      code: 'USD',
      ambiguous: true,
    });
  });
});

describe('parsePrintedDate', () => {
  it.each([
    ['2027-07-01', '2027-07-01'],
    ['15 de marzo de 2027', '2027-03-15'],
    ['March 15, 2027', '2027-03-15'],
    ['15 mars 2027', '2027-03-15'],
    ['15 maggio 2027', '2027-05-15'],
    ['15. März 2027', '2027-03-15'],
    ['15 de março de 2027', '2027-03-15'],
    ['01 JUL 2027 14:35', '2027-07-01'],
    ['15/03/2027', '2027-03-15'],
    ['31/12/27', '2027-12-31'],
    ['sin fecha', null],
  ])('%s → %s', (text, expected) => {
    expect(parsePrintedDate(text, { reference: ref })).toBe(expected);
  });

  it('reads month-first dates for month-first countries and settles impossible months', () => {
    expect(parsePrintedDate('03/04/2027', { dayFirst: false, reference: ref })).toBe('2027-03-04');
    expect(parsePrintedDate('03/04/2027', { dayFirst: true, reference: ref })).toBe('2027-04-03');
    expect(parsePrintedDate('03/25/2027', { dayFirst: true, reference: ref })).toBe('2027-03-25');
  });

  it('gives a yearless date the year that keeps it ahead', () => {
    expect(parsePrintedDate('10 JUL', { reference: ref })).toBe('2027-07-10');
    expect(parsePrintedDate('2 ENE', { reference: toPlainDate('2027-11-20') })).toBe('2028-01-02');
  });
});

describe('parsePrintedTime', () => {
  it.each([
    ['14:35', 875],
    ['2:35 PM', 875],
    ['12:10 a. m.', 10],
    ['15.03.2027 07:45', 465],
    ['18h30', 1110],
    ['', null],
  ])('%s → %s', (text, expected) => {
    expect(parsePrintedTime(text)).toBe(expected);
  });
});

describe('scrubSensitive', () => {
  it('keeps only the last four digits of a real card number', () => {
    expect(scrubSensitive('VISA 4111 1111 1111 1111')).toBe('VISA •••• 1111');
    expect(scrubSensitive('Ref 1234567890123')).toBe('Ref 1234567890123');
  });

  it('removes passport numbers next to their label', () => {
    expect(scrubSensitive('Pasaporte: PA1234567')).toBe('Pasaporte: •••');
    expect(scrubSensitive('Passport No. X12345678')).toBe('Passport No. •••');
  });
});

describe('destinationsFromSegments', () => {
  it('treats a stop under 24 hours as a layover, not a destination', () => {
    const p = normalizeExtraction(
      raw({
        kind: 'flight_itinerary',
        segments: [
          seg('PTY', 'BOG', '2027-07-01 07:45', '2027-07-01 09:30'),
          seg('BOG', 'MAD', '2027-07-01 13:00', '2027-07-02 05:40', '', 'Madrid'),
          seg('MAD', 'PTY', '2027-07-12 11:00', '2027-07-12 16:20'),
        ],
      }),
      { fallbackCurrency: 'USD', reference: ref },
    );
    expect(p.layovers).toEqual(['BOG']);
    expect(p.stays).toEqual([
      { city: 'Madrid', iata: 'MAD', from: '2027-07-02', to: '2027-07-12' },
    ]);
    expect(p.outbound).toBe('2027-07-01');
    expect(p.inbound).toBe('2027-07-12');
  });

  it('finds two destinations in a multi-city ticket', () => {
    const route = destinationsFromSegments([
      {
        fromIata: 'PTY',
        toIata: 'MAD',
        fromCity: null,
        toCity: 'Madrid',
        departure: { date: toPlainDate('2027-07-01'), minutes: 600 },
        arrival: { date: toPlainDate('2027-07-02'), minutes: 300 },
        flightNumber: null,
      },
      {
        fromIata: 'MAD',
        toIata: 'CDG',
        fromCity: null,
        toCity: 'París',
        departure: { date: toPlainDate('2027-07-06'), minutes: 600 },
        arrival: { date: toPlainDate('2027-07-06'), minutes: 720 },
        flightNumber: null,
      },
      {
        fromIata: 'CDG',
        toIata: 'PTY',
        fromCity: null,
        toCity: null,
        departure: { date: toPlainDate('2027-07-10'), minutes: 600 },
        arrival: { date: toPlainDate('2027-07-10'), minutes: 960 },
        flightNumber: null,
      },
    ]);
    expect(route.stays.map((s) => s.iata)).toEqual(['MAD', 'CDG']);
    expect(route.inbound).toBe('2027-07-10');
  });
});

describe('normalizeExtraction — fixtures', () => {
  const itineraries: [
    string,
    RawExtraction,
    { amount: string; currency: string; stays: string[] },
  ][] = [
    [
      'Copa round trip in USD',
      raw({
        kind: 'flight_itinerary',
        provider: 'Copa Airlines',
        referenceCode: 'ABC123',
        totalAmount: '$1,200.00',
        currencyText: 'USD',
        segments: [
          seg('PTY', 'MIA', '2027-07-01 08:00', '2027-07-01 12:00', 'Panamá', 'Miami'),
          seg('MIA', 'PTY', '2027-07-08 13:00', '2027-07-08 16:00'),
        ],
        passengers: [
          { name: 'GARCIA/ANA MS', type: 'adult' },
          { name: 'GARCIA/LUIS MSTR', type: 'child' },
        ],
      }),
      { amount: '1200.00', currency: 'USD', stays: ['MIA'] },
    ],
    [
      'Iberia in euros, Spanish dates',
      raw({
        kind: 'flight_itinerary',
        provider: 'Iberia',
        totalAmount: '1.845,30 €',
        segments: [
          seg('PTY', 'MAD', '1 de julio de 2027 17:30', '2 de julio de 2027 09:10', '', 'Madrid'),
          seg('MAD', 'PTY', '15 de julio de 2027 12:00', '15 de julio de 2027 16:00'),
        ],
      }),
      { amount: '1845.30', currency: 'EUR', stays: ['MAD'] },
    ],
    [
      'Avianca with a Bogotá layover, US format',
      raw({
        kind: 'flight_itinerary',
        provider: 'Avianca',
        totalAmount: 'USD 980.50',
        segments: [
          seg('PTY', 'BOG', 'Jul 1, 2027 6:00 AM', 'Jul 1, 2027 7:30 AM'),
          seg('BOG', 'CUZ', 'Jul 1, 2027 11:00 AM', 'Jul 1, 2027 2:00 PM', '', 'Cusco'),
          seg('CUZ', 'PTY', 'Jul 9, 2027 3:00 PM', 'Jul 9, 2027 10:00 PM'),
        ],
      }),
      { amount: '980.50', currency: 'USD', stays: ['CUZ'] },
    ],
  ];

  it.each(itineraries)('%s', (_name, input, expected) => {
    const p = normalizeExtraction(input, { fallbackCurrency: 'USD', reference: ref });
    expect(p.kind).toBe('flight_itinerary');
    expect(p.amount).toBe(expected.amount);
    expect(p.currency).toBe(expected.currency);
    expect(p.stays.map((s) => s.iata)).toEqual(expected.stays);
    expect(p.category).toBe('flights');
  });

  const hotels: [string, RawExtraction, Partial<ReturnType<typeof normalizeExtraction>>][] = [
    [
      'Booking.com, paid, Madrid',
      raw({
        kind: 'lodging_confirmation',
        provider: 'Hotel Gran Vía',
        city: 'Madrid',
        country: 'ES',
        checkIn: 'jueves, 1 de julio de 2027',
        checkOut: 'miércoles, 7 de julio de 2027',
        totalAmount: '644,00 €',
        amountPaid: '644,00 €',
        breakfastIncluded: 'yes',
      }),
      {
        amount: '644.00',
        currency: 'EUR',
        nights: 6,
        breakfastIncluded: true,
        checkIn: toPlainDate('2027-07-01'),
      },
    ],
    [
      'Airbnb with a balance due, English',
      raw({
        kind: 'lodging_confirmation',
        provider: 'Airbnb',
        city: 'Lisbon',
        checkIn: 'Jul 7, 2027',
        checkOut: 'Jul 11, 2027',
        totalAmount: '€ 520.00',
        amountPaid: '€ 260.00',
        amountDue: '€ 260.00',
        dueDate: 'Jun 20, 2027',
      }),
      { amount: '520.00', nights: 4, amountDue: '260.00', dueDate: toPlainDate('2027-06-20') },
    ],
    [
      'Hotel paid at the property, French',
      raw({
        kind: 'lodging_confirmation',
        provider: 'Hôtel Lumière',
        city: 'Paris',
        checkIn: '11 juillet 2027',
        checkOut: '14 juillet 2027',
        totalAmount: '480,00 EUR',
        payAtProperty: 'yes',
        cityTaxPending: 'yes',
      }),
      { nights: 3, payAtProperty: true, cityTaxPending: true, currency: 'EUR' },
    ],
  ];

  it.each(hotels)('%s', (_name, input, expected) => {
    const p = normalizeExtraction(input, { fallbackCurrency: 'USD', reference: ref });
    expect(p).toMatchObject(expected);
    expect(p.category).toBe('lodging');
  });

  const receipts: [
    string,
    RawExtraction,
    {
      context?: { countryCode: string; countryCurrency: string };
      amount: string;
      currency: string;
      day: string;
      category: string;
    },
  ][] = [
    [
      'Madrid restaurant',
      raw({
        kind: 'receipt',
        provider: 'Casa Lucio',
        totalAmount: '68,50 €',
        datetimeLocal: '03/07/2027 21:40',
        categoryGuess: 'food',
        tip: '5,00',
      }),
      { amount: '68.50', currency: 'EUR', day: '2027-07-03', category: 'food' },
    ],
    [
      'Paris museum, French',
      raw({
        kind: 'ticket',
        provider: 'Musée du Louvre',
        totalAmount: '22,00 €',
        datetimeLocal: '12 juillet 2027',
      }),
      { amount: '22.00', currency: 'EUR', day: '2027-07-12', category: 'activities' },
    ],
    [
      'London taxi',
      raw({
        kind: 'receipt',
        provider: 'Black Cab',
        totalAmount: '£18.40',
        datetimeLocal: '14/08/2027 08:15',
        categoryGuess: 'local_transport',
      }),
      { amount: '18.40', currency: 'GBP', day: '2027-08-14', category: 'local_transport' },
    ],
    [
      'Bogotá, bare dollar sign in pesos',
      raw({
        kind: 'receipt',
        provider: 'Crepes & Waffles',
        totalAmount: '$ 85.900',
        datetimeLocal: '2027-02-10',
        categoryGuess: 'food',
      }),
      {
        context: { countryCode: 'CO', countryCurrency: 'COP' },
        amount: '85900',
        currency: 'COP',
        day: '2027-02-10',
        category: 'food',
      },
    ],
    [
      'Tokyo shop in yen',
      raw({
        kind: 'receipt',
        provider: 'Uniqlo Ginza',
        totalAmount: '¥4,990',
        datetimeLocal: '2027/04/03 15:20',
        categoryGuess: 'shopping',
      }),
      { amount: '4990', currency: 'JPY', day: '2027-04-03', category: 'shopping' },
    ],
    [
      'Orlando, US month-first',
      raw({
        kind: 'receipt',
        provider: 'Disney Springs',
        totalAmount: '$45.32',
        datetimeLocal: '07/04/2027 1:15 PM',
        categoryGuess: 'other',
      }),
      {
        context: { countryCode: 'US', countryCurrency: 'USD' },
        amount: '45.32',
        currency: 'USD',
        day: '2027-07-04',
        category: 'other',
      },
    ],
  ];

  it.each(receipts)('%s', (_name, input, expected) => {
    const p = normalizeExtraction(input, {
      fallbackCurrency: 'USD',
      reference: ref,
      ...(expected.context ?? {}),
    });
    expect(p.amount).toBe(expected.amount);
    expect(p.currency).toBe(expected.currency);
    expect(p.day).toBe(expected.day);
    expect(p.category).toBe(expected.category);
  });

  it('lowers confidence and flags the fields a person should check', () => {
    const p = normalizeExtraction(
      raw({ kind: 'receipt', totalAmount: 'ilegible', uncertainFields: ['provider'] }),
      { fallbackCurrency: 'USD', reference: ref },
    );
    expect(p.amount).toBeNull();
    expect(p.lowConfidence).toEqual(
      expect.arrayContaining(['provider', 'totalAmount', 'currency']),
    );
    expect(p.confidence).toBeLessThan(0.6);
  });

  it('never keeps a card number a receipt printed', () => {
    const p = normalizeExtraction(
      raw({ kind: 'receipt', provider: 'Tienda 4111-1111-1111-1111', totalAmount: '10' }),
      { fallbackCurrency: 'USD', reference: ref },
    );
    expect(p.provider).toBe('Tienda •••• 1111');
  });
});
