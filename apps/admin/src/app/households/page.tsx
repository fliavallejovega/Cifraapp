import {
  EmptyState,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Section,
  Status,
} from '@app/ui';
import { households, subscriptions, transactions } from '@app/database/schema';
import { getClientEnv } from '@app/validation/env';
import { count, desc, eq, isNull, sql } from 'drizzle-orm';

import { ConsolePage, Metric, Series } from '@/components/figures';
import { NewHouseholdForm } from '@/components/new-household-form';
import { Console } from '@/components/shell';
import { adminDb } from '@/server/admin-session';
import { loadGrowthMetrics } from '@/server/analytics';
import { requireAdmin } from '@/server/guard';

export const dynamic = 'force-dynamic';

/**
 * Households, as an operational list.
 *
 * What it shows is chosen carefully: enough to answer «is this account healthy
 * and what is it paying», and nothing about what the household actually spends
 * money on. A support tool that displays transaction descriptions exposes a
 * person's medical appointments and their debts to whoever picked up the
 * ticket.
 *
 * The counts are aggregates. Opening a household's actual rows is a separate
 * action that does not exist yet, and when it does it should be logged in
 * `audit.admin_actions` before the first row is read.
 *
 * Creating one is the console's only write, and it is logged before anything
 * else: see `household-actions.ts`.
 */
export default async function HouseholdsPage() {
  const session = await requireAdmin();
  const db = adminDb();

  const [rows, totals, growth] = await Promise.all([
    db
      .select({
        id: households.id,
        name: households.name,
        currency: households.baseCurrency,
        createdAt: households.createdAt,
        plan: subscriptions.planCode,
        status: subscriptions.status,
        transactions: sql<number>`(
          select count(*)::int from app.transactions t
           where t.household_id = ${households.id} and t.deleted_at is null
        )`,
        members: sql<number>`(
          select count(*)::int from app.household_members m
           where m.household_id = ${households.id} and m.status = 'active'
        )`,
        lastActivity: sql<string | null>`(
          select max(t.transaction_date)::text from app.transactions t
           where t.household_id = ${households.id} and t.deleted_at is null
        )`,
        owner: sql<string | null>`(
          select p.email from app.household_members m
            join app.profiles p on p.id = m.user_id
           where m.household_id = ${households.id}
             and m.role = 'owner' and m.status = 'active'
           order by m.joined_at limit 1
        )`,
      })
      .from(households)
      .leftJoin(subscriptions, eq(subscriptions.householdId, households.id))
      .where(isNull(households.deletedAt))
      .orderBy(desc(households.createdAt))
      .limit(200),
    db.select({ value: count() }).from(transactions).where(isNull(transactions.deletedAt)),
    loadGrowthMetrics(),
  ]);

  const withActivity = rows.filter((row) => row.lastActivity !== null).length;

  return (
    <Console current="households" email={session.email} role={session.role}>
      <ConsolePage
        title="Households"
        detail="Aggregates only. Nothing on this page reveals what a household spends money on; opening their rows should be a separate, audited action."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Metric
            label="Households"
            value={rows.length}
            detail={rows.length === 200 ? 'The 200 most recent' : 'All of them'}
          />
          <Metric
            label="With any activity"
            value={withActivity}
            detail="Have recorded at least one transaction"
          />
          <Metric
            label="Transactions"
            value={totals[0]?.value ?? 0}
            detail="Across the whole platform"
          />
        </div>

        <Section title="Created per week" detail="Over the last twelve weeks." className="mt-14">
          <div className="rounded-(--radius-lg) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] p-6 shadow-(--shadow-card)">
            <Series
              buckets={growth.householdsByWeek}
              label="Households created per week over the last twelve weeks"
              emptyTitle="No household has been created in the last twelve weeks"
              emptyBody="A column appears here for each week somebody creates one, whether they sign up or an administrator creates it for them below."
            />
          </div>
        </Section>

        <Section
          title="Create one"
          detail="For an existing customer, use the email they sign in with. For an address with no account, one is created and its password is shown once."
          className="mt-14"
        >
          <NewHouseholdForm productUrl={getClientEnv().NEXT_PUBLIC_APP_URL} />
        </Section>

        <Section title="All of them" className="mt-14">
          {rows.length === 0 ? (
            <EmptyState
              title="No households yet"
              body="A household is created when somebody signs up and names one, or from the form above. Every figure on the Overview screen is an aggregate over this list, which is why they all read zero."
            />
          ) : (
            <Ledger caption="Households">
              <LedgerHead>
                <LedgerColumn>Household</LedgerColumn>
                <LedgerColumn>Owner</LedgerColumn>
                <LedgerColumn>Plan</LedgerColumn>
                <LedgerColumn align="end">People</LedgerColumn>
                <LedgerColumn align="end">Transactions</LedgerColumn>
                <LedgerColumn align="end">Last activity</LedgerColumn>
                <LedgerColumn align="end">Created</LedgerColumn>
              </LedgerHead>
              <LedgerBody>
                {rows.map((row) => (
                  <LedgerRow key={row.id}>
                    <LedgerCell>{row.name}</LedgerCell>
                    <LedgerCell secondary>{row.owner ?? '—'}</LedgerCell>
                    <LedgerCell>
                      <Status tone={row.status === 'active' ? 'positive' : 'neutral'}>
                        {row.plan ?? 'FREE'}
                      </Status>
                    </LedgerCell>
                    <LedgerCell align="end">
                      <span className="tabular">{row.members}</span>
                    </LedgerCell>
                    <LedgerCell align="end">
                      <span className="tabular">{row.transactions}</span>
                    </LedgerCell>
                    <LedgerCell align="end" secondary>
                      <span className="tabular">{row.lastActivity ?? 'never'}</span>
                    </LedgerCell>
                    <LedgerCell align="end" secondary>
                      <span className="tabular">{row.createdAt.toISOString().slice(0, 10)}</span>
                    </LedgerCell>
                  </LedgerRow>
                ))}
              </LedgerBody>
            </Ledger>
          )}
        </Section>
      </ConsolePage>
    </Console>
  );
}
