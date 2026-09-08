import 'server-only';

import { FREE_ENTITLEMENTS, type EntitlementKey } from '@app/billing';
import { planEntitlements, plans, subscriptions, usageCounters } from '@app/database/schema';
import { Money, startOfMonth, type CurrencyCode, type PlainDate } from '@app/domain';
import { and, eq } from 'drizzle-orm';

import { loadEntitlements } from '../entitlements';
import { queryAsUser, type Session } from '../session';

/**
 * What the household is on, what it is using, and what else exists.
 *
 * The usage figures are the reason the screen is worth opening. «Plus, $9.99»
 * tells somebody nothing; «184 of your 250 movements this month» tells them
 * whether the plan they are on still fits, which is the only question a
 * subscription screen has to answer.
 *
 * A household with no subscription row is on Free and is told so plainly. Most
 * deployments of this product have no payment processor configured at all, and
 * that has to read as a state of the world rather than as an outage.
 */

export interface PlanOption {
  readonly code: string;
  readonly name: string;
  readonly price: Money;
  readonly interval: 'month' | 'year';
  readonly isCurrent: boolean;
  readonly entitlements: Readonly<Record<string, number | null>>;
}

export interface UsageRow {
  readonly key: EntitlementKey;
  readonly used: number;
  /** Null is unlimited. Zero is «not included», which is a different thing. */
  readonly limit: number | null;
}

export interface SubscriptionView {
  readonly planCode: string;
  readonly planName: string;
  readonly status: string;
  readonly price: Money | null;
  readonly interval: 'month' | 'year' | null;
  readonly currentPeriodEnd: PlainDate | null;
  readonly cancelAt: PlainDate | null;
  readonly usage: readonly UsageRow[];
  readonly options: readonly PlanOption[];
  /** False when this deployment has no payment processor wired up. */
  readonly checkoutAvailable: boolean;
}

export async function loadSubscription(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
  today: PlainDate,
  checkoutAvailable: boolean,
): Promise<SubscriptionView> {
  const view = await loadEntitlements(session, householdId);
  const period = startOfMonth(today);

  return queryAsUser(session, async (tx) => {
    const [current] = await tx
      .select({
        planCode: subscriptions.planCode,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAt: subscriptions.cancelAt,
      })
      .from(subscriptions)
      .where(eq(subscriptions.householdId, householdId))
      .limit(1);

    const [catalogue, limits, counters] = await Promise.all([
      tx.select().from(plans).where(eq(plans.isActive, true)).orderBy(plans.sortOrder),
      tx.select().from(planEntitlements),
      tx
        .select({ key: usageCounters.entitlementKey, used: usageCounters.used })
        .from(usageCounters)
        .where(
          and(eq(usageCounters.householdId, householdId), eq(usageCounters.periodStart, period)),
        ),
    ]);

    const usedByKey = new Map(counters.map((row) => [row.key, row.used]));

    const usage: UsageRow[] = (Object.keys(FREE_ENTITLEMENTS) as EntitlementKey[]).map((key) => ({
      key,
      used: usedByKey.get(key) ?? 0,
      limit: view.entitlements[key],
    }));

    const options: PlanOption[] = catalogue.map((plan) => ({
      code: plan.code,
      name: plan.name,
      price: Money.fromDecimalString(plan.priceAmount, plan.currency.trim() as CurrencyCode),
      interval: plan.billingInterval,
      isCurrent: plan.code === view.planCode,
      entitlements: Object.fromEntries(
        limits
          .filter((limit) => limit.planCode === plan.code)
          .map((limit) => [limit.entitlementKey, limit.limitValue]),
      ),
    }));

    const currentPlan = catalogue.find((plan) => plan.code === view.planCode);

    return {
      planCode: view.planCode,
      planName: currentPlan?.name ?? view.planCode,
      status: view.status,
      price: currentPlan
        ? Money.fromDecimalString(
            currentPlan.priceAmount,
            currentPlan.currency.trim() as CurrencyCode,
          )
        : Money.zero(currency),
      interval: currentPlan?.billingInterval ?? null,
      currentPeriodEnd: (current?.currentPeriodEnd as PlainDate | null) ?? null,
      cancelAt: (current?.cancelAt as PlainDate | null) ?? null,
      usage,
      options,
      checkoutAvailable,
    };
  });
}
