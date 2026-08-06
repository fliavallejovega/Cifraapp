import { CURRENCY_CODES, Money, isPlainDate } from '@app/domain';
import { z } from 'zod';

/**
 * Shared Zod primitives.
 *
 * These exist so that a monetary amount or a calendar date is validated the same
 * way whether it arrives from a form, an API route, a parsed bank statement, or
 * an AI structured output. A financial value that is validated three different
 * ways is validated zero ways.
 */

export const currencySchema = z.enum(CURRENCY_CODES);

export const uuidSchema = z.uuid();

/**
 * A monetary amount on the wire: an exact decimal string plus its currency.
 * Never a number — JSON numbers are IEEE 754 doubles, which is exactly the
 * representation the whole system exists to avoid (ADR-005).
 */
export const moneySchema = z
  .object({
    amount: z
      .string()
      .regex(/^-?\d+(\.\d{1,4})?$/, 'Amount must be a decimal with at most 4 places.'),
    currency: currencySchema,
  })
  .transform((value) => Money.fromDecimalString(value.amount, value.currency));

/** Accepts a decimal string in a known currency and produces a `Money`. */
export function moneyInCurrency(currency: (typeof CURRENCY_CODES)[number]) {
  return z
    .string()
    .regex(/^-?\d+(\.\d{1,4})?$/, 'Amount must be a decimal with at most 4 places.')
    .transform((value) => Money.fromDecimalString(value, currency));
}

/**
 * A calendar date with no time and no zone. The refinement is a type predicate,
 * so the parsed value is already branded as `PlainDate` — no cast needed.
 */
export const plainDateSchema = z
  .string()
  .refine(isPlainDate, 'Expected a calendar date in YYYY-MM-DD format.');

/** An inclusive date range, rejected if it runs backwards. */
export const dateRangeSchema = z
  .object({ start: plainDateSchema, end: plainDateSchema })
  .refine((range) => range.start <= range.end, {
    message: 'A date range cannot end before it starts.',
    path: ['end'],
  });

/** Locales the interface ships in (ADR-003). */
export const localeSchema = z.enum(['es', 'en']);

export type Locale = z.infer<typeof localeSchema>;

/**
 * Cursor pagination bounds. Transaction histories reach tens of thousands of
 * rows per household; nothing in the system is allowed to ask for all of them
 * (spec §65).
 */
export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
