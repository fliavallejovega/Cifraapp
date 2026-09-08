'use server';

import { taxProfiles } from '@app/database/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { firstIssueKey, optionalText } from './record-input';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * The independent's tax profile.
 *
 * This is the only setting in the product whose figures the household does not
 * get to see yet, and the reason is stated on the screen: the Panama 2026 rule
 * set is a draft nobody qualified has reviewed, so no estimate derived from it
 * is shown to anybody. The profile is still worth recording — it is what a
 * published set would compute against the day one exists.
 *
 * Storing an unreviewed rule's output would be the single most damaging thing
 * this product could do. A wrong balance is embarrassing; a wrong tax figure is
 * a fine somebody pays.
 */

/** The statuses the column defines. Panama's, not a generic taxonomy. */
const STATUSES = [
  'salaried',
  'independent_professional',
  'freelancer',
  'merchant',
  'mixed_income',
  'personal_business',
] as const;

const METHODS = ['cash', 'accrual'] as const;

const profileInput = z.object({
  taxpayerStatus: z.enum(STATUSES),
  ruc: optionalText,
  activity: optionalText,
  accountingMethod: z.enum(METHODS),
  itbmsRegistered: z.preprocess((value) => value === 'true' || value === 'on', z.boolean()),
  // `MM-DD`. Assuming a calendar year for a household that has another costs a
  // filing, which is why it is asked rather than defaulted silently.
  fiscalYearStart: z
    .string()
    .regex(/^\d{2}-\d{2}$/)
    .refine((value) => {
      const [month = '0', day = '0'] = value.split('-');
      return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31;
    }),
});

const FIELD_ERRORS = {
  taxpayerStatus: 'statusInvalid',
  accountingMethod: 'methodInvalid',
  fiscalYearStart: 'fiscalYearInvalid',
} as const;

export async function saveTaxProfile(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = profileInput.safeParse({
    taxpayerStatus: formData.get('taxpayerStatus') ?? 'salaried',
    ruc: formData.get('ruc'),
    activity: formData.get('activity'),
    accountingMethod: formData.get('accountingMethod') ?? 'cash',
    itbmsRegistered: formData.get('itbmsRegistered'),
    fiscalYearStart: formData.get('fiscalYearStart') ?? '01-01',
  });

  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;

  const values = {
    taxpayerStatus: parsed.data.taxpayerStatus,
    ruc: parsed.data.ruc ?? null,
    activity: parsed.data.activity ?? null,
    accountingMethod: parsed.data.accountingMethod,
    itbmsRegistered: parsed.data.itbmsRegistered,
    fiscalYearStart: parsed.data.fiscalYearStart,
  };

  await queryAsUser(session, (tx) =>
    tx
      .insert(taxProfiles)
      .values({ householdId, ...values })
      .onConflictDoUpdate({
        target: taxProfiles.householdId,
        set: { ...values, updatedAt: new Date() },
      }),
  );

  revalidateFinancials(formData);
  return { ok: true };
}

/** Removes the profile, for a household that stops working for itself. */
export async function removeTaxProfile(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;

  await queryAsUser(session, (tx) =>
    tx.delete(taxProfiles).where(eq(taxProfiles.householdId, householdId)),
  );

  revalidateFinancials(formData);
  return { ok: true };
}
