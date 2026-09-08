'use server';

import { merchants } from '@app/database/schema';
import { normalizeMerchantName } from '@app/category-engine';
import { z } from 'zod';

import { firstIssueKey, optionalUuid, recordName } from './record-input';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Creating a merchant by hand.
 *
 * Most merchants arrive on their own from an import. This exists for the case
 * an import cannot cover: the household knows «the school» before any statement
 * has named it, and wants the rule in place before the first charge lands.
 *
 * The normalized name is computed by the same function the classifier matches
 * with, so a merchant typed here and one recognised from a statement are
 * compared like with like. Deriving it any other way would create a merchant
 * that never matches anything.
 */

const merchantInput = z.object({
  name: recordName,
  defaultCategoryId: optionalUuid,
});

export async function createMerchant(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = merchantInput.safeParse({
    name: formData.get('name'),
    defaultCategoryId: formData.get('defaultCategoryId'),
  });

  if (!parsed.success) return { error: firstIssueKey(parsed.error, { name: 'nameRequired' }) };

  const householdId = session.activeHouseholdId;

  const [created] = await queryAsUser(session, (tx) =>
    tx
      .insert(merchants)
      .values({
        householdId,
        name: parsed.data.name,
        normalizedName: normalizeMerchantName(parsed.data.name),
        ...(parsed.data.defaultCategoryId
          ? { defaultCategoryId: parsed.data.defaultCategoryId }
          : {}),
      })
      .returning({ id: merchants.id }),
  );

  if (!created) return { error: 'createFailed' };

  revalidateFinancials(formData);
  return { created: created.id };
}
