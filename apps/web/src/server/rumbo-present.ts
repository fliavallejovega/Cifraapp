import 'server-only';

import {
  activitiesOn,
  airbnbListing,
  airbnbPhotos,
  airbnbSearch,
  AIRPORTS,
  bookingSearch,
  googleMapsDirections,
  googleMapsSearch,
  PLACES,
  routeRequestsFor,
  stayDates,
  wazeTo,
  type Notice,
} from '@app/itinerary';
import type { getTranslations } from 'next-intl/server';

import type {
  Certainty,
  ClientDay,
  ClientDrive,
  ClientFlight,
  ClientLodging,
  ClientNotice,
  ClientPlace,
  ClientRumbo,
  ClientTodo,
} from '@/lib/rumbo-types';

import type { RumboPlace, RumboView } from './rumbo';

/**
 * Turns Rumbo's view into what the screens show: every figure formatted,
 * every warning a sentence, every link built. The engine speaks in codes; the
 * sentences live in the message catalogue and are chosen here, on the server.
 */

type T = Awaited<ReturnType<typeof getTranslations<'rumbo'>>>;

export interface Presenter {
  readonly t: T;
  readonly locale: string;
}

function duration(minutes: number, locale: string): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return locale === 'en' ? `${h} h ${m} min` : `${h} h ${m} min`;
}

function km(meters: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: meters < 10_000 ? 1 : 0 }).format(
    meters / 1000,
  );
}

function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function dayLabel(date: string, locale: string, style: 'long' | 'short'): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    month: style === 'long' ? 'long' : 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function shortDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function certaintyLabel(p: Presenter, c: Certainty, ticket = false): string {
  if (c === 'confirmed') return ticket ? p.t('certainty.ticket') : p.t('certainty.confirmed');
  return c === 'estimated' ? p.t('certainty.estimated') : p.t('certainty.unverified');
}

function airportCity(iata: string, view: RumboView): string {
  const city = AIRPORTS.get(iata)?.cityPlaceId;
  return city ? (view.places[city]?.name ?? PLACES.get(city)?.name ?? iata) : iata;
}

/** A notice in words. Unknown codes fall back to a neutral sentence rather than a raw key. */
export function noticeText(p: Presenter, n: Notice, view: RumboView): ClientNotice {
  const { t, locale } = p;
  const params: Record<string, string | number> = { ...(n.params ?? {}) };
  const place = (id: unknown) => (typeof id === 'string' ? (view.places[id]?.name ?? id) : '');
  let code = n.code;

  if (code.startsWith('winter_'))
    params['country'] = countryName(String(params['country'] ?? ''), locale);
  if (code === 'pass_may_close' || code === 'pass_closed') {
    params['pass'] = place(params['pass']);
    const alt = String(params['alternative'] ?? '');
    params['alternative'] =
      alt && t.has(`alternatives.${alt}`) ? t(`alternatives.${alt}`) : t('alternatives.ask');
  }
  if (code === 'mountain_after_dark' && !params['leaveBy'])
    code = 'mountain_after_dark_no_daylight';
  if (code === 'over_driving_budget') {
    params['driving'] = duration(Number(params['minutes'] ?? 0), locale);
    params['budget'] = duration(Number(params['budget'] ?? 0), locale);
  }
  if (code === 'border_day') {
    params['countries'] = String(params['countries'] ?? '')
      .split(' → ')
      .map((c) => countryName(c, locale))
      .join(' → ');
  }
  if (
    code === 'transfer_not_running' ||
    code === 'transfer_rush_hour' ||
    code === 'layover_visa_check'
  ) {
    params['airport'] = airportCity(String(params['airport'] ?? ''), view);
    if (params['mode']) params['mode'] = t(`timeline.modes.${String(params['mode'])}`);
  }
  if (code === 'ferry_book') params['duration'] = duration(Number(params['minutes'] ?? 0), locale);
  if (code === 'anchors_overlap') {
    params['from'] = place(params['from']);
    params['to'] = place(params['to']);
  }
  if (code === 'nights_unassigned') params['before'] = place(params['before']);
  if (code === 'wish_unmatched') {
    params['wish'] = view.wishes.find((w) => w.id === params['wish'])?.text ?? '';
  }
  for (const k of ['date', 'exit', 'until', 'arrival']) {
    const v = params[k];
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) params[k] = shortDate(v, locale);
  }
  if (typeof params['zone'] === 'string') {
    params['zone'] =
      params['zone'] === 'schengen' ? t('entry.schengen') : countryName(params['zone'], locale);
  }
  if (typeof params['passport'] === 'string')
    params['passport'] = countryName(params['passport'], locale);
  if (typeof params['items'] === 'string') {
    params['items'] = params['items']
      .split(',')
      .map((i) => t(`entry.mayAsk.${i}`))
      .join(', ');
  }
  const key = `notices.${code}`;
  return {
    severity: n.severity,
    text: t.has(key) ? t(key, params) : t('notices.unknown'),
  };
}

