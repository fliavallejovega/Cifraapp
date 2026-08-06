import {
  CurrencyMismatchError,
  getCurrency,
  isCurrencyCode,
  type CurrencyCode,
} from './currency.js';

/**
 * Money is stored as an integer count of 1/10,000 of a currency unit.
 *
 * Two decimal places would be enough for balances, but not for the things this
 * system computes on top of them: daily interest accrual, tax rates, business-use
 * percentages, and proportional allocation all produce sub-cent intermediates.
 * Rounding those to cents at every step accumulates error. Four places gives
 * intermediate arithmetic room to breathe, and rounding happens once, explicitly,
 * at the boundary where a number becomes a payment or a displayed figure.
 *
 * This matches the database representation, `numeric(19,4)` (ADR-005).
 */
const SCALE = 4;
const SCALE_FACTOR = 10_000n;

export type RoundingMode = 'half-up' | 'half-even' | 'down';

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * An immutable monetary amount in a single currency.
 *
 * Every arithmetic operation returns a new instance. There is no mutation and
 * no way to reach the underlying number as a float.
 */
export class Money {
  /** Signed count of 1/10,000 currency units. */
  readonly #units: bigint;
  readonly #currency: CurrencyCode;

  private constructor(units: bigint, currency: CurrencyCode) {
    this.#units = units;
    this.#currency = currency;
  }

  // --- Construction --------------------------------------------------------

  /** Zero in the given currency. */
  static zero(currency: CurrencyCode): Money {
    return new Money(0n, currency);
  }

  /**
   * Builds from a decimal string such as `'1234.56'` or `'-0.0001'`.
   *
   * A string is the only lossless way to carry a decimal from a database, a
   * parsed bank statement, or a form field. More than four decimal places is
   * rejected rather than silently truncated — losing precision quietly is how
   * reconciliation breaks months later.
   */
  static fromDecimalString(value: string, currency: CurrencyCode): Money {
    const match = DECIMAL_PATTERN.exec(value.trim());
    if (!match) {
      throw new TypeError(`"${value}" is not a valid decimal amount.`);
    }

    const [, sign, whole = '0', fraction = ''] = match;

    if (fraction.length > SCALE) {
      throw new RangeError(
        `"${value}" has ${String(fraction.length)} decimal places; money is tracked to ${String(SCALE)}. Round explicitly before constructing.`,
      );
    }

    const padded = fraction.padEnd(SCALE, '0');
    const units = BigInt(whole) * SCALE_FACTOR + BigInt(padded);

    return new Money(sign === '-' ? -units : units, currency);
  }

  /**
   * Builds from a raw scaled-unit count. This is the database boundary and the
   * serialization boundary; application code should prefer `fromDecimalString`.
   */
  static fromScaledUnits(units: bigint, currency: CurrencyCode): Money {
    return new Money(units, currency);
  }

  /**
   * Builds from a whole number of minor units (cents), the representation most
   * payment processors and bank APIs use.
   */
  static fromMinorUnits(minorUnits: bigint | number, currency: CurrencyCode): Money {
    const { minorUnits: places } = getCurrency(currency);
    const factor = 10n ** BigInt(SCALE - places);
    return new Money(BigInt(minorUnits) * factor, currency);
  }

  // --- Accessors -----------------------------------------------------------

  get currency(): CurrencyCode {
    return this.#currency;
  }

  /** Signed count of 1/10,000 currency units. The database representation. */
  get scaledUnits(): bigint {
    return this.#units;
  }

  isZero(): boolean {
    return this.#units === 0n;
  }

  isPositive(): boolean {
    return this.#units > 0n;
  }

  isNegative(): boolean {
    return this.#units < 0n;
  }

  // --- Arithmetic ----------------------------------------------------------

  add(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.#units + other.#units, this.#currency);
  }

  subtract(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.#units - other.#units, this.#currency);
  }

