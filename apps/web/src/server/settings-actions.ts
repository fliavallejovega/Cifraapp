'use server';

import { householdSettings, households } from '@app/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { firstIssueKey, optionalAmount, optionalRate, recordName } from './record-input';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * The household's own choices.
 *
 * Four settings, and each one changes a figure the household reads every day:
 *
 *   - The buffer is the floor «available» refuses to go below. It is why the
 *     plan says $2,740 and not $3,240, and a household that cannot set it is
 *     being handed somebody else's idea of a safe cushion.
 *   - The debt strategy decides which balance the extra dollar attacks.
 *     Avalanche is cheaper; snowball is the one people finish. The product has
 *     an opinion and does not get the final say.
 *   - The tax reserve rate is what the independent sets aside per invoice.
 *   - The name is the name.
 *
 * Currency is deliberately not editable. Every stored figure carries the
 * household's currency code, and changing it would reinterpret every amount in
 * the database as a different unit without converting one of them.
 */

const STRATEGIES = ['avalanche', 'snowball', 'custom', 'hybrid'] as const;

const settingsInput = z.object({
  householdName: recordName,
  bufferMinimum: optionalAmount,
  debtStrategy: z.enum(STRATEGIES),
  taxReserveRate: optionalRate,
});

const FIELD_ERRORS = {
  householdName: 'nameRequired',
  bufferMinimum: 'bufferInvalid',
  debtStrategy: 'strategyInvalid',
  taxReserveRate: 'rateInvalid',
} as const;

export async function saveSettings(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = settingsInput.safeParse({
    householdName: formData.get('householdName'),
    bufferMinimum: formData.get('bufferMinimum'),
    debtStrategy: formData.get('debtStrategy') ?? 'avalanche',
    taxReserveRate: formData.get('taxReserveRate'),
  });

  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;

  await queryAsUser(session, async (tx) => {
    await tx
      .update(households)
      .set({ name: parsed.data.householdName, updatedAt: new Date() })
      .where(and(eq(households.id, householdId), isNull(households.deletedAt)));

    const values = {
      bufferMinimum: parsed.data.bufferMinimum ?? '0',
      debtStrategy: parsed.data.debtStrategy,
      taxReserveRate: parsed.data.taxReserveRate ?? null,
    };

    await tx
      .insert(householdSettings)
      .values({ householdId, ...values })
      .onConflictDoUpdate({
        target: householdSettings.householdId,
        set: { ...values, updatedAt: new Date() },
      });
  });

  revalidateFinancials(formData);
  return { ok: true };
}