function clientPlace(p: RumboPlace): ClientPlace {
  return { id: p.id, name: p.name, country: p.country, lat: p.lat, lon: p.lon, kind: p.kind };
}

export function presentRoute(p: Presenter, view: RumboView): ClientRumbo {
  const { t, locale } = p;
  const it = view.itinerary;
  const places: Record<string, ClientPlace> = {};
  for (const [id, place] of Object.entries(view.places)) places[id] = clientPlace(place);
  const place = (id: string) => view.places[id];
  const name = (id: string) => place(id)?.name ?? PLACES.get(id)?.name ?? id;

  // The map shows the ground part; anything far outside it is «fuera del mapa».
  const groundPoints = (view.plan?.drives ?? [])
    .flatMap((d) => d.points)
    .map(place)
    .filter((x) => x !== undefined);
  const lats = groundPoints.map((g) => g.lat);
  const lons = groundPoints.map((g) => g.lon);
  const box =
    groundPoints.length > 0
      ? {
          south: Math.min(...lats) - 1,
          north: Math.max(...lats) + 1,
          west: Math.min(...lons) - 1.5,
          east: Math.max(...lons) + 1.5,
        }
      : null;
  const center = box ? { lat: (box.south + box.north) / 2, lon: (box.west + box.east) / 2 } : null;
  const outside = (q: { lat: number; lon: number }) =>
    box !== null &&
    (q.lat < box.south || q.lat > box.north || q.lon < box.west || q.lon > box.east);

  const days: ClientDay[] = (it?.days ?? []).map((d) => {
    const drives: ClientDrive[] = d.drives.map((dr) => {
      const pts = dr.points.map(place).filter((x) => x !== undefined);
      return {
        purpose: dr.purpose,
        points: dr.points,
        incomplete: dr.incomplete,
        pendingDriveId:
          routeRequestsFor(dr.points)
            .map((r) => view.driveRows.find((row) => row.key === `${r.mode}|${r.points.join('>')}`))
            .find((row) => row !== undefined && row.status !== 'routed')?.id ?? null,
        dayMapsUrl: googleMapsDirections(pts),
        legs: dr.legs.map((l) => {
          const to = place(l.to);
          return {
            from: l.from,
            to: l.to,
            fromName: name(l.from),
            toName: name(l.to),
            mode: l.mode,
            km: km(l.distanceM, locale),
            minutes: l.plannedMinutes,
            duration: duration(l.plannedMinutes, locale),
            routerDuration: duration(Math.ceil(l.durationS / 60), locale),
            mountain: l.mountain,
            maxElevation: l.maxElevationM ?? null,
            wazeUrl: to ? wazeTo(to) : '',
            mapsUrl: googleMapsDirections([place(l.from), to].filter((x) => x !== undefined)) ?? '',
            geometryKey: pieceKey(dr.points, l.from, l.to),
          };
        }),
      };
    });

    const flights: ClientFlight[] = d.flights.map((f) => {
      const seg = view.flights.find((s) => s.id === f.segmentId);
      return {
        segmentId: f.segmentId,
        title: seg ? `${airportCity(seg.from, view)} → ${airportCity(seg.to, view)}` : '',
        entries: f.entries.map((e) => {
          const diff = e.zoneDifferenceMinutes;
          const detailParts: string[] = [];
          if (diff !== undefined && diff !== 0) {
            const hours = diff / 60;
            detailParts.push(
              t('timeline.zone', {
                sign: hours > 0 ? '+' : '−',
                hours: Math.abs(hours).toString(),
              }),
            );
          }
          if (e.transfer) {
            detailParts.push(
              t('timeline.transfer', {
                mode: t(`timeline.modes.${e.transfer.mode}`),
                duration: duration(e.transfer.minutes, locale),
              }),
            );
          }
          const tz = e.at.timeZone.split('/').pop()?.replace(/_/g, ' ') ?? e.at.timeZone;
          return {
            step: e.step,
            label: t(`timeline.${e.step}`),
            time: e.at.time,
            place: e.airport ? `${e.airport} · ${tz}` : tz,
            certainty: e.certainty,
            certaintyLabel: certaintyLabel(
              p,
              e.certainty,
              e.step === 'departs' || e.step === 'arrives',
            ),
            detail: detailParts.length > 0 ? detailParts.join(' · ') : null,
          };
        }),
      };
    });

    const sleepPlace = d.sleep ? place(d.sleep.placeId) : undefined;
    const sleep =
      d.sleep && sleepPlace
        ? {
            name: sleepPlace.name,
            status: d.sleep.hosted
              ? ('hosted' as const)
              : d.sleep.paid
                ? ('paid' as const)
                : ('open' as const),
            statusLabel: d.sleep.hosted
              ? t('day.sleepHosted')
              : d.sleep.paid
                ? t('day.sleepPaid')
                : t('day.sleepOpen'),
          }
        : null;

    const focus = [
      ...new Set([...drives.flatMap((dr) => dr.points), ...(d.sleep ? [d.sleep.placeId] : [])]),
    ];
    const activityPlaces = [
      ...new Set([
        ...(d.sleep ? [d.sleep.placeId] : []),
        ...drives.flatMap((dr) => dr.points.slice(1, -1)),
      ]),
    ];
    const activities = activityPlaces.flatMap((pid) => {
      const { open, closed } = activitiesOn(pid, d.date);
      const where = name(pid);
      return [
        ...open.map((a) => ({ a, closed: false })),
        ...closed.map((a) => ({ a, closed: true })),
      ].map(({ a, closed: isClosed }) => ({
        name: a.name,
        place: where,
        mapUrl: googleMapsSearch(`${a.name}, ${where}`),
        url: a.url ?? null,
        needsBooking: a.needsBooking,
        closed: isClosed,
      }));
    });

    let offMap: string | null = null;
    if (center && sleepPlace && drives.length === 0 && outside(sleepPlace)) {
      offMap = t('days.offMap', { km: km(haversineKm(center, sleepPlace) * 1000, locale) });
    } else if (center && !sleepPlace && flights.length > 0) {
      const seg = view.flights.find((s) => s.id === flights[0]?.segmentId);
      const city = seg ? AIRPORTS.get(seg.from)?.cityPlaceId : undefined;
      const cityPlace = city ? (place(city) ?? PLACES.get(city)) : undefined;
      if (cityPlace && outside(cityPlace))
        offMap = t('days.offMap', { km: km(haversineKm(center, cityPlace) * 1000, locale) });
    }

    const firstPoint = drives[0]?.points[0];
    const lastPoint = drives[0]?.points[drives[0].points.length - 1];
    const title =
      d.kind === 'flight' && flights[0]
        ? t('day.titleFlight', { route: flights.map((f) => f.title).join(' · ') })
        : d.kind === 'drive' && firstPoint && lastPoint
          ? drives[0]?.purpose === 'day_trip'
            ? t('day.titleDayTrip', { place: name(drives[0].points[1] ?? lastPoint) })
            : t('day.titleDrive', { from: name(firstPoint), to: name(lastPoint) })
          : sleep
            ? t('day.titleRest', { place: sleep.name })
            : t('day.titleHome');

    return {
      date: d.date,
      index: d.index,
      label: dayLabel(d.date, locale, 'long'),
      shortLabel: dayLabel(d.date, locale, 'short'),
      kind: d.kind,
      title,
      sleep,
      sleepNote: sleep
        ? null
        : d.index === (it?.days.length ?? 0) - 1
          ? t('day.home')
          : t('day.plane'),
      flights,
      drives,
      drivingMinutes: d.drivingMinutes,
      driving: duration(d.drivingMinutes, locale),
      km: km(d.distanceM, locale),
      departure: d.departure?.time ?? null,
      arrival: d.estimatedArrival?.time ?? null,
      sunset: d.sunset?.time ?? null,
      routerNote:
        d.drivingMinutes > 0 && d.routerMinutes !== d.drivingMinutes
          ? t('day.routerNote', {
              router: duration(d.routerMinutes, locale),
              planned: duration(d.drivingMinutes, locale),
            })
          : null,
      notices: d.notices.map((n) => noticeText(p, n, view)),
      activities,
      offMap,
      focus,
    };
  });

  const totals = it?.totals;
  const summary = totals
    ? t('summary', {
        days: totals.days,
        nights: totals.lodgingNights,
        km: km(totals.distanceM, locale),
        hours: duration(totals.drivingMinutes, locale),
        drivingDays: totals.drivingDays,
      })
    : null;

  let sacrifices: string | null = null;
  const plan = view.plan;
  if (plan && plan.sacrifices.length > 0) {
    const wish = view.wishes.find((w) => w.outcome?.corridorId);
    const parts = plan.sacrifices.map((s) =>
      s.kind === 'place_removed'
        ? name(s.placeId)
        : t('sacrifices.nights', { count: s.nights, place: name(s.placeId) }),
    );
    const list = new Intl.ListFormat(locale, { type: 'conjunction' }).format(parts);
    sacrifices = t('sacrifices.sentence', { wish: wish?.text ?? t('sacrifices.yourWishes'), list });
    if (view.wishCostMinutes !== null && view.wishCostMinutes !== 0) {
      sacrifices += ` ${
        view.wishCostMinutes > 0
          ? t('sacrifices.costMore', { duration: duration(view.wishCostMinutes, locale) })
          : t('sacrifices.costLess', { duration: duration(-view.wishCostMinutes, locale) })
      }`;
    }
  }

  return {
    tripId: view.trip.id,
    name: view.trip.name,
    summary,
    composed: it !== null,
    days,
    places,
    geometry: view.geometry,
    sacrifices,
    tripNotices: (it?.notices ?? []).map((n) => noticeText(p, n, view)),
    routing: view.routing,
  };
}

