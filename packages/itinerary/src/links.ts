import { addDays, type PlainDate } from '@app/domain';

import type { Place } from './types.js';

/**
 * Links to the sites where the person books and navigates, with dates and
 * party size already filled in. Patterns verified against each site on
 * 2026-10-02. No photo from these sites is ever embedded: «Ver fotos» opens
 * the listing's own photo tour.
 */

export interface StayDates {
  readonly checkIn: PlainDate;
  readonly checkOut: PlainDate;
  readonly adults: number;
}

export function stayDates(firstNight: PlainDate, nights: number, adults: number): StayDates {
  return { checkIn: firstNight, checkOut: addDays(firstNight, nights), adults };
}

/** «Venice--Italy», the slug Airbnb's search uses. */
function airbnbSlug(place: Pick<Place, 'name'>, countryName: string): string {
  return `${place.name}--${countryName}`.replace(/\s+/g, '-');
}

export function airbnbSearch(
  place: Pick<Place, 'name'>,
  countryName: string,
  dates: StayDates,
  options: { readonly priceMax?: number; readonly currency?: string } = {},
): string {
  const q = new URLSearchParams({
    checkin: dates.checkIn,
    checkout: dates.checkOut,
    adults: String(dates.adults),
  });
  if (options.priceMax !== undefined) q.set('price_max', String(options.priceMax));
  if (options.currency) q.set('currency', options.currency);
  return `https://www.airbnb.com/s/${encodeURIComponent(airbnbSlug(place, countryName))}/homes?${q.toString()}`;
}

export function airbnbListing(listingId: string, dates: StayDates): string {
  const q = new URLSearchParams({
    check_in: dates.checkIn,
    check_out: dates.checkOut,
    adults: String(dates.adults),
  });
  return `https://www.airbnb.com/rooms/${encodeURIComponent(listingId)}?${q.toString()}`;
}

export function airbnbPhotos(listingId: string, dates: StayDates): string {
  return `${airbnbListing(listingId, dates)}&modal=PHOTO_TOUR_SCROLLABLE`;
}

export function bookingSearch(name: string, dates: StayDates): string {
  const q = new URLSearchParams({
    ss: name,
    checkin: dates.checkIn,
    checkout: dates.checkOut,
    group_adults: String(dates.adults),
    no_rooms: '1',
  });
  return `https://www.booking.com/searchresults.html?${q.toString()}`;
}

function placeQuery(p: Pick<Place, 'name' | 'lat' | 'lon'>): string {
  return `${p.lat},${p.lon}`;
}

export function wazeTo(p: Pick<Place, 'name' | 'lat' | 'lon'>): string {
  const q = new URLSearchParams({ ll: placeQuery(p), navigate: 'yes' });
  return `https://waze.com/ul?${q.toString()}`;
}

export function wazeSearch(text: string): string {
  const q = new URLSearchParams({ q: text, navigate: 'yes' });
  return `https://waze.com/ul?${q.toString()}`;
}

export function googleMapsSearch(text: string): string {
  const q = new URLSearchParams({ api: '1', query: text });
  return `https://www.google.com/maps/search/?${q.toString()}`;
}

/** Directions through every stop of a day; Google allows up to nine waypoints. */
export function googleMapsDirections(
  points: readonly Pick<Place, 'name' | 'lat' | 'lon'>[],
): string | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || points.length < 2) return null;
  const q = new URLSearchParams({
    api: '1',
    origin: placeQuery(first),
    destination: placeQuery(last),
    travelmode: 'driving',
  });
  const middle = points.slice(1, -1).slice(0, 9);
  if (middle.length > 0) q.set('waypoints', middle.map(placeQuery).join('|'));
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}
