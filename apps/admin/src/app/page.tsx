import { microsToMoney } from '@app/ai';
import { formatMoney } from '@app/domain';
import {
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Page,
  PageHeader,
  Rule,
  Section,
  Status,
} from '@app/ui';

import { AdminNav } from '@/components/shell';
import { loadProductMetrics, loadRevenueMetrics } from '@/server/analytics';
import { requireAdmin } from '@/server/guard';

export const dynamic = 'force-dynamic';

/**
 * The overview.
 *
 * It answers the questions the specification asks a platform to answer: how many
 * households, how many are active, how much has been processed, what the
 * assistant costs, and what the business earns. Every figure is a count or a sum
 * over rows.
 *
 * MRR and recognized revenue sit side by side on purpose. They are two views of
 * the same business and they should agree; putting them next to each other is
 * what turns a disagreement into something somebody notices.
 */
export default async function OverviewPage() {
  const session = await requireAdmin();
  const [product, revenue] = await Promise.all([loadProductMetrics(), loadRevenueMetrics()]);

  const money = (value: Parameters<typeof formatMoney>[0]) =>
    formatMoney(value, { locale: 'en-US' });

  const rows: readonly { label: string; value: string | number }[] = [
    { label: 'Households', value: product.households },
    { label: 'Active in the last 30 days', value: product.activeHouseholds },
    { label: 'Accounts', value: product.accounts },
    { label: 'Transactions processed', value: product.transactions },
    { label: 'Documents imported', value: product.documents },
    {
      label: 'Categorized without a correction',
      value:
        product.automaticCategorization === null
          ? '—'
          : `${(product.automaticCategorization * 100).toFixed(1)}%`,
    },
    { label: 'Assistant requests', value: product.aiInvocations },
    {
      label: 'Estimated assistant spend',
      value: money(microsToMoney(product.aiCostMicros, 'USD')),
    },
  ];

  return (
    <Page>
      <AdminNav current="overview" email={session.email} />

      <PageHeader
        title="Overview"
        detail="Counted, never estimated. Every figure here is a count or a sum over rows."
      />

      <Section title="Product">
        <Ledger caption="Product metrics">
          <LedgerHead>
            <LedgerColumn>Measure</LedgerColumn>
            <LedgerColumn align="end">Value</LedgerColumn>
          </LedgerHead>
          <LedgerBody>
            {rows.map((row) => (
              <LedgerRow key={row.label}>
                <LedgerCell>{row.label}</LedgerCell>
                <LedgerCell align="end">{row.value}</LedgerCell>
              </LedgerRow>
            ))}
          </LedgerBody>
        </Ledger>
      </Section>

      <Section
        title="Revenue"
        detail="MRR comes from subscriptions; recognized revenue comes from the ledger. They should agree."
        className="mt-16"
      >
        <Ledger caption="Revenue metrics">
          <LedgerHead>
            <LedgerColumn>Measure</LedgerColumn>
            <LedgerColumn align="end">Value</LedgerColumn>
          </LedgerHead>
          <LedgerBody>
            <LedgerRow>
              <LedgerCell>MRR</LedgerCell>
              <LedgerCell align="end">{money(revenue.snapshot.mrr)}</LedgerCell>
            </LedgerRow>
            <LedgerRow>
              <LedgerCell>ARR</LedgerCell>
              <LedgerCell align="end">{money(revenue.snapshot.arr)}</LedgerCell>
            </LedgerRow>
            <LedgerRow>
              <LedgerCell>Paying customers</LedgerCell>
              <LedgerCell align="end">{revenue.snapshot.customers}</LedgerCell>
            </LedgerRow>
            <LedgerRow>
              <LedgerCell>ARPU</LedgerCell>
              <LedgerCell align="end">{money(revenue.snapshot.arpu)}</LedgerCell>
            </LedgerRow>
            <LedgerRow>
              <LedgerCell>Revenue recognized in the ledger</LedgerCell>
              <LedgerCell align="end">{money(revenue.revenueRecognized)}</LedgerCell>
            </LedgerRow>
          </LedgerBody>
        </Ledger>

        {revenue.movement === null && (
          <p className="mt-6 flex flex-wrap items-baseline gap-3">
            <Status tone="neutral">No movement yet</Status>
            <span className="max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              A movement analysis needs a previous snapshot and nothing stores one yet. Computing it
              against an empty set would report every customer as new, every month.
            </span>
          </p>
        )}
      </Section>

      <Rule className="mt-16" />
      <footer className="mt-6">
        <p className="max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
          &ldquo;Active&rdquo; means a household with a transaction in the last thirty days. Every
          SaaS means something different by it, and a metric nobody can define is a metric nobody
          can act on.
        </p>
      </footer>
    </Page>
  );
}
