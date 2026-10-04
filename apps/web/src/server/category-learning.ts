import 'server-only';

import { merchants, transactions } from '@app/database/schema';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';

import type { queryAsUser } from './session';

type Tx = Parameters<Parameters<typeof queryAsUser<unknown>>[1]>[0];

/**
 * A correction is said once.
 *
 * A person who files «SUPER 99 VIA ESPANA» under groceries should never be
 * asked about Super 99 again. Before this, the answer stayed on that one row:
 * the next statement brought the same merchant with no category and the same
 * question. Now the answer becomes the merchant's own category, and every
 * other movement from it that nobody decided by hand follows at once.
 *
 * A category a person set by hand is never overwritten — their decision on
 * that row outranks what they decided about another row.
 *
 * Returns how many other movements followed.
 */
export async function learnFromCorrection(
  tx: Tx,
  input: {
    readonly householdId: string;
    readonly transactionId: string;
    readonly categoryId: string;
  },
): Promise<number> {
  const [row] = await tx
    .select({
      merchantId: transactions.merchantId,
      description: transactions.descriptionNormalized,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.id, input.transactionId),
        eq(transactions.householdId, input.householdId),
      ),
    )
    .limit(1);
  if (!row) return 0;

  if (row.merchantId) {
    await tx
      .update(merchants)
      .set({ defaultCategoryId: input.categoryId, updatedAt: new Date() })
      .where(and(eq(merchants.id, row.merchantId), eq(merchants.householdId, input.householdId)));
  }

  const sameMerchant = row.merchantId
    ? or(
        eq(transactions.merchantId, row.merchantId),
        eq(transactions.descriptionNormalized, row.description),
      )
    : eq(transactions.descriptionNormalized, row.description);

  const followed = await tx
    .update(transactions)
    .set({
      categoryId: input.categoryId,
      categorySource: 'rule',
      categoryConfidence: '0.950',
      // An uncertain proposal the person has now answered is no longer uncertain.
      status: sql`case when ${transactions.status} = 'needs_review' then 'posted'::app.transaction_status else ${transactions.status} end`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(transactions.householdId, input.householdId),
        ne(transactions.id, input.transactionId),
        isNull(transactions.deletedAt),
        sameMerchant,
        // Never over a person's own decision.
        or(isNull(transactions.categorySource), ne(transactions.categorySource, 'user')),
        // Only what is missing or unsure; a confident rule stays.
        or(isNull(transactions.categoryId), eq(transactions.status, 'needs_review')),
        // Transfers, duplicates and exclusions take no category.
        sql`${transactions.status} not in ('transfer', 'duplicate', 'excluded')`,
      ),
    )
    .returning({ id: transactions.id });

  return followed.length;
}
