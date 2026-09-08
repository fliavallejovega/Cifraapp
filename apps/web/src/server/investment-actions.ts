'use server';

import { investmentProfiles, investmentWatchlist } from '@app/database/schema';
import { RISK_LEVELS } from '@app/investment-engine';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { currencyOf } from './household-context';
import { firstIssueKey, optionalText, optionalUuid, positiveAmount } from './record-input';
import { revalidateScreen } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * What a household tells the investing module.
 *
 * All of it is a statement about themselves — how much risk they will carry,
 * how much they can put aside, what they want to look at — and none of it is
 * the product deciding anything. The module's whole output is arithmetic over
 * these inputs and the goals they already have.
 */

/** A rate outside this is not an assumption, it is a typo or a promise. */
const rate = z.preprocess(
  (value) => (value === '' || value === undefined || value === null ? undefined : value),
  z
    .string()
    .regex(/^-?\d+(\.\d{1,3})?$/)
    .refine((value) => Number(value) >= -20 && Number(value) <= 30)
    .optional(),
);

const profileInput = z.object({
  riskLevel: z.enum(RISK_LEVELS as unknown as [string, ...string[]]),
  monthlyCapacity: positiveAmount,
  interests: z.string().trim().max(400).default(''),
  hasEmergencyFund: z.preprocess((value) => value === 'true' || value === 'on', z.boolean()),
  assumedLow: rate,
  assumedExpected: rate,
  assumedHigh: rate,
});

const FIELD_ERRORS = {
  riskLevel: 'riskInvalid',
  monthlyCapacity: 'amountInvalid',
  assumedLow: 'rateInvalid',
  assumedExpected: 'rateInvalid',
  assumedHigh: 'rateInvalid',
} as const;

export async function saveInvestmentProfile(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = profileInput.safeParse({
    riskLevel: formData.get('riskLevel') ?? 'balanced',
    monthlyCapacity: formData.get('monthlyCapacity') ?? '0',
    interests: formData.get('interests') ?? '',
    hasEmergencyFund: formData.get('hasEmergencyFund'),
    assumedLow: formData.get('assumedLow'),
    assumedExpected: formData.get('assumedExpected'),
    assumedHigh: formData.get('assumedHigh'),
  });

  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  // A band has to be given whole or not at all: one edited edge against two
  // defaults is a band nobody can reason about.
  const edges = [parsed.data.assumedLow, parsed.data.assumedExpected, parsed.data.assumedHigh];
  const givenEdges = edges.filter((edge) => edge !== undefined);
  if (givenEdges.length > 0 && givenEdges.length < 3) return { error: 'bandIncomplete' };

  if (
    givenEdges.length === 3 &&
    !(Number(edges[0]) <= Number(edges[1]) && Number(edges[1]) <= Number(edges[2]))
  ) {
    return { error: 'bandOutOfOrder' };
  }

  const householdId = session.activeHouseholdId;

  const values = {
    riskLevel: parsed.data.riskLevel as (typeof RISK_LEVELS)[number],
    monthlyCapacity: parsed.data.monthlyCapacity,
    currency: currencyOf(session, householdId),
    // Free text, split on commas: «energía, bonos de Panamá, tecnología» is how
    // somebody actually writes what they care about.
    interests: parsed.data.interests
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .slice(0, 12),
    hasEmergencyFund: parsed.data.hasEmergencyFund,
    assumedLow: parsed.data.assumedLow ?? null,
    assumedExpected: parsed.data.assumedExpected ?? null,
    assumedHigh: parsed.data.assumedHigh ?? null,
  };

  await queryAsUser(session, (tx) =>
    tx
      .insert(investmentProfiles)
      .values({ householdId, ...values })
      .onConflictDoUpdate({
        target: investmentProfiles.householdId,
        set: { ...values, updatedAt: new Date() },
      }),
  );

  revalidateScreen(formData, 'investments');
  return { ok: true };
}

/**
 * Recording that somebody read what this module is and is not.
 *
 * Stored rather than shown once, because the disclosure is the reason the rest
 * of the screen is defensible: a household that has not read «these are
 * assumptions, not forecasts, and nothing here is a recommendation» should not
 * be looking at a table of monthly contributions.
 */
export async function acknowledgeRisk(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;

  await queryAsUser(session, (tx) =>
    tx
      .insert(investmentProfiles)
      .values({
        householdId,
        currency: currencyOf(session, householdId),
        acknowledgedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: investmentProfiles.householdId,
        set: { acknowledgedAt: new Date(), updatedAt: new Date() },
      }),
  );

  revalidateScreen(formData, 'investments');
  return { ok: true };
}

const watchInput = z.object({
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(40)
    // The charting provider's own address: `NASDAQ:AAPL`, `TVC:GOLD`. Bounded
    // to what an identifier can contain so nothing else reaches an embed.
    .regex(/^[A-Za-z0-9._:!-]+$/),
  label: z.string().trim().min(1).max(80),
  note: optionalText,
  goalId: optionalUuid,
});

export async function addToWatchlist(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = watchInput.safeParse({
    symbol: formData.get('symbol'),
    label: formData.get('label'),
    note: formData.get('note'),
    goalId: formData.get('goalId'),
  });

  if (!parsed.success) {
    return {
      error: firstIssueKey(parsed.error, { symbol: 'symbolInvalid', label: 'nameRequired' }),
    };
  }

  const householdId = session.activeHouseholdId;

  const [created] = await queryAsUser(session, (tx) =>
    tx
      .insert(investmentWatchlist)
      .values({
        householdId,
        createdBy: session.user.id,
        symbol: parsed.data.symbol.toUpperCase(),
        label: parsed.data.label,
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
        ...(parsed.data.goalId ? { goalId: parsed.data.goalId } : {}),
      })
      .onConflictDoNothing()
      .returning({ id: investmentWatchlist.id }),
  );

  if (!created) return { error: 'alreadyWatching' };

  revalidateScreen(formData, 'investments');
  return { created: created.id };
}

export async function removeFromWatchlist(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const [removed] = await queryAsUser(session, (tx) =>
    tx
      .delete(investmentWatchlist)
      .where(
        and(eq(investmentWatchlist.id, id.data), eq(investmentWatchlist.householdId, householdId)),
      )
      .returning({ id: investmentWatchlist.id }),
  );

  if (!removed) return { error: 'notFound' };

  revalidateScreen(formData, 'investments');
  return { ok: true };
}
