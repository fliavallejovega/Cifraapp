import { describe, expect, it } from 'vitest';

import { normalizeQuickTrip, type RawQuickTrip } from './trip-quick';

const empty: RawQuickTrip = {
  name: '',
  legs: [],
  adults: '',
  children: '',
  infants: '',
  budget_amount: '',
  budget_currency: '',
  budget_scope: 'unknown',
  style: 'unknown',
};
const ctx = { today: '2026-10-01', currency: 'USD' };

describe('normalizeQuickTrip', () => {
  it('chains legs and computes departures from nights', () => {
    const trip = normalizeQuickTrip(
      {
        ...empty,
        name: 'Navidad en Europa',
        legs: [
          {
            city: 'Madrid',
            country: 'ES',
            arrival_date: '2026-12-10',
            departure_date: '',
            nights: '4',
          },
          {
            city: 'Lisboa',
            country: 'PT',
            arrival_date: '',
            departure_date: '2026-12-20',
            nights: '',
          },
        ],
      },
      ctx,
    );
    expect(trip.legs.map((l) => [l.city, l.arrivalDate, l.departureDate, l.localCurrency])).toEqual(
      [
        ['Madrid', '2026-12-10', '2026-12-14', 'EUR'],
        ['Lisboa', '2026-12-14', '2026-12-20', 'EUR'],
      ],
    );
    expect(trip.dropped).toEqual([]);
  });

  it('drops past dates instead of guessing a year', () => {
    const trip = normalizeQuickTrip(
      {
        ...empty,
        legs: [
          {
            city: 'Bogotá',
            country: 'CO',
            arrival_date: '2025-12-10',
            departure_date: '2025-12-12',
            nights: '',
          },
        ],
      },
      ctx,
    );
    expect(trip.legs).toEqual([]);
    expect(trip.dropped).toContain('dates');
  });

  it('turns a per-person amount into a total by exact arithmetic', () => {
    const trip = normalizeQuickTrip(
      {
        ...empty,
        adults: '2',
        children: '1',
        budget_amount: '1500.50',
        budget_scope: 'per_person',
      },
      ctx,
    );
    expect(trip.totalBudget).toBe('4501.50');
    expect(trip.travelers).toEqual({ adults: 2, children: 1, infants: 0 });
  });

  it('refuses a budget in a currency the household does not keep', () => {
    const trip = normalizeQuickTrip(
      { ...empty, budget_amount: '3000', budget_currency: 'EUR', budget_scope: 'total' },
      ctx,
    );
    expect(trip.totalBudget).toBeNull();
    expect(trip.dropped).toContain('currency');
  });

  it('spreads a shared date range evenly over the places', () => {
    const trip = normalizeQuickTrip(
      {
        ...empty,
        legs: [
          {
            city: 'Madrid',
            country: 'ES',
            arrival_date: '2026-12-10',
            departure_date: '',
            nights: '',
          },
          {
            city: 'Lisboa',
            country: 'PT',
            arrival_date: '',
            departure_date: '2026-12-20',
            nights: '',
          },
        ],
      },
      ctx,
    );
    expect(trip.legs.map((l) => [l.arrivalDate, l.departureDate])).toEqual([
      ['2026-12-10', '2026-12-15'],
      ['2026-12-15', '2026-12-20'],
    ]);
  });
});
