import 'server-only';

import { documents, tripAnchors, tripFlightSegments, tripPlaces } from '@app/database/schema';
import { toPlainDate, type PlainDate } from '@app/domain';
import { AIRPORTS, estimateConnection, PLACES, type FlightSegment } from '@app/itinerary';
import type { Proposal } from '@app/trip-engine';
import { and, eq } from 'drizzle-orm';

import type { Tx } from './trip-ledger';

/**
 * What Rumbo learns from a document the family confirmed.
 *
 * The same reader that files a hotel or a ticket into the budget gives Rumbo
 * its fixed points: flights become segments with the printed times marked
 * «En su boleto», a hotel becomes a paid stay, a ticket becomes an event.
 * Only confirmed documents count — a proposal waiting for review moves
 * nothing — and the times the document does not print are estimated and
 * said to be.
 */

/** Hubs by airline code, for tickets that print only origin and destination. */
const CARRIER_HUB: Readonly<Record<string, string>> = {
  TK: 'IST',
  LH: 'FRA',
  AF: 'CDG',
  KL: 'AMS',
  IB: 'MAD',
  CM: 'PTY',
  AV: 'BOG',
};

/** A one-stop ticket longer than this almost certainly connects. */
const CONNECTION_MINUTES = 16 * 60;

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** The catalog place a printed city name refers to, if the catalog knows it. */
export function catalogPlaceFor(city: string | null): string | null {
  if (!city) return null;
  const wanted = normalize(city);
  for (const p of PLACES.values()) {
    const name = normalize(p.name);
    if (
      name === wanted ||
      name.startsWith(`${wanted} `) ||
      name.includes(`(${wanted})`) ||
      wanted.includes(name)
    ) {
      return p.id;
    }
  }
  const aliases: Readonly<Record<string, string>> = {
    venice: 'venezia',
    copenhagen: 'kobenhavn',
    kobenhavn: 'kobenhavn',
    cologne: 'koeln',
    koln: 'koeln',
    munich: 'muenchen',
    zurich: 'zurich',
    istanbul: 'istanbul',
  };
  return aliases[wanted] ?? null;
}

export interface RumboDocumentOutcome {
  readonly segments: number;
  readonly anchors: number;
  /** Cities the catalog does not know; Rumbo asks the person to place them. */
  readonly unplaced: readonly string[];
}

function segmentsFromProposal(p: Proposal): FlightSegment[] {
  const out: FlightSegment[] = [];
  const carrier = p.segments.find((s) => s.flightNumber)?.flightNumber?.slice(0, 2) ?? null;
  for (const [i, s] of p.segments.entries()) {
    const from = s.fromIata ? AIRPORTS.get(s.fromIata) : undefined;
    const to = s.toIata ? AIRPORTS.get(s.toIata) : undefined;
    if (!from || !to || !s.departure || !s.arrival) continue;
    if (s.departure.minutes === null || s.arrival.minutes === null) continue;
    const departs = {
      date: s.departure.date,
      time: hhmm(s.departure.minutes),
      timeZone: from.timeZone,
    };
    const arrives = { date: s.arrival.date, time: hhmm(s.arrival.minutes), timeZone: to.timeZone };
    const hub = carrier ? CARRIER_HUB[carrier] : undefined;
    const elapsed =
      (Date.parse(`${arrives.date}T${arrives.time}Z`) -
        Date.parse(`${departs.date}T${departs.time}Z`)) /
      60_000;
    if (hub && hub !== from.iata && hub !== to.iata && elapsed > CONNECTION_MINUTES) {
      const pair = estimateConnection(
        { from: from.iata, via: hub, to: to.iata, departs, arrives },
        [`d${i}a`, `d${i}b`],
      );
      if (pair) {
        out.push(...pair);
        continue;
      }
    }
    out.push({
      id: `d${i}`,
      from: from.iata,
      to: to.iata,
      departs,
      departsCertainty: 'confirmed',
      arrives,
      arrivesCertainty: 'confirmed',
      ...(s.flightNumber ? { number: s.flightNumber } : {}),
    });
  }
  return out;
}

function local(z: { date: PlainDate; time: string }): string {
  return `${z.date} ${z.time}:00`;
}