  negate(): Money {
    return new Money(-this.#units, this.#currency);
  }

  abs(): Money {
    return this.#units < 0n ? this.negate() : this;
  }

  /**
   * Multiplies by a dimensionless factor — an interest rate, a tax rate, a
   * business-use percentage.
   *
   * The factor is parsed from its exact decimal representation, so a rate
   * written as `0.0725` is treated as 725/10000 rather than the nearest double.
   * Rounding happens once, at the end.
   */
  multiply(factor: number | string, rounding: RoundingMode = 'half-up'): Money {
    const { numerator, denominator } = parseFactor(factor);
    return new Money(divideRounded(this.#units * numerator, denominator, rounding), this.#currency);
  }

  /** Divides by a dimensionless factor, rounding once at the end. */
  divide(divisor: number | string, rounding: RoundingMode = 'half-up'): Money {
    const { numerator, denominator } = parseFactor(divisor);
    if (numerator === 0n) {
      throw new RangeError('Division by zero.');
    }
    return new Money(divideRounded(this.#units * denominator, numerator, rounding), this.#currency);
  }

  /** Convenience for `multiply(percent / 100)`, e.g. `percentage(15)`. */
  percentage(percent: number | string, rounding: RoundingMode = 'half-up'): Money {
    const { numerator, denominator } = parseFactor(percent);
    return new Money(
      divideRounded(this.#units * numerator, denominator * 100n, rounding),
      this.#currency,
    );
  }

  /**
   * Splits this amount across weighted buckets so the parts sum back exactly.
   *
   * This is the operation the Allocation Engine (Phase 10) is built on: given
   * incoming income and a set of priorities, every scaled unit must land
   * somewhere. Naive proportional division loses or invents fractions of a
   * cent; this distributes the remainder one unit at a time to the buckets with
   * the largest truncated fraction, breaking ties by position, so the result is
   * both exact and deterministic.
   *
   * @param weights Non-negative weights. Need not sum to anything in particular.
   */
  allocate(weights: readonly (number | bigint)[]): Money[] {
    if (weights.length === 0) {
      throw new RangeError('allocate() needs at least one weight.');
    }

    const scaled = weights.map((weight) => {
      const value = typeof weight === 'bigint' ? weight : BigInt(Math.trunc(weight * 1_000_000));
      if (value < 0n) {
        throw new RangeError('allocate() weights must be non-negative.');
      }
      return value;
    });

    const totalWeight = scaled.reduce((sum, weight) => sum + weight, 0n);
    if (totalWeight === 0n) {
      throw new RangeError('allocate() weights must not all be zero.');
    }

    // Work on the magnitude so truncation always rounds toward zero, then
    // restore the sign. Truncating a negative numerator would otherwise bias
    // the remainder in the opposite direction.
    const negative = this.#units < 0n;
    const magnitude = negative ? -this.#units : this.#units;

    const shares: bigint[] = [];
    const remainders: { index: number; remainder: bigint }[] = [];
    let distributed = 0n;

    for (const [index, weight] of scaled.entries()) {
      const numerator = magnitude * weight;
      const share = numerator / totalWeight;
      shares.push(share);
      remainders.push({ index, remainder: numerator % totalWeight });
      distributed += share;
    }

    let leftover = magnitude - distributed;
    remainders.sort((a, b) => {
      if (a.remainder === b.remainder) return a.index - b.index;
      return a.remainder > b.remainder ? -1 : 1;
    });

    for (const { index } of remainders) {
      if (leftover <= 0n) break;
      shares[index] = (shares[index] ?? 0n) + 1n;
      leftover -= 1n;
    }

    return shares.map((share) => new Money(negative ? -share : share, this.#currency));
  }

  /** Splits evenly into `parts` buckets, exactly. */
  allocateEvenly(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts < 1) {
      throw new RangeError('allocateEvenly() needs a positive integer part count.');
    }
    return this.allocate(Array.from({ length: parts }, () => 1n));
  }

  // --- Comparison ----------------------------------------------------------

  /** Returns -1, 0 or 1. Throws on mixed currencies. */
  compare(other: Money): -1 | 0 | 1 {
    this.#assertSameCurrency(other);
    if (this.#units === other.#units) return 0;
    return this.#units < other.#units ? -1 : 1;
  }

  equals(other: Money): boolean {
    return this.#currency === other.#currency && this.#units === other.#units;
  }

  greaterThan(other: Money): boolean {
    return this.compare(other) === 1;
  }

  lessThan(other: Money): boolean {
    return this.compare(other) === -1;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.compare(other) >= 0;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.compare(other) <= 0;
  }

  // --- Rounding and output -------------------------------------------------

  /**
   * Rounds to the currency's own precision (cents for USD and PAB). Call this
   * at the boundary where an amount becomes a real payment or a stored balance,
   * not between intermediate steps.
   */
  roundToCurrencyPrecision(rounding: RoundingMode = 'half-up'): Money {
    const factor = 10n ** BigInt(SCALE - getCurrency(this.#currency).minorUnits);
    const rounded = divideRounded(this.#units, factor, rounding) * factor;
    return new Money(rounded, this.#currency);
  }

  /** Exact decimal string at full internal precision, e.g. `'1234.5600'`. */
  toDecimalString(): string {
    const negative = this.#units < 0n;
    const magnitude = negative ? -this.#units : this.#units;
    const whole = magnitude / SCALE_FACTOR;
    const fraction = (magnitude % SCALE_FACTOR).toString().padStart(SCALE, '0');
    return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
  }

  /** Decimal string at the currency's precision, e.g. `'1234.56'`. */
  toCurrencyString(rounding: RoundingMode = 'half-up'): string {
    const places = getCurrency(this.#currency).minorUnits;
    const full = this.roundToCurrencyPrecision(rounding).toDecimalString();
    return places === 0
      ? full.slice(0, full.indexOf('.'))
      : full.slice(0, full.indexOf('.') + 1 + places);
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.#currency}`;
  }

  /** Serializes losslessly. Never emits a JS number. */
  toJSON(): { amount: string; currency: CurrencyCode } {
    return { amount: this.toDecimalString(), currency: this.#currency };
  }

  static fromJSON(value: { amount: string; currency: string }): Money {
    if (!isCurrencyCode(value.currency)) {
      throw new TypeError(`Unknown currency "${value.currency}".`);
    }
    return Money.fromDecimalString(value.amount, value.currency);
  }

  // --- Aggregation ---------------------------------------------------------

  /**
   * Sums a list. The currency is required rather than inferred so that an empty
   * list still produces a well-typed zero instead of throwing or guessing.
   */
  static sum(amounts: readonly Money[], currency: CurrencyCode): Money {
    return amounts.reduce<Money>((total, amount) => total.add(amount), Money.zero(currency));
  }

  static max(a: Money, b: Money): Money {
    return a.greaterThan(b) ? a : b;
  }

  static min(a: Money, b: Money): Money {
    return a.lessThan(b) ? a : b;
  }

  #assertSameCurrency(other: Money): void {
    if (this.#currency !== other.#currency) {
      throw new CurrencyMismatchError(this.#currency, other.#currency);
    }
  }
}

/**
 * Converts a rate into an exact fraction.
 *
 * A JS number's `toString()` is its shortest round-trippable decimal form, so a
 * rate a human wrote as `0.0725` comes back as `'0.0725'` and converts exactly.
 * Values in exponential form (very large or very small) are rejected, because
 * silently mishandling them would be worse than refusing them.
 */
function parseFactor(factor: number | string): { numerator: bigint; denominator: bigint } {
  const text = typeof factor === 'string' ? factor.trim() : factor.toString();

  const match = DECIMAL_PATTERN.exec(text);
  if (!match) {
    throw new TypeError(`"${text}" is not a usable rate. Use plain decimal notation.`);
  }

  const [, sign, whole = '0', fraction = ''] = match;
  const denominator = 10n ** BigInt(fraction.length);
  const magnitude = BigInt(whole) * denominator + BigInt(fraction || '0');

  return { numerator: sign === '-' ? -magnitude : magnitude, denominator };
}

/** Integer division with an explicit rounding mode. Handles negatives symmetrically. */
function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) {
    throw new RangeError('Division by zero.');
  }

  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;

  if (remainder === 0n) {
    return negative ? -quotient : quotient;
  }

  let rounded = quotient;
  const twiceRemainder = remainder * 2n;

  switch (mode) {
    case 'down':
      break;
    case 'half-up':
      if (twiceRemainder >= absDenominator) rounded += 1n;
      break;
    case 'half-even':
      if (twiceRemainder > absDenominator) {
        rounded += 1n;
      } else if (twiceRemainder === absDenominator && quotient % 2n !== 0n) {
        rounded += 1n;
      }
      break;
  }

  return negative ? -rounded : rounded;
}
