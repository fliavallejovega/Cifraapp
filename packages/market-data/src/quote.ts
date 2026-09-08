import { Money, type CurrencyCode } from '@app/domain';

/**
 * A quote, and what a household's holding is worth at it.
 *
 * The whole package exists to keep one boundary sharp: a **quantity** is what
 * a household states, and a **price** is what somebody else says. Everything
 * here carries where the price came from and when it was taken, because a
 * financial screen showing a stale figure as current is worse than one showing
 * nothing at all — and the only way to avoid that is to make the moment
 * impossible to drop.
 *
 * This package computes and converts. It does not decide, recommend, or
 * predict: valuing what somebody already owns is arithmetic, and it is the
 * only thing about markets this product will do.
 */

/**
 * What kind of thing a holding is, in the provider's terms rather than ours.
 *
 * Six, and deliberately not seven: there is no `bond`. No market data provider
 * classifies a bond fund as a bond — it classifies it as a fund that holds
 * debt — and a household that owns `BND` owns an ETF. Adding the word here
 * would put a classification on a screen that nobody stated, which is the one
 * thing this package is built not to do. Debt is searchable; it is not a type.
 */
export type HoldingKind = 'equity' | 'etf' | 'fund' | 'crypto' | 'index' | 'other';

export interface Quote {
  /** As the provider names it: `AAPL`, `VOO`, `BTC-USD`. */
  readonly symbol: string;
  readonly kind: HoldingKind;
  readonly displayName: string;
  /** Up to eight decimals, as text. A price is not money and does not round to cents. */
  readonly price: string;
  readonly currency: CurrencyCode;
  /** The previous session's close, when the provider gives one. */
  readonly previousClose: string | null;
  readonly source: string;
  readonly asOf: Date;
}

export interface Valuation {
  readonly value: Money;
  /** Change against the previous close, in money. Null when there is no close to compare. */
  readonly change: Money | null;
  /** The same change as a fraction: 0.0125 is +1.25%. Null for the same reason. */
  readonly changeRatio: number | null;
  readonly quote: Quote;
  /** How old the quote is, in minutes, at the moment of asking. */
  readonly ageMinutes: number;
}

/** Scaled integer arithmetic, so a price with eight decimals never meets a float. */
const SCALE = 10n ** 12n;

function toScaled(decimal: string): bigint {
  const negative = decimal.startsWith('-');
  const [whole = '0', fraction = ''] = decimal.replace('-', '').split('.');
  const padded = (fraction + '000000000000').slice(0, 12);
  const value = BigInt(whole) * SCALE + BigInt(padded || '0');
  return negative ? -value : value;
}

/**
 * A product of two scaled values back to a decimal string with four places.
 *
 * Both operands carry twelve decimals, so their product carries
 * twenty-four — and the divisor here has to undo exactly that, leaving the
 * four that money is stored with. Getting this wrong is silent: the digits are
 * all correct and the decimal point is in the wrong place, so ten Apple shares
 * came out at three quadrillion dollars and every type check passed.
 *
 * Four places, because this is where a computed quantity becomes money and
 * `numeric(19,4)` is what money is. A holding worth a fraction of a cent
 * rounds to zero, which is the correct answer to «what is this worth».
 */
function toMoneyString(scaled: bigint): string {
  const divisor = 10n ** 20n;
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const rounded = (magnitude + divisor / 2n) / divisor;
  const whole = rounded / 10000n;
  const fraction = (rounded % 10000n).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

/**
 * What a quantity of something is worth at a quote.
 *
 * The currency is the quote's, not the household's. Converting between them is
 * a separate decision with its own rate and its own source, and doing it
 * silently here would bury an exchange rate inside a multiplication.
 */
export function valueOf(quantity: string, quote: Quote, now = new Date()): Valuation {
  const units = toScaled(quantity) * toScaled(quote.price);
  const value = Money.fromDecimalString(toMoneyString(units), quote.currency);

  const previous =
    quote.previousClose === null
      ? null
      : Money.fromDecimalString(
          toMoneyString(toScaled(quantity) * toScaled(quote.previousClose)),
          quote.currency,
        );

  const change = previous ? value.subtract(previous) : null;
  const previousAmount = previous ? Number(previous.toDecimalString()) : 0;

  return {
    value,
    change,
    // A ratio against a previous value of zero is not infinity, it is nothing:
    // there is no percentage change from having had none.
    changeRatio:
      change && previousAmount !== 0 ? Number(change.toDecimalString()) / previousAmount : null,
    quote,
    ageMinutes: Math.max(0, Math.round((now.getTime() - quote.asOf.getTime()) / 60000)),
  };
}

/**
 * Whether a quote is old enough that showing it as current would mislead.
 *
 * Deliberately generous for equities and tight for crypto, because the two
 * behave differently: a stock price from an hour ago is roughly right unless
 * the market moved, and a crypto price from an hour ago can be wrong by a
 * fifth. Either way the screen shows the moment; this only decides whether it
 * also says so out loud.
 */
export function isStale(quote: Quote, now = new Date()): boolean {
  const minutes = (now.getTime() - quote.asOf.getTime()) / 60000;
  return quote.kind === 'crypto' ? minutes > 15 : minutes > 24 * 60;
}

/** Sums valuations that share a currency. Refuses to add across currencies. */
export function totalOf(
  valuations: readonly Valuation[],
  currency: CurrencyCode,
): { readonly value: Money; readonly change: Money | null } {
  const matching = valuations.filter((entry) => entry.value.currency === currency);
  const value = Money.sum(
    matching.map((entry) => entry.value),
    currency,
  );
  const changes = matching.map((entry) => entry.change).filter((entry): entry is Money => !!entry);

  return {
    value,
    // Null rather than zero when nothing had a previous close: «no change
    // recorded» and «did not move» are different statements.
    change: changes.length > 0 ? Money.sum(changes, currency) : null,
  };
}
