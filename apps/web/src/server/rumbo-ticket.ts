import { AIRPORTS, estimateConnection, type FlightSegment } from '@app/itinerary';
import { parsePrintedDate, parsePrintedTime } from '@app/trip-engine';

/**
 * A booking pasted as text, read without a model.
 *
 * Airline confirmations print each journey as two airport codes followed by
 * two dates with times. This reads exactly that, for the airports Rumbo knows,
 * and nothing else: a line it cannot read is skipped, never guessed. A journey
 * longer than sixteen hours on a carrier with a hub in between becomes two
 * flights with the connection estimated — and said to be.
 *
 * Photos and PDFs go through Cifra's document reader instead.
 */

const HUBS: Readonly<Record<string, string>> = {
  TK: 'IST',
  LH: 'FRA',
  AF: 'CDG',
  KL: 'AMS',
  IB: 'MAD',
  CM: 'PTY',
  AV: 'BOG',
};
const CARRIER_NAMES: readonly (readonly [RegExp, string])[] = [
  [/turkish/i, 'TK'],
  [/lufthansa/i, 'LH'],
  [/air france/i, 'AF'],
  [/\bklm\b/i, 'KL'],
  [/iberia/i, 'IB'],
  [/copa/i, 'CM'],
  [/avianca/i, 'AV'],
];

const DATE_TIME =
  /(\d{1,2}[\s./-]+(?:[A-Za-zÁÉÍÓÚáéíóú]{3,10}\.?|\d{1,2})[\s./-]+\d{2,4}|\d{4}-\d{2}-\d{2})[^\d\n]{0,24}?(\d{1,2}:\d{2})/g;

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export interface ParsedTicket {
  readonly segments: readonly FlightSegment[];
  /** Lines that named two airports but whose times could not be read. */
  readonly unread: number;
}

export function parseTicketText(text: string, reference: string): ParsedTicket {
  const carrier =
    /\b(TK|LH|AF|KL|IB|CM|AV)\s?\d{2,4}\b/.exec(text)?.[1] ??
    CARRIER_NAMES.find(([re]) => re.test(text))?.[1] ??
    null;
  const lines = text.split(/\r?\n/);
  const segments: FlightSegment[] = [];
  let unread = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const codes = [...line.matchAll(/\b([A-Z]{3})\b/g)]
      .map((m) => m[1] ?? '')
      .filter((c) => AIRPORTS.has(c));
    if (codes.length < 2) continue;
    const from = AIRPORTS.get(codes[0] ?? '');
    const to = AIRPORTS.get(codes[1] ?? '');
    if (!from || !to || from.iata === to.iata) continue;
    const window = lines.slice(i, i + 4).join('\n');
    const stamps = [...window.matchAll(DATE_TIME)]
      .map((m) => ({
        date: parsePrintedDate(m[1] ?? '', { reference: reference as never }),
        minutes: parsePrintedTime(m[2] ?? ''),
      }))
      .filter(
        (s): s is { date: NonNullable<typeof s.date>; minutes: number } =>
          s.date !== null && s.minutes !== null,
      );
    const [dep, arr] = stamps;
    if (!dep || !arr) {
      unread += 1;
      continue;
    }
    const departs = { date: dep.date, time: hhmm(dep.minutes), timeZone: from.timeZone };
    const arrives = { date: arr.date, time: hhmm(arr.minutes), timeZone: to.timeZone };
    const hub = carrier ? HUBS[carrier] : undefined;
    const hours =
      (Date.parse(`${arrives.date}T${arrives.time}:00Z`) -
        Date.parse(`${departs.date}T${departs.time}:00Z`)) /
      3_600_000;
    if (hub && hub !== from.iata && hub !== to.iata && hours > 16) {
      const pair = estimateConnection(
        { from: from.iata, via: hub, to: to.iata, departs, arrives },
        [`t${String(i)}a`, `t${String(i)}b`],
      );
      if (pair) {
        segments.push(...pair);
        i += 1;
        continue;
      }
    }
    segments.push({
      id: `t${String(i)}`,
      from: from.iata,
      to: to.iata,
      departs,
      departsCertainty: 'confirmed',
      arrives,
      arrivesCertainty: 'confirmed',
    });
    i += 1;
  }
  return { segments, unread };
}
