/**
 * Currencies the system understands.
 *
 * Panama uses the US dollar as legal tender alongside the balboa, which is
 * pegged 1:1 and exists only as coinage. They are economically interchangeable
 * but technically distinct, and reporting must be able to tell them apart
 * (spec §7) — so they are separate codes, never silently unified.
 */
export const CURRENCY_CODES = ['USD', 'PAB'] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface CurrencyMetadata {
  /** ISO 4217 alphabetic code. */
  readonly code: CurrencyCode;
  /** Number of decimal places the currency is quoted in. */
  readonly minorUnits: number;
  /** Symbol used when formatting. Placed before the number for both codes. */
  readonly symbol: string;
  /** Human name, in English. Localized names live in the i18n catalog. */
  readonly name: string;
}

const CURRENCY_METADATA: Readonly<Record<CurrencyCode, CurrencyMetadata>> = {
  USD: { code: 'USD', minorUnits: 2, symbol: '$', name: 'US Dollar' },
  PAB: { code: 'PAB', minorUnits: 2, symbol: 'B/.', name: 'Panamanian Balboa' },
};

export function getCurrency(code: CurrencyCode): CurrencyMetadata {
  return CURRENCY_METADATA[code];
}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (CURRENCY_CODES as readonly string[]).includes(value);
}

/**
 * Thrown when an operation mixes currencies. There is no implicit conversion
 * anywhere in this system: adding USD to PAB is a bug, not a rate lookup.
 */
export class CurrencyMismatchError extends Error {
  readonly left: CurrencyCode;
  readonly right: CurrencyCode;

  constructor(left: CurrencyCode, right: CurrencyCode) {
    super(
      `Cannot combine ${left} with ${right}. Currency conversion must be explicit and recorded, never implicit.`,
    );
    this.name = 'CurrencyMismatchError';
    this.left = left;
    this.right = right;
  }
}