/** The stored piece (car or ferry) a leg belongs to, as its geometry key. */
function pieceKey(points: readonly string[], from: string, to: string): string {
  for (const piece of routeRequestsFor(points)) {
    for (let i = 0; i + 1 < piece.points.length; i++) {
      if (piece.points[i] === from && piece.points[i + 1] === to)
        return `${piece.mode}|${piece.points.join('>')}`;
    }
  }
  return `car|${from}>${to}`;
}

export function presentLodging(p: Presenter, view: RumboView): ClientLodging {
  const { locale } = p;
  const lodging = view.lodging;
  return {
    currency: lodging.currency,
    capPerNight: view.trip.lodgingCap,
    notices: lodging.notices.map((n) => noticeText(p, n, view)),
    stops: lodging.stops.map((s) => {
      const dates = stayDates(s.stop.firstNight, s.stop.nights, lodging.adults);
      const cap = view.trip.lodgingCap ? Math.ceil(Number(view.trip.lodgingCap)) : undefined;
      return {
        legId: s.stop.legId,
        placeName: s.stop.placeName,
        dates: `${shortDate(dates.checkIn, locale)} – ${shortDate(dates.checkOut, locale)}`,
        nights: s.stop.nights,
        hosted: s.stop.hosted,
        paid: s.stop.paid,
        recommendedTotal: s.recommended?.total?.toDecimalString() ?? null,
        cheapestTotal: s.cheapest?.total?.toDecimalString() ?? null,
        myPrice: s.stop.myPrice?.toDecimalString() ?? null,
        unconvertedOptions: s.unconvertedOptions,
        airbnbSearchUrl: airbnbSearch(
          { name: s.stop.placeName.replace(/\s*\(.*\)$/, '') },
          s.countryName,
          dates,
          {
            ...(cap ? { priceMax: cap } : {}),
            currency: lodging.currency,
          },
        ),
        bookingSearchUrl: bookingSearch(s.stop.placeName.replace(/\s*\(.*\)$/, ''), dates),
        options: [...s.airbnb, ...s.hotels].map((o) => {
          const row = view.lodgingRows.find((r) => r.id === o.id);
          const listing = row?.listingId ?? null;
          return {
            id: o.id,
            provider: o.provider,
            name: o.name,
            kind: o.kind,
            rating: o.rating,
            reviews: o.reviews,
            total: o.total?.toDecimalString() ?? null,
            certainty: o.certainty,
            recommended: s.recommended?.id === o.id,
            cheapest: s.cheapest?.id === o.id,
            bookUrl:
              o.provider === 'airbnb' && listing
                ? airbnbListing(listing, dates)
                : (row?.url ?? null),
            photosUrl: o.provider === 'airbnb' && listing ? airbnbPhotos(listing, dates) : null,
          };
        }),
      };
    }),
  };
}

