import 'server-only';

import type { EntitlementKey } from '@app/billing';
import { getDb } from '@app/database';
import { planEntitlements, plans } from '@app/database/schema';
import { Money, type CurrencyCode } from '@app/domain';
import { getServerEnv } from '@app/validation/env';
import { asc, eq } from 'drizzle-orm';

import { cachedPublicRead } from '../public-cache';

/**
 * The plan catalogue, for the pricing page.
 *
 * Read with the anonymous role — the catalogue is public and holds no customer
 * data — and read from the database rather than from a constant, so a price
 * change is an update and not a release. There is no fallback to the seed
 * constants in `@app/billing`: a missing catalogue is a misconfigured
 * deployment, and quietly serving prices from a build artifact would hide it
 * until somebody was charged the wrong amount.
 */

export interface PublicPlan {
  readonly code: string;
  readonly name: string;
  readonly price: Money;
  readonly interval: 'month' | 'year';
  readonly entitlements: readonly { key: EntitlementKey; limit: number | null }[];
}

export async function listPlans(): Promise<readonly PublicPlan[]> {
  return cachedPublicRead('plans', readPlans);
}

async function readPlans(): Promise<readonly PublicPlan[]> {
  const db = getDb(getServerEnv().DATABASE_URL);

  const [planRows, entitlementRows] = await Promise.all([
    db
      .select({
        code: plans.code,
        name: plans.name,
        price: plans.priceAmount,
        currency: plans.currency,
        interval: plans.billingInterval,
      })
      .from(plans)
      .where(eq(plans.isActive, true))
      .orderBy(asc(plans.sortOrder)),

    db
      .select({
        planCode: planEntitlements.planCode,
        key: planEntitlements.entitlementKey,
        limit: planEntitlements.limitValue,
      })
      .from(planEntitlements),
  ]);

  return planRows.map((row) => ({
    code: row.code,
    name: row.name,
    price: Money.fromDecimalString(row.price, row.currency.trim() as CurrencyCode),
    interval: row.interval,
    entitlements: entitlementRows
      .filter((entitlement) => entitlement.planCode === row.code)
      .map((entitlement) => ({ key: entitlement.key as EntitlementKey, limit: entitlement.limit })),
  }));
}
