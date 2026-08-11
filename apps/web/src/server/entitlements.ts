import 'server-only';

import {
  FREE_ENTITLEMENTS,
  checkEntitlement,
  effectiveEntitlements,
  type EntitlementKey,
  type EntitlementVerdict,
  type Entitlements,
  type SubscriptionStatus,
} from '@app/billing';
import { planEntitlements, subscriptions, usageCounters } from '@app/database/schema';
import { startOfMonth, todayIn } from '@app/domain';
import { and, eq } from 'drizzle-orm';

import { queryAsUser, type Session } from './session';

/**
 * What a household may do.
 *
 * Every caller asks about a capability — "may I import another document" — and
 * never about a plan. That is the whole design: pricing changes, promotions and
 * per-customer exceptions are rows, and the day the catalogue changes there is
 * no `if (plan === 'pro')` to find in eleven files.
 *
 * A household with no subscription row is on the free plan, not locked out. Most
 * deployments of this product have no payment processor configured at all, and
 * the product has to work in that state rather than treat it as an outage.
 */

export interface EntitlementView {
  readonly entitlements: Entitlements;
  readonly planCode: string;
  readonly status: SubscriptionStatus | 'none';
}

export async function loadEntitlements(
  session: Session,
  householdId: string,
): Promise<EntitlementView> {
  return queryAsUser(session, async (tx) => {
    const [subscription] = await tx
      .select({
        planCode: subscriptions.planCode,
        status: subscriptions.status,
        overrides: subscriptions.entitlementOverrides,
      })
      .from(subscriptions)
      .where(eq(subscriptions.householdId, householdId))
      .limit(1);

    if (!subscription) {
      return { entitlements: FREE_ENTITLEMENTS, planCode: 'FREE', status: 'none' as const };
    }

    const rows = await tx
      .select({ key: planEntitlements.entitlementKey, limit: planEntitlements.limitValue })
      .from(planEntitlements)
      .where(eq(planEntitlements.planCode, subscription.planCode));

    // Anything the catalogue does not mention stays at the free plan's value
    // rather than becoming unlimited. A missing row is a configuration gap, and
    // the safe reading of a gap is the smaller number.
    const planLimits: Entitlements = { ...FREE_ENTITLEMENTS };
    for (const row of rows) {
      if (row.key in planLimits) {
        (planLimits as Record<string, number | null>)[row.key] = row.limit;
      }
    }

    return {
      entitlements: effectiveEntitlements(
        {
          status: subscription.status,
          // The column is `jsonb`, so what comes back is whatever an
          // administrator or a webhook wrote. Only keys the catalogue knows
          // about survive into the effective set.
          overrides: pickEntitlements(subscription.overrides),
        },
        planLimits,
        FREE_ENTITLEMENTS,
      ),
      planCode: subscription.planCode,
      status: subscription.status,
    };
  });
}

/**
 * The override keys the catalogue recognizes, and nothing else.
 *
 * A stored override is JSON somebody wrote by hand or a webhook produced.
 * Spreading it straight into the effective entitlements would let an unknown key
 * through, and an unknown key is a limit no check will ever consult.
 */
function pickEntitlements(stored: unknown): Partial<Entitlements> {
  if (typeof stored !== 'object' || stored === null) return {};

  const source = stored as Record<string, unknown>;
  const picked: Record<string, number | null> = {};

  for (const key of Object.keys(FREE_ENTITLEMENTS)) {
    const value = source[key];
    if (value === null || typeof value === 'number') picked[key] = value;
  }

  return picked;
}

/**
 * Whether one more of something is allowed this period.
 *
 * Usage is counted in `app.usage_counters` rather than derived by scanning
 * transactions, so a check on a hot path is one indexed read.
 */
export async function checkUsage(
  session: Session,
  householdId: string,
  key: EntitlementKey,
  additional = 1,
): Promise<EntitlementVerdict> {
  const view = await loadEntitlements(session, householdId);
  const period = startOfMonth(todayIn('America/Panama'));

  const used = await queryAsUser(session, async (tx) => {
    const [row] = await tx
      .select({ used: usageCounters.used })
      .from(usageCounters)
      .where(
        and(
          eq(usageCounters.householdId, householdId),
          eq(usageCounters.entitlementKey, key),
          eq(usageCounters.periodStart, period),
        ),
      )
      .limit(1);

    return row?.used ?? 0;
  });

  return checkEntitlement(view.entitlements, key, used, additional);
}