const CHARGE_NAMES: Readonly<Record<string, string>> = {
  'at-vignette-10d': 'atVignette',
  'ch-vignette-year': 'chVignette',
  'at-arlberg-tunnel': 'arlberg',
  'scandlines-puttgarden-rodby': 'scandlines',
};

export function presentTodos(p: Presenter, view: RumboView): ClientTodo[] {
  const { t, locale } = p;
  return view.todos
    .filter((todo) => todo.status !== 'dismissed')
    .map((todo) => {
      const params: Record<string, string> = { ...todo.params };
      for (const k of ['date', 'firstUse', 'pickup', 'dropoff']) {
        const v = params[k];
        if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) params[k] = shortDate(v, locale);
      }
      if (params['airport']) params['airport'] = airportCity(params['airport'], view);
      if (params['countries']) {
        params['countries'] = params['countries']
          .split(', ')
          .map((c) => countryName(c, locale))
          .join(', ');
      }
      if (params['price'] && params['currency']) {
        params['priceText'] = new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: params['currency'],
        }).format(Number(params['price']));
      } else {
        params['priceText'] = t('todos.priceUnknown');
      }
      const charge = params['id'] ? CHARGE_NAMES[params['id']] : undefined;
      const base = charge ? `todos.charges.${charge}` : `todos.kinds.${todo.kind}`;
      return {
        key: todo.key,
        title: t.has(`${base}.title`) ? t(`${base}.title`, params) : todo.key,
        reason: t.has(`${base}.reason`) ? t(`${base}.reason`, params) : '',
        country: todo.country,
        countryName: todo.country ? countryName(todo.country, locale) : t('todos.general'),
        url: todo.url,
        due: todo.dueOn ? shortDate(todo.dueOn, locale) : null,
        dueDate: todo.dueOn,
        saleOpens: todo.saleOpensOn
          ? t(todo.kind === 'event_tickets' ? 'todos.saleOpens' : 'todos.opens', {
              date: shortDate(todo.saleOpensOn, locale),
            })
          : null,
        overdue: todo.dueOn !== null && todo.dueOn < view.today && todo.status === 'pending',
        status: todo.status,
        confirmationCode: todo.confirmationCode,
        certaintyLabel: certaintyLabel(p, todo.certainty),
        source: todo.source
          ? {
              name: todo.source.name,
              url: todo.source.url,
              checked: shortDate(todo.source.checkedOn, locale),
            }
          : null,
        orphaned: todo.orphaned,
      };
    });
}

export { countryName, duration, shortDate };
