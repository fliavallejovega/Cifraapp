import {
  EmptyState,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Page,
  PageHeader,
  Rule,
} from '@app/ui';
import { households, subscriptions, transactions } from '@app/database/schema';
import { getClientEnv } from '@app/validation/env';
import { count, desc, eq, isNull, sql } from 'drizzle-orm';

import { NewHouseholdForm } from '@/components/new-household-form';
import { AdminNav } from '@/components/shell';
import { adminDb } from '@/server/admin-session';
import { requireAdmin } from '@/server/guard';

export const dynamic = 'force-dynamic';

/**
 * Households, as an operational list.
 *
 * What it shows is chosen carefully: enough to answer "is this account healthy
 * and what is it paying", and nothing about what the household actually spends
 * money on. A support tool that displays transaction descriptions exposes a
 * person's medical appointments and their debts to whoever picked up the ticket.
 *
 * The counts are aggregates. Opening a household's actual rows is a separate
 * action that does not exist yet, and when it does it should be logged in
 * `audit.admin_actions` before the first row is read.
 *
 * Creating one is the console's first write, and it is logged before anything
 * else: see `household-actions.ts`.
 */
export default async function HouseholdsPage() {
  const session = await requireAdmin();

  const rows = await adminDb()
    .select({
      id: households.id,
      name: households.name,
      currency: households.baseCurrency,
      createdAt: households.createdAt,
      organizationId: households.organizationId,
      plan: subscriptions.planCode,
      status: subscriptions.status,
      transactions: sql<number>`(
        select count(*)::int from app.transactions t
         where t.household_id = ${households.id} and t.deleted_at is null
      )`,
      owner: sql<string | null>`(
        select p.email from app.household_members m
          join app.profiles p on p.id = m.user_id
         where m.household_id = ${households.id} and m.role = 'owner' and m.status = 'active'
         order by m.joined_at limit 1
      )`,
    })
    .from(households)
    .leftJoin(subscriptions, eq(subscriptions.householdId, households.id))
    .where(isNull(households.deletedAt))
    .orderBy(desc(households.createdAt))
    .limit(200);

  const [total] = await adminDb()
    .select({ value: count() })
    .from(transactions)
    .where(isNull(transactions.deletedAt));

  return (
    <Page>
      <AdminNav current="households" email={session.email} />

      <PageHeader
        title="Households"
        detail={`The 200 most recent. ${String(total?.value ?? 0)} transactions across the platform.`}
      />

      <div className="mb-12">
        <NewHouseholdForm productUrl={getClientEnv().NEXT_PUBLIC_APP_URL} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No households yet"
          body="A household is created when somebody signs up and names one, or from the form above."
        />
      ) : (
        <Ledger caption="Households">
          <LedgerHead>
            <LedgerColumn>Household</LedgerColumn>
            <LedgerColumn>Owner</LedgerColumn>
            <LedgerColumn>Plan</LedgerColumn>
            <LedgerColumn>Status</LedgerColumn>
            <LedgerColumn align="end">Transactions</LedgerColumn>
            <LedgerColumn align="end">Created</LedgerColumn>
          </LedgerHead>
          <LedgerBody>
            {rows.map((row) => (
              <LedgerRow key={row.id}>
                <LedgerCell>{row.name}</LedgerCell>
                <LedgerCell secondary>{row.owner ?? '—'}</LedgerCell>
                <LedgerCell secondary>{row.plan ?? 'FREE'}</LedgerCell>
                <LedgerCell secondary>{row.status ?? 'none'}</LedgerCell>
                <LedgerCell align="end">{row.transactions}</LedgerCell>
                <LedgerCell align="end" secondary>
                  {row.createdAt.toISOString().slice(0, 10)}
                </LedgerCell>
              </LedgerRow>
            ))}
          </LedgerBody>
        </Ledger>
      )}

      <Rule className="mt-16" />
      <footer className="mt-6">
        <p className="max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
          Aggregates only. Nothing on this page reveals what a household spends money on, and
          opening their rows should be a separate, audited action.
        </p>
      </footer>
    </Page>
  );
}
