import { describe, expect, it } from 'vitest';

import { findTripGaps } from './trip-gaps';

const trip = { startDate: '2026-12-08', endDate: '2026-12-16' };

describe('findTripGaps', () => {
  it('finds nights that belong to no city', () => {
    const gaps = findTripGaps(trip, [
      {
        city: 'Venecia',
        arrivalDate: '2026-12-08',
        departureDate: '2026-12-11',
        lodgingMode: 'prepaid',
      },
      {
        city: 'Verona',
        arrivalDate: '2026-12-13',
        departureDate: '2026-12-16',
        lodgingMode: 'prepaid',
      },
    ]);
    expect(gaps).toEqual([{ kind: 'no_city', from: '2026-12-11', to: '2026-12-12' }]);
  });

  it('finds cities whose lodging is still undecided', () => {
    const gaps = findTripGaps(trip, [
      {
        city: 'Venecia',
        arrivalDate: '2026-12-08',
        departureDate: '2026-12-12',
        lodgingMode: 'prepaid',
      },
      {
        city: 'Como',
        arrivalDate: '2026-12-12',
        departureDate: '2026-12-16',
        lodgingMode: 'undecided',
      },
    ]);
    expect(gaps).toEqual([
      { kind: 'no_lodging', city: 'Como', from: '2026-12-12', to: '2026-12-15' },
    ]);
  });

  it('does not ask for lodging where none is needed', () => {
    expect(
      findTripGaps(trip, [
        {
          city: 'Casa',
          arrivalDate: '2026-12-08',
          departureDate: '2026-12-16',
          lodgingMode: 'none',
        },
      ]),
    ).toEqual([]);
  });

  it('reports a trip with no legs as one stretch without a city', () => {
    expect(findTripGaps(trip, [])).toEqual([
      { kind: 'no_city', from: '2026-12-08', to: '2026-12-15' },
    ]);
  });
});