/** Ensures the trip has a row for a catalog place and returns its id. */
async function placeRow(
  tx: Tx,
  householdId: string,
  tripId: string,
  catalogId: string,
): Promise<string | null> {
  const [existing] = await tx
    .select({ id: tripPlaces.id })
    .from(tripPlaces)
    .where(and(eq(tripPlaces.tripId, tripId), eq(tripPlaces.catalogId, catalogId)))
    .limit(1);
  if (existing) return existing.id;
  const p = PLACES.get(catalogId);
  if (!p) return null;
  const [row] = await tx
    .insert(tripPlaces)
    .values({
      householdId,
      tripId,
      catalogId: p.id,
      name: p.name,
      countryCode: p.country,
      lat: p.lat.toFixed(6),
      lon: p.lon.toFixed(6),
      timeZone: p.timeZone,
      kind: p.kind,
      altitudeM: p.altitudeM ?? null,
      certainty: 'estimated',
    })
    .returning({ id: tripPlaces.id });
  return row?.id ?? null;
}

export async function rumboFromDocument(
  tx: Tx,
  householdId: string,
  tripId: string,
  documentId: string,
  bookingId: string | null,
): Promise<RumboDocumentOutcome> {
  const [doc] = await tx
    .select({ extraction: documents.tripExtraction })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.householdId, householdId)))
    .limit(1);
  const proposal = doc?.extraction as unknown as Proposal | null;
  if (!proposal) return { segments: 0, anchors: 0, unplaced: [] };

  let segments = 0;
  let anchors = 0;
  const unplaced: string[] = [];

  if (proposal.kind === 'flight_itinerary' || proposal.kind === 'boarding_pass') {
    const existing = await tx
      .select({ from: tripFlightSegments.fromIata, departs: tripFlightSegments.departsLocal })
      .from(tripFlightSegments)
      .where(eq(tripFlightSegments.tripId, tripId));
    const seen = new Set(existing.map((e) => `${e.from}@${e.departs.slice(0, 16)}`));
    for (const [position, s] of segmentsFromProposal(proposal).entries()) {
      const key = `${s.from}@${local(s.departs).slice(0, 16)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await tx.insert(tripFlightSegments).values({
        householdId,
        tripId,
        bookingId,
        documentId,
        position,
        flightNumber: s.number?.replace(/\s+/g, '') ?? null,
        fromIata: s.from,
        toIata: s.to,
        departsLocal: local(s.departs),
        departsTz: s.departs.timeZone,
        departsCertainty: s.departsCertainty,
        arrivesLocal: local(s.arrives),
        arrivesTz: s.arrives.timeZone,
        arrivesCertainty: s.arrivesCertainty,
        recordLocator:
          proposal.referenceCode && /^[A-Z0-9]{5,8}$/.test(proposal.referenceCode)
            ? proposal.referenceCode
            : null,
      });
      segments += 1;
    }
  }

  if (proposal.kind === 'lodging_confirmation' && proposal.checkIn && proposal.checkOut) {
    const catalogId = catalogPlaceFor(proposal.city);
    const placeId = catalogId ? await placeRow(tx, householdId, tripId, catalogId) : null;
    if (placeId) {
      const lastNight = toPlainDate(
        new Date(Date.parse(proposal.checkOut) - 86_400_000).toISOString().slice(0, 10),
      );
      await tx.insert(tripAnchors).values({
        householdId,
        tripId,
        kind: 'stay',
        placeId,
        fromDate: proposal.checkIn,
        toDate: lastNight,
        paid: proposal.payAtProperty !== true,
        label: proposal.provider?.slice(0, 120) ?? null,
        certainty: 'confirmed',
        documentId,
        bookingId,
      });
      anchors += 1;
    } else if (proposal.city) {
      unplaced.push(proposal.city);
    }
  }

  if (proposal.kind === 'ticket' && proposal.day) {
    const catalogId = catalogPlaceFor(proposal.city ?? proposal.provider);
    const placeId = catalogId ? await placeRow(tx, householdId, tripId, catalogId) : null;
    if (placeId) {
      await tx.insert(tripAnchors).values({
        householdId,
        tripId,
        kind: 'event',
        placeId,
        fromDate: proposal.day,
        toDate: proposal.day,
        paid: true,
        label: proposal.provider?.slice(0, 120) ?? null,
        certainty: 'confirmed',
        documentId,
        bookingId,
      });
      anchors += 1;
    } else if (proposal.city ?? proposal.provider) {
      unplaced.push(proposal.city ?? proposal.provider ?? '');
    }
  }

  return { segments, anchors, unplaced };
}
