import { formatMoney, type Money } from '@app/domain';
import {
  EmptyState,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Problem,
  Section,
  Status,
} from '@app/ui';

import { ConsolePage, Metric, Share } from '@/components/figures';
import { Console } from '@/components/shell';
import { loadRevenueMetrics } from '@/server/analytics';
import { requireAdmin } from '@/server/guard';

export const dynamic = 'force-dynamic';

/**
 * Sales.
 *
 * Three things, in the order somebody asks them: what is coming in, where it
 * comes from, and whether the two records of it agree.
 *
 * The reconciliation at the foot is the part worth keeping. MRR is derived
 * from subscription rows; recognized revenue is summed from journal lines.
 * Nothing forces them to match, and a console that showed only one would let
 * them drift apart silently for months. Showing the difference makes a
 * divergence an event rather than a discovery.
 *
 * Restricted to `finance_admin`. A support administrator can see a
 * subscription's state on a household; they have no business reading the
 * company's books.
 */
export default async function RevenuePage() {
  const session = await requireAdmin('finance_admin');
  const revenue = await loadRevenueMetrics();

  const money = (value: Money) => formatMoney(value, { locale: 'en-US' });
  const hasCustomers = revenue.snapshot.customers > 0;
  const difference = revenue.revenueRecognized.subtract(revenue.snapshot.mrr);
  const totalSubscribers = revenue.planMix.reduce((sum, plan) => sum + plan.subscribers, 0);

  return (
    <Console current="revenue" email={session.email} role={session.role}>
      <ConsolePage
        title="Revenue"
        detail="What the business earns, where it comes from, and whether the two records of it agree."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="MRR" value={money(revenue.snapshot.mrr)} tone="brand" />
          <Metric label="ARR" value={money(revenue.snapshot.arr)} />
          <Metric
            label="Paying households"
            value={revenue.snapshot.customers}
            detail="Active, past due or in grace"
          />
          <Metric
            label="ARPU"
            value={hasCustomers ? money(revenue.snapshot.arpu) : '—'}
            detail={hasCustomers ? 'Per paying household' : 'Undefined with no paying households'}
          />
        </div>

        {!revenue.hasProvider && (
          <div className="mt-8">
            <Problem
              title="No payment processor is connected"
              body="Every subscription row is currently internal: none carries a provider reference, so nothing here was collected through Stripe or any other processor. These figures describe what the catalogue says households would owe, not money that has moved."
            />
          </div>
        )}

        <Section
          title="Where it comes from"
          detail="Each active plan, how many households are on it, and what that plan contributes to MRR. An annual plan contributes a twelfth of its price."
          className="mt-14"
        >
          {revenue.planMix.length === 0 ? (
            <EmptyState
              title="The plan catalogue is empty"
              body="Prices live in platform.plans and are read, never hardcoded. With no active plan there is nothing to sell and nothing to show."
            />
          ) : (
            <Ledger caption="Plan mix">
              <LedgerHead>
                <LedgerColumn>Plan</LedgerColumn>
                <LedgerColumn align="end">Price</LedgerColumn>
                <LedgerColumn align="end">Households</LedgerColumn>
                <LedgerColumn align="end">MRR contribution</LedgerColumn>
              </LedgerHead>
              <LedgerBody>
                {revenue.planMix.map((plan) => (
                  <LedgerRow key={plan.code}>
                    <LedgerCell>
                      {plan.name}
                      <span className="ml-2 text-xs text-[color:var(--color-ink-tertiary)]">
                        {plan.code}
                      </span>
                    </LedgerCell>
                    <LedgerCell align="end">
                      <span className="tabular">
                        {plan.price.isZero()
                          ? 'Free'
                          : `${money(plan.price)} / ${plan.interval === 'year' ? 'yr' : 'mo'}`}
                      </span>
                    </LedgerCell>
                    <LedgerCell align="end">
                      <span className="tabular">{plan.subscribers}</span>
                    </LedgerCell>
                    <LedgerCell align="end">
                      <span className="tabular">{money(plan.mrr)}</span>
                    </LedgerCell>
                  </LedgerRow>
                ))}
              </LedgerBody>
            </Ledger>
          )}

          {totalSubscribers > 0 && (
            <div className="mt-8">
              <Share
                total={totalSubscribers}
                rows={revenue.planMix
                  .filter((plan) => plan.subscribers > 0)
                  .map((plan) => ({
                    key: plan.code,
                    label: plan.name,
                    value: plan.subscribers,
                    detail: money(plan.mrr),
                  }))}
                empty={null}
              />
            </div>
          )}
        </Section>

        <Section
          title="Subscription states"
          detail="Past due and grace are still customers. Dropping them the day a card fails overstates churn and understates what is recoverable."
          className="mt-14"
        >
          {revenue.byStatus.length === 0 ? (
            <EmptyState
              title="No subscriptions yet"
              body="A household without a subscription row is on the free plan. When the first one is created — by a processor webhook or by hand — its state appears here."
            />
          ) : (
            <ul className="flex flex-wrap gap-3">
              {revenue.byStatus.map((row) => (
                <li
                  key={row.status}
                  className="rounded-(--radius-lg) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-5 py-4 shadow-(--shadow-card)"
                >
                  <p className="readout text-2xl leading-none">{row.households}</p>
                  <p className="mt-2 text-xs text-[color:var(--color-ink-secondary)]">
                    {row.status.replace(/_/g, ' ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Invoices" className="mt-14">
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="Issued" value={revenue.invoices.issued} />
            <Metric
              label="Paid"
              value={revenue.invoices.paid}
              detail={
                revenue.invoices.issued === 0
                  ? 'Nothing issued yet'
                  : `${String(revenue.invoices.issued - revenue.invoices.paid)} outstanding`
              }
            />
            <Metric
              label="Outstanding"
              value={money(revenue.invoices.outstanding)}
              detail="Issued and not yet paid"
            />
          </div>
        </Section>

        <Section
          title="Reconciliation"
          detail="MRR is derived from subscription rows. Recognized revenue is summed from journal lines in account 4000. Nothing forces them to agree, which is exactly why both are shown."
          className="mt-14"
        >
          <Ledger caption="MRR against the ledger">
            <LedgerBody>
              <LedgerRow>
                <LedgerCell>MRR, from subscriptions</LedgerCell>
                <LedgerCell align="end">
                  <span className="tabular">{money(revenue.snapshot.mrr)}</span>
                </LedgerCell>
              </LedgerRow>
              <LedgerRow>
                <LedgerCell>Revenue recognized, from the ledger</LedgerCell>
                <LedgerCell align="end">
                  <span className="tabular">{money(revenue.revenueRecognized)}</span>
                </LedgerCell>
              </LedgerRow>
              <LedgerRow>
                <LedgerCell>
                  <span className="font-medium">Difference</span>
                </LedgerCell>
                <LedgerCell align="end">
                  <span className="tabular font-medium">{money(difference)}</span>
                </LedgerCell>
              </LedgerRow>
            </LedgerBody>
          </Ledger>

          <p className="mt-4 flex flex-wrap items-center gap-3">
            <Status tone={difference.isZero() ? 'positive' : 'caution'}>
              {difference.isZero() ? 'In agreement' : 'They disagree'}
            </Status>
            <span className="max-w-[72ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              {difference.isZero()
                ? 'Both are zero, which agrees trivially — there is nothing to reconcile until money moves.'
                : 'The two should describe the same business. A standing difference means a subscription is not being posted to the ledger, or an entry was posted that no subscription accounts for.'}
            </span>
          </p>
        </Section>

        <Section
          title="Movement"
          detail="New, expansion, contraction and churn, month over month."
          className="mt-14"
        >
          <EmptyState
            title="No movement analysis yet"
            body="A movement needs a previous snapshot to compare against, and nothing stores one. Computing it against an empty set would report every customer as new, every month — which is worse than an empty panel, because it looks like an answer."
          />
        </Section>
      </ConsolePage>
    </Console>
  );
}
