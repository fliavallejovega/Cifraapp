import { microsToMoney } from '@app/ai';
import { formatMoney, type Money } from '@app/domain';
import { EmptyState, Section, Status } from '@app/ui';
import Link from 'next/link';

import { ConsolePage, Metric, Series } from '@/components/figures';
import { Console } from '@/components/shell';
import {
  loadAssistantMetrics,
  loadGrowthMetrics,
  loadProductMetrics,
  loadRevenueMetrics,
  loadSecurityMetrics,
} from '@/server/analytics';
import { requireAdmin } from '@/server/guard';

export const dynamic = 'force-dynamic';

/**
 * The overview.
 *
 * It answers, in one screen, the five questions somebody running this business
 * actually opens a console to ask: what is it earning, who is using it, is
 * anything broken, what is it costing to run, and is it growing.
 *
 * The revenue reading sits on the ink panel because it is the screen's one
 * headline, which is the product's rule for its own screens too. What it does
 * not get is a gauge: a gauge reports a quantity against a marked scale, and
 * MRR has no ceiling to mark. Drawing one would be decoration wearing the
 * costume of the product's signature device.
 *
 * There is no target, no forecast and no «vs. last month» on a business with
 * no previous month recorded. Everything absent here is absent because the row
 * that would support it does not exist yet, and each empty state says which.
 */
