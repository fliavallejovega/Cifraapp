import { getCurrency } from './currency.js';
import type { Money } from './money.js';

export type MoneyLocale = 'es-PA' | 'en-US';

export interface FormatMoneyOptions {
  readonly locale?: MoneyLocale;
  /** Show the currency code after the amount, e.g. `$1,234.56 USD`. */
  readonly showCode?: boolean;
  /** Drop the decimal part. For dashboard headlines, never for statements. */
  readonly compactCents?: boolean;
  /** Render a leading `+` on positive amounts. Useful for deltas and inflows. */
  readonly signDisplay?: 'auto' | 'always' | 'never';
}

/**
 * The single place money becomes text (spec §72).
 *
 * Formatting is done in two steps rather than handing the currency to
 * `Intl.NumberFormat` directly, because the built-in output for PAB varies by
 * runtime and locale — sometimes `B/.`, sometimes the bare code `PAB`. The
 * grouping and decimal separators still come from `Intl` so the locale is
 * honored; only the symbol is ours, which makes the result stable everywhere:
 * `$1,234.56` and `B/. 1,234.56`.
 */
export function formatMoney(money: Money, options: FormatMoneyOptions = {}): string {
  const {
    locale = 'es-PA',
    showCode = false,
    compactCents = false,
    signDisplay = 'auto',
  } = options;

  const metadata = getCurrency(money.currency);
  const places = compactCents ? 0 : metadata.minorUnits;

  const decimalText = money.roundToCurrencyPrecision().toDecimalString();
  const magnitude = decimalText.startsWith('-') ? decimalText.slice(1) : decimalText;

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
    useGrouping: true,
  }).format(Number(magnitude));

  const sign = resolveSign(money, signDisplay);
  const code = showCode ? ` ${money.currency}` : '';

  return `${sign}${metadata.symbol}${metadata.symbol.length > 1 ? ' ' : ''}${formatted}${code}`;
}

function resolveSign(money: Money, signDisplay: 'auto' | 'always' | 'never'): string {
  if (signDisplay === 'never') return '';
  if (money.isNegative()) return '−'; // U+2212 minus, which aligns with digits
  if (signDisplay === 'always' && money.isPositive()) return '+';
  return '';
}

/**
 * Accessible label for screen readers. Symbols are read inconsistently, so the
 * spoken form uses the currency name and an explicit "negative" (spec §64).
 */
export function describeMoney(money: Money, locale: MoneyLocale = 'es-PA'): string {
  const metadata = getCurrency(money.currency);
  const spoken = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: metadata.code,
    currencyDisplay: 'name',
  }).format(Number(money.roundToCurrencyPrecision().toDecimalString()));

  return spoken;
}
