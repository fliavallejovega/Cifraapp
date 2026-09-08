import { z } from 'zod';

import { normalizeTypedAmount } from './amount';

/**
 * The validators every managed record shares.
 *
 * These are the same handful of shapes over and over — a name, a positive
 * amount, a rate, a calendar day, an ISO date — and defining them once is not
 * only shorter. It is the only way the twelve screens agree on what «too large»
 * means, and on the fact that a figure travels as a decimal string from the
 * keyboard to `numeric(19,4)` without ever becoming a JavaScript number
 * (ADR-005).
 */

/** A household figure past a trillion is a typo, not a fortune. */
const withinColumn = (value: string) => (value.replace(/^-/, '').split('.')[0] ?? '').length <= 12;

/** A positive money figure, as typed on any keyboard. */
export const positiveAmount = z.preprocess(
  normalizeTypedAmount,
  z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .refine(withinColumn),
);

/** A money figure that may be negative — a correction, a balance, a delta. */
export const signedAmount = z.preprocess(
  normalizeTypedAmount,
  z
    .string()
    .regex(/^-?\d+(\.\d{1,4})?$/)
    .refine(withinColumn),
);

export const optionalAmount = z.preprocess(
  (value) => (value === '' || value === undefined || value === null ? undefined : value),
  positiveAmount.optional(),
);

/**
 * An annual rate as a percentage: "24.5" means 24.5%. Bounded at 200 because a
 * figure above that is a balance entered in the rate field, not a loan.
 */
export const percentageRate = z.preprocess(
  normalizeTypedAmount,
  z
    .string()
    .regex(/^\d+(\.\d{1,3})?$/)
    .refine((value) => Number(value) <= 200),
);

export const optionalRate = z.preprocess(
  (value) => (value === '' || value === undefined || value === null ? undefined : value),
  percentageRate.optional(),
);

export const recordName = z.string().trim().min(1).max(120);

export const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().max(1000).optional(),
);

/** A day of the month, clamped by the caller into whatever month it lands in. */
export const dayOfMonth = z.coerce.number().int().min(1).max(31);

export const plainDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));

export const optionalPlainDate = z.preprocess(
  (value) => (value === '' || value === undefined || value === null ? undefined : value),
  plainDateString.optional(),
);

/** An unchecked checkbox submits nothing at all, which is `false`, not invalid. */
export const checkbox = z.preprocess((value) => value === 'true' || value === 'on', z.boolean());

export const optionalUuid = z.preprocess(
  (value) => (value === '' || value === undefined || value === null ? undefined : value),
  z.uuid().optional(),
);

/**
 * The error key a field maps to.
 *
 * Actions return keys, never sentences: the message a person reads is chosen in
 * their language by the screen, and an action that returned prose would have
 * picked a language on the server where the request locale is a parameter
 * rather than a fact.
 */
export function firstIssueKey(
  error: z.ZodError,
  mapping: Readonly<Record<string, string>>,
  fallback = 'invalid',
): string {
  const path = error.issues[0]?.path[0];
  return (typeof path === 'string' ? mapping[path] : undefined) ?? fallback;
}