export default async function OverviewPage() {
  const session = await requireAdmin();
  const [product, revenue, growth, assistant, security] = await Promise.all([
    loadProductMetrics(),
    loadRevenueMetrics(),
    loadGrowthMetrics(),
    loadAssistantMetrics(),
    loadSecurityMetrics(),
  ]);

  const money = (value: Money) => formatMoney(value, { locale: 'en-US' });
  const assistantSpend = microsToMoney(assistant.costMicros, 'USD');

  const hasCustomers = revenue.snapshot.customers > 0;
  const hasAnybody = product.people > 0;

  return (
    <Console current="overview" email={session.email} role={session.role}>
      <ConsolePage
        title="Overview"
        detail="Counted, never estimated. Every figure on this screen is a count or a sum over rows, and anything that cannot be counted yet says so instead of showing a zero."
      >
        {/* The headline: what the business earns. */}
        <div className="panel-scope rounded-(--radius-xl) bg-[color:var(--color-panel)] p-6 text-[color:var(--color-panel-ink)] shadow-(--shadow-card) sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-8">
            <div>
              <p className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-panel-ink-secondary)] uppercase">
                Monthly recurring revenue
              </p>
              <p className="readout mt-3 text-5xl leading-none sm:text-6xl">
                {money(revenue.snapshot.mrr)}
              </p>
              <p className="mt-3 text-sm text-[color:var(--color-panel-ink-secondary)]">
                {hasCustomers
                  ? `${String(revenue.snapshot.customers)} paying ${
                      revenue.snapshot.customers === 1 ? 'household' : 'households'
                    } · ${money(revenue.snapshot.arpu)} each on average · ${money(revenue.snapshot.arr)} annualized`
                  : 'Nobody is paying yet. This reads zero because it is zero, not because the query failed.'}
              </p>
            </div>

            <dl className="flex flex-wrap gap-x-10 gap-y-4">
              <div>
                <dt className="text-xs text-[color:var(--color-panel-ink-secondary)]">ARR</dt>
                <dd className="readout mt-1 text-xl">{money(revenue.snapshot.arr)}</dd>
              </div>
              <div>
                <dt className="text-xs text-[color:var(--color-panel-ink-secondary)]">
                  Recognized in the ledger
                </dt>
                <dd className="readout mt-1 text-xl">{money(revenue.revenueRecognized)}</dd>
              </div>
            </dl>
          </div>

          <p className="mt-6 max-w-[76ch] text-xs text-pretty text-[color:var(--color-panel-ink-secondary)]">
            MRR is computed from subscriptions; recognized revenue is summed from journal lines.
            They are two views of one business and they should agree — they sit together so a
            disagreement is something somebody notices rather than something one authoritative
            number hides.
          </p>
        </div>

        {/* Who is here, and what they are doing with it. */}
        <Section title="The product" className="mt-14">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="People"
              value={product.people}
              detail={
                hasAnybody
                  ? `${String(product.households)} ${product.households === 1 ? 'household' : 'households'}`
                  : 'Nobody has signed up yet'
              }
            />
            <Metric
              label="Active households"
              value={product.activeHouseholds}
              detail="With a transaction in the last thirty days"
            />
            <Metric
              label="Transactions"
              value={product.transactions}
              detail={`${String(product.documents)} ${
                product.documents === 1 ? 'document' : 'documents'
              } imported · ${String(product.accounts)} ${
                product.accounts === 1 ? 'account' : 'accounts'
              }`}
            />
            <Metric
              label="Categorized automatically"
              value={
                product.automaticCategorization === null
                  ? '—'
                  : `${(product.automaticCategorization * 100).toFixed(1)}%`
              }
              detail={
                product.automaticCategorization === null
                  ? 'No transaction has been categorized yet, and a rate over no rows is not a rate'
                  : `${String(product.needsReview)} still need review`
              }
            />
          </div>
        </Section>

        {/* Growth. */}
        <Section
          title="Arrivals"
          detail="New sign-ups per week, over the last twelve. Every week is drawn, including the empty ones — a chart that skips its zeros draws a different shape than the truth."
          className="mt-14"
        >
          <div className="rounded-(--radius-lg) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] p-6 shadow-(--shadow-card)">
            <Series
              buckets={growth.signupsByWeek}
              label="New sign-ups per week over the last twelve weeks"
              emptyTitle="Nobody has signed up in the last twelve weeks"
              emptyBody="Each week someone creates an account, a column appears here. Until then there is nothing to draw, and twelve flat stubs would read as a broken chart rather than as an honest nothing."
            />
            {growth.totalSignups > 0 && (
              <p className="mt-6 border-t border-[color:var(--color-rule)] pt-4 text-sm text-[color:var(--color-ink-secondary)]">
                {growth.signupsLast30} in the last thirty days, {growth.signupsPrevious30} in the
                thirty before that.
                {growth.signupsPrevious30 === 0 &&
                  ' No comparison is drawn from a previous period with nothing in it.'}
              </p>
            )}
          </div>
        </Section>

        {/* What it costs to run, and whether anything is on fire. */}
        <Section title="Running it" className="mt-14">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Assistant spend"
              value={money(assistantSpend)}
              detail={`${String(assistant.requests)} ${
                assistant.requests === 1 ? 'request' : 'requests'
              }${assistant.broken > 0 ? ` · ${String(assistant.broken)} failed` : ''}`}
            />
            <Metric
              label="Administrators"
              value={security.administrators}
              detail="Each granted row by row in platform.admin_users"
            />
            <Metric
              label="Two-step verification"
              value={
                security.people === 0
                  ? '—'
                  : `${String(security.withTwoFactor)}/${String(security.people)}`
              }
              detail={
                security.people === 0
                  ? 'No accounts yet'
                  : security.withTwoFactor === security.people
                    ? 'Everybody has it on'
                    : 'People with an authenticator enrolled'
              }
              tone={
                security.people > 0 && security.withTwoFactor < security.people ? 'muted' : 'plain'
              }
            />
            <Metric
              label="Open invitations"
              value={security.pendingInvitations}
              detail={
                security.expiredInvitations > 0
                  ? `${String(security.expiredInvitations)} expired unaccepted`
                  : 'None expired unaccepted'
              }
            />
          </div>
        </Section>

        {!hasCustomers && (
          <Section title="" className="mt-14">
            <EmptyState
              title="There is no revenue to analyse yet"
              body="Plan mix, churn and cohort movement all need at least one paying subscription before they mean anything. The queries exist and the screens are built; they are showing you what they will show you, which today is nothing."
              action={
                <Link
                  href="/revenue"
                  className="text-sm font-medium underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
                >
                  See the plan catalogue
                </Link>
              }
            />
          </Section>
        )}

        <footer className="mt-16 border-t border-[color:var(--color-rule)] pt-6">
          <p className="flex flex-wrap items-center gap-3 text-xs text-[color:var(--color-ink-tertiary)]">
            <Status tone="neutral">Definitions</Status>
            <span className="max-w-[76ch] text-pretty">
              &ldquo;Active&rdquo; is a household with a transaction in the last thirty days.
              &ldquo;Paying&rdquo; counts a subscription that is active, past due or in grace — past
              due is still a customer, and dropping them the day a card fails overstates churn.
              Every SaaS means something different by both, and a metric nobody can define is a
              metric nobody can act on.
            </span>
          </p>
        </footer>
      </ConsolePage>
    </Console>
  );
}
