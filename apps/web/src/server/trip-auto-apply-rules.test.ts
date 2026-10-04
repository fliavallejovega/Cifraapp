import type { PlainDate } from '@app/domain';
import type { Proposal } from '@app/trip-engine';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { decideAutoApply, type TripFacts } from './trip-auto-apply-rules';

/**
 * When a document moves the trip by itself.
 *
 * The household chose: a hotel or a flight that fits is applied and they are
 * told; anything that clashes waits for them with the before and the after.
 * These pin the line between the two.
 */

const d = (value: string) => value as PlainDate;

function proposal(overrides: Partial<Proposal>): Proposal {
  return {
    kind: 'lodging_confirmation',
    kindConfidence: 0.95,
    provider: 'Hotel Danieli',
    referenceCode: 'ABC123',
    amount: '640.00',
    currency: 'EUR',
    currencyAmbiguous: false,
    amountPaid: null,
    amountDue: null,
    dueDate: null,
    city: 'Venecia',
    countryCode: 'IT',
    checkIn: d('2026-12-10'),
    checkOut: d('2026-12-12'),
    nights: 2,
    payAtProperty: false,
    cityTaxPending: null,
    breakfastIncluded: null,
    cancellationDeadline: null,
    purchaseDate: null,
    day: null,
    tip: null,
    tax: null,
    paymentMethod: null,
    category: null,
    segments: [],
    stays: [],
    outbound: null,
    inbound: null,
    layovers: [],
    passengers: [],
    lowConfidence: [],
    confidence: 0.92,
    ...overrides,
  };
}

const trip: TripFacts = {
  tripId: '00000000-0000-7000-8000-000000000001',
  start: d('2026-12-08'),
  end: d('2026-12-20'),
  base: 'USD',
  rates: { EUR: '0.92' },
  stays: [
    {
      source: 'leg',
      catalogId: null,
      city: 'Venecia',
      from: d('2026-12-10'),
      to: d('2026-12-11'),
      label: null,
    },
    {
      source: 'leg',
      catalogId: null,
      city: 'Verona',
      from: d('2026-12-12'),
      to: d('2026-12-13'),
      label: null,
    },
  ],
};

describe('decideAutoApply', () => {
  it('applies a hotel in the city the trip already plans for those nights', () => {
    const decision = decideAutoApply(proposal({}), trip);
    expect(decision.kind).toBe('apply');
    if (decision.kind !== 'apply') return;
    expect(decision.input.lodging).toMatchObject({
      city: 'Venecia',
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
      lodgingMode: 'prepaid',
    });
    expect(decision.input.booking).toMatchObject({
      bookingType: 'lodging',
      amount: '640.00',
      currency: 'EUR',
      fxRate: '0.92',
      paymentStatus: 'paid',
      payment: null,
    });
  });

  it('applies a hotel on nights nothing else claims, so the city lands on those days', () => {
    const decision = decideAutoApply(
      proposal({ city: 'Bolzano', checkIn: d('2026-12-15'), checkOut: d('2026-12-17') }),
      trip,
    );
    expect(decision.kind).toBe('apply');
  });

  it('sends a hotel in another city on planned nights to review, with both sides', () => {
    const decision = decideAutoApply(
      proposal({ city: 'Como', checkIn: d('2026-12-11'), checkOut: d('2026-12-13') }),
      trip,
    );
    expect(decision).toEqual({
      kind: 'review',
      reason: 'conflict',
      conflict: {
        from: '2026-12-11',
        to: '2026-12-11',
        plannedCity: 'Venecia',
        plannedLabel: null,
        incomingCity: 'Como',
      },
    });
  });

  it('does not book a second hotel on nights another hotel already has', () => {
    const booked: TripFacts = {
      ...trip,
      stays: [
        {
          source: 'anchor',
          catalogId: 'venezia',
          city: 'Venecia',
          from: d('2026-12-10'),
          to: d('2026-12-11'),
          label: 'Hotel A',
        },
      ],
    };
    const decision = decideAutoApply(proposal({}), booked);
    expect(decision).toMatchObject({ kind: 'review', reason: 'already_planned' });
  });

  it('waits for a person when the reader doubted a date or the total', () => {
    expect(decideAutoApply(proposal({ lowConfidence: ['check_in'] }), trip)).toMatchObject({
      kind: 'review',
      reason: 'unsure',
    });
    expect(decideAutoApply(proposal({ amount: null }), trip)).toMatchObject({ reason: 'unsure' });
    expect(decideAutoApply(proposal({ confidence: 0.5 }), trip)).toMatchObject({
      reason: 'unsure',
    });
  });

  it('waits when the currency has no planning rate', () => {
    expect(decideAutoApply(proposal({ currency: 'CHF' }), trip)).toMatchObject({
      reason: 'no_rate',
    });
  });

  it('waits when the hotel falls outside the trip', () => {
    expect(
      decideAutoApply(proposal({ checkIn: d('2027-01-02'), checkOut: d('2027-01-04') }), trip),
    ).toMatchObject({ reason: 'outside_trip' });
  });

  it('applies a flight inside the trip and leaves receipts to a person', () => {
    const flight = proposal({
      kind: 'flight_itinerary',
      city: null,
      checkIn: null,
      checkOut: null,
      currency: 'USD',
      amount: '1840.00',
      outbound: d('2026-12-08'),
      inbound: d('2026-12-20'),
      segments: [
        {
          fromIata: 'PTY',
          toIata: 'IST',
          fromCity: null,
          toCity: null,
          departure: { date: d('2026-12-08'), minutes: 1200 },
          arrival: { date: d('2026-12-09'), minutes: 900 },
          flightNumber: 'TK800',
        },
      ],
    });
    const decision = decideAutoApply(flight, trip);
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      expect(decision.input.booking).toMatchObject({ bookingType: 'flight', fxRate: null });
    }
    expect(decideAutoApply(proposal({ kind: 'receipt' }), trip)).toMatchObject({
      reason: 'not_eligible',
    });
  });
});
