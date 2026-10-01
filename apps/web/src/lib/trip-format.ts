/**
 * Formatting for trip figures in any currency.
 *
 * `formatMoney` in `@app/domain` speaks only the household's currencies; a trip
 * shows euros, pesos and yen beside them. Amounts arrive as decimal strings
 * and go to `Intl.NumberFormat` as strings, which formats them exactly — no
 * float ever carries a figure on its way to the screen.
 */

const intlLocale = (locale: string): string => (locale === 'en' ? 'en-US' : 'es-PA');

const cache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, currency: string, whole: boolean): Intl.NumberFormat {
  const key = `${locale}|${currency}|${String(whole)}`;
  let format = cache.get(key);
  if (!format) {
    format = new Intl.NumberFormat(intlLocale(locale), {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      ...(whole ? { maximumFractionDigits: 0, minimumFractionDigits: 0 } : {}),
    });
    cache.set(key, format);
  }
  return format;
}

/** `'165.00'`, `'EUR'` → «€165,00» in Spanish or «€165.00» in English. Always with its currency. */
export function formatAmount(
  value: string,
  currency: string,
  locale: string,
  options: { whole?: boolean } = {},
): string {
  const clean = value.trim() === '' ? '0' : value.trim();
  try {
    return formatter(locale, currency, options.whole ?? false).format(clean as `${number}`);
  } catch {
    return `${currency} ${clean}`;
  }
}

/** A base figure with its local equivalent beside it, when there is one. */
export function formatDual(
  base: { value: string; currency: string },
  local: { value: string | null; currency: string | null },
  locale: string,
): string {
  const head = formatAmount(base.value, base.currency, locale);
  if (!local.value || !local.currency || local.currency === base.currency) return head;
  return `${formatAmount(local.value, local.currency, locale)} · ${head}`;
}

/** «1–7 jul 2027», «28 dic 2027 – 3 ene 2028». */
export function formatDateRange(start: string, end: string, locale: string): string {
  const s = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  const format = new Intl.DateTimeFormat(intlLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  try {
    return format.formatRange(s, e);
  } catch {
    return `${format.format(s)} – ${format.format(e)}`;
  }
}

export function formatDay(
  value: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' },
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone: 'UTC' }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

/** Whole days from `today` to `date` (negative when it has passed). */
export function daysFrom(today: string, date: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

/** Share of `part` in `whole`, 0–100, from decimal strings without floats on the money itself. */
export function shareOf(part: string, whole: string): number {
  const toCents = (v: string): bigint => {
    const negative = v.trim().startsWith('-');
    const [w = '0', f = ''] = v.trim().replace(/^-/, '').split('.');
    const units = BigInt(w || '0') * 100n + BigInt((f + '00').slice(0, 2));
    return negative ? -units : units;
  };
  const p = toCents(part);
  const w = toCents(whole);
  if (w <= 0n) return 0;
  const bounded = p < 0n ? 0n : p > w ? w : p;
  return Number((bounded * 1000n) / w) / 10;
}
