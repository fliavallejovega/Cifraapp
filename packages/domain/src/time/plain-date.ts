/**
 * A calendar date with no time and no zone: `'2026-07-31'`.
 *
 * A transaction posted on July 31 happened on July 31 in every timezone. Storing
 * it as a timestamp means a user in one zone and a cron job in another disagree
 * about which month it belongs to — and a transaction that slides between months
 * corrupts budgets, statements and tax periods (ADR-006). So financial dates
 * never touch `Date` in application code; they are strings validated at the
 * boundary and compared lexicographically, which for ISO-8601 is chronological
 * order for free.
 */
declare const plainDateBrand: unique symbol;

export type PlainDate = string & { readonly [plainDateBrand]: true };

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isPlainDate(value: unknown): value is PlainDate {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;

  const [, year = '', month = '', day = ''] = match;
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const roundTrip = new Date(utc);

  // Rejects 2026-02-30 and friends, which `Date.UTC` would happily roll over.
  return (
    roundTrip.getUTCFullYear() === Number(year) &&
    roundTrip.getUTCMonth() === Number(month) - 1 &&
    roundTrip.getUTCDate() === Number(day)
  );
}

export function toPlainDate(value: string): PlainDate {
  if (!isPlainDate(value)) {
    throw new TypeError(`"${value}" is not a valid calendar date (expected YYYY-MM-DD).`);
  }
  return value;
}

export function plainDateFromParts(year: number, month: number, day: number): PlainDate {
  const text = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return toPlainDate(text);
}

/**
 * Today's date in a specific timezone. The zone is required: "today" is not a
 * server-side fact, it is a property of where the user is standing.
 */
export function todayIn(timeZone: string): PlainDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return toPlainDate(parts);
}

function toUtcMillis(date: PlainDate): number {
  const [year = '0', month = '1', day = '1'] = date.split('-');
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

function fromUtcMillis(millis: number): PlainDate {
  const date = new Date(millis);
  return plainDateFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

const MILLIS_PER_DAY = 86_400_000;

export function addDays(date: PlainDate, days: number): PlainDate {
  return fromUtcMillis(toUtcMillis(date) + days * MILLIS_PER_DAY);
}

export function addMonths(date: PlainDate, months: number): PlainDate {
  const [year = '0', month = '1', day = '1'] = date.split('-');
  const targetMonthIndex = Number(month) - 1 + months;
  const targetYear = Number(year) + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;

  // A statement due on the 31st still has to land in a 30-day month.
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return plainDateFromParts(targetYear, normalizedMonth + 1, Math.min(Number(day), lastDay));
}

export function daysBetween(from: PlainDate, to: PlainDate): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / MILLIS_PER_DAY);
}

export function comparePlainDates(a: PlainDate, b: PlainDate): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function isBefore(a: PlainDate, b: PlainDate): boolean {
  return a < b;
}

export function isAfter(a: PlainDate, b: PlainDate): boolean {
  return a > b;
}

export function startOfMonth(date: PlainDate): PlainDate {
  const [year = '0', month = '1'] = date.split('-');
  return plainDateFromParts(Number(year), Number(month), 1);
}

export function endOfMonth(date: PlainDate): PlainDate {
  const [year = '0', month = '1'] = date.split('-');
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return plainDateFromParts(Number(year), Number(month), lastDay);
}

/** `'2026-07'` — the key budgets, statements and closes are grouped by. */
export function monthKey(date: PlainDate): string {
  return date.slice(0, 7);
}

/** An inclusive span of calendar dates. */
export interface DateRange {
  readonly start: PlainDate;
  readonly end: PlainDate;
}

export function createDateRange(start: PlainDate, end: PlainDate): DateRange {
  if (isAfter(start, end)) {
    throw new RangeError(`Date range starts (${start}) after it ends (${end}).`);
  }
  return { start, end };
}

export function rangeContains(range: DateRange, date: PlainDate): boolean {
  return date >= range.start && date <= range.end;
}

export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}
