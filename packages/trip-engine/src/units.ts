/**
 * Integer arithmetic in minor units.
 *
 * The engine never touches a floating-point number. Amounts arrive as decimal
 * strings (the database's `numeric(19,4)` and the forms both speak strings),
 * become a `bigint` count of the currency's smallest unit — cents for dollars
 * and euros, whole yen for yen — and leave as decimal strings again.
 *
 * Rounding happens exactly once, at the way in, with an explicit mode. After
 * that every split is integer and every sum is exact.
 */

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

export type Rounding = 'half-up' | 'down';

/** Integer division that rounds half away from zero, or toward zero for `down`. */
export function divide(numerator: bigint, denominator: bigint, mode: Rounding = 'half-up'): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero.');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let q = n / d;
  if (mode === 'half-up' && (n % d) * 2n >= d) q += 1n;
  return negative ? -q : q;
}

/**
 * A decimal string as an integer at `scale` decimal places: `'12.345'` at
 * scale 2 is `1235n` (half-up) or `1234n` (down).
 */
export function toScaled(value: string, scale: number, mode: Rounding = 'half-up'): bigint {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new TypeError(`"${value}" is not a decimal number.`);
  const [, sign, whole = '0', fraction = ''] = match;
  if (scale < 0) throw new RangeError('Scale must not be negative.');
  let units = BigInt(whole + fraction.padEnd(scale, '0').slice(0, scale));
  if (fraction.length > scale) {
    const rest = fraction.slice(scale);
    const first = Number(rest[0] ?? '0');
    if (mode === 'half-up' && first >= 5) units += 1n;
  }
  return sign === '-' ? -units : units;
}

/** A decimal string as minor units of a currency with `minorUnits` decimals. */
export function toMinor(value: string, minorUnits: number, mode: Rounding = 'half-up'): bigint {
  return toScaled(value, minorUnits, mode);
}

/** Minor units back to a decimal string with exactly `minorUnits` decimals. */
export function fromMinor(units: bigint, minorUnits: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(minorUnits + 1, '0');
  const whole = minorUnits > 0 ? digits.slice(0, -minorUnits) : digits;
  const fraction = minorUnits > 0 ? `.${digits.slice(-minorUnits)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

export const sumUnits = (values: readonly bigint[]): bigint => values.reduce((a, b) => a + b, 0n);

export const minUnits = (a: bigint, b: bigint): bigint => (a < b ? a : b);
export const maxUnits = (a: bigint, b: bigint): bigint => (a > b ? a : b);
