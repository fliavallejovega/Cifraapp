import { addDays, toPlainDate, type PlainDate } from '@app/domain';

import type { ZonedTime } from './types.js';

/**
 * Wall-clock times in named zones, converted through the platform's own time
 * zone database (`Intl`). Hours are never added by hand: a local time becomes
 * an instant, minutes are added to the instant, and the instant is read back
 * in whichever zone the screen needs. Daylight-saving changes are handled by
 * the database, not by this file.
 */

const MINUTE_MS = 60_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface Parts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function partsAt(epochMs: number, timeZone: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(epochMs)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out['year'] ?? 0,
    month: out['month'] ?? 0,
    day: out['day'] ?? 0,
    hour: out['hour'] ?? 0,
    minute: out['minute'] ?? 0,
  };
}

/** Minutes the zone is ahead of UTC at that instant (Rome in winter: 60). */
export function offsetMinutes(epochMs: number, timeZone: string): number {
  const p = partsAt(epochMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const floored = epochMs - (epochMs % MINUTE_MS);
  return (asUtc - floored) / MINUTE_MS;
}

function parseTime(time: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) throw new RangeError(`Not a HH:MM time: ${time}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new RangeError(`Not a HH:MM time: ${time}`);
  return { hour, minute };
}

/**
 * The instant a local wall-clock time names. A time skipped by a
 * daylight-saving jump resolves to the instant just after the gap; a repeated
 * one resolves to its first occurrence.
 */
export function toInstant(z: ZonedTime): number {
  const [y, m, d] = z.date.split('-').map(Number) as [number, number, number];
  const { hour, minute } = parseTime(z.time);
  const naive = Date.UTC(y, m - 1, d, hour, minute);
  // Two passes settle the offset on either side of a transition.
  let guess = naive - offsetMinutes(naive, z.timeZone) * MINUTE_MS;
  guess = naive - offsetMinutes(guess, z.timeZone) * MINUTE_MS;
  return guess;
}

/** The local wall-clock time of an instant in a zone. */
export function fromInstant(epochMs: number, timeZone: string): ZonedTime {
  const p = partsAt(epochMs, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: toPlainDate(`${p.year}-${pad(p.month)}-${pad(p.day)}`),
    time: `${pad(p.hour)}:${pad(p.minute)}`,
    timeZone,
  };
}

/** `z` moved by a number of minutes, read back in `toZone` (its own zone by default). */
export function addMinutes(z: ZonedTime, minutes: number, toZone: string = z.timeZone): ZonedTime {
  return fromInstant(toInstant(z) + minutes * MINUTE_MS, toZone);
}

/** Whole minutes from `a` to `b`, across zones. */
export function minutesBetween(a: ZonedTime, b: ZonedTime): number {
  return Math.round((toInstant(b) - toInstant(a)) / MINUTE_MS);
}

/** Hours `b`'s zone is ahead of `a`'s at `a`'s instant, e.g. Panama → Istanbul: 8. */
export function zoneDifferenceMinutes(at: ZonedTime, otherZone: string): number {
  const instant = toInstant(at);
  return offsetMinutes(instant, otherZone) - offsetMinutes(instant, at.timeZone);
}

/** Minutes after local midnight. */
export function minuteOfDay(z: ZonedTime): number {
  const { hour, minute } = parseTime(z.time);
  return hour * 60 + minute;
}

/** A local time on a day, from minutes after midnight (may roll into the next day). */
export function atMinute(date: PlainDate, minutes: number, timeZone: string): ZonedTime {
  const days = Math.floor(minutes / 1440);
  const rest = minutes - days * 1440;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: days === 0 ? date : addDays(date, days),
    time: `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`,
    timeZone,
  };
}
