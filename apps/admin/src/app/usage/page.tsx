import { microsToMoney } from '@app/ai';
import { formatMoney, type Money } from '@app/domain';
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

import { ConsolePage, Metric, Share } from '@/components/figures';
import { Console } from '@/components/shell';
import { loadAssistantMetrics, loadProductMetrics } from '@/server/analytics';
import { requireAdmin } from '@/server/guard';

export const dynamic = 'force-dynamic';

/**
 * What the product is being used for, and what that costs.
 *
 * The assistant is the only part of this system with a marginal cost per use,
 * so it is the only part whose spend needs watching daily. Everything here is
 * a sum over `app.ai_invocations`, a table written on every call whether it
 * succeeded, failed or came back from cache.
 *
 * Latency is reported as a median rather than a mean, deliberately: one
 * forty-second timeout drags a mean somewhere useless and leaves the typical
 * request undescribed.
 */
export default async function UsagePage() {
  const session = await requireAdmin();
  const [product, assistant] = await Promise.all([loadProductMetrics(), loadAssistantMetrics()]);

  const money = (value: Money) => formatMoney(value, { locale: 'en-US' });
  const spend = (micros: bigint) => money(microsToMoney(micros, 'USD'));

  const cacheRate =
    assistant.requests > 0 ? (assistant.cacheHits / assistant.requests) * 100 : null;
  const failureRate =
    assistant.requests > 0 ? (assistant.failures / assistant.requests) * 100 : null;

  return (
    <Console current="usage" email={session.email} role={session.role}>
      <ConsolePage
        title="Usage"
        detail="What the product is being asked to do, and what the assistant costs to answer it."
      >
        <Section title="Data in the system">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Transactions" value={product.transactions} />
            <Metric label="Accounts" value={product.accounts} />
            <Metric label="Documents imported" value={product.documents} />
            <Metric
              label="Awaiting review"
              value={product.needsReview}
              detail="An item routed to review is a correct outcome, not a failure"
            />
          </div>

          <p className="mt-6 flex flex-wrap items-center gap-3">
            <Status tone={product.automaticCategorization === null ? 'neutral' : 'positive'}>
              {product.automaticCategorization === null
                ? 'No rate yet'
                : `${(product.automaticCategorization * 100).toFixed(1)}% automatic`}
            </Status>
            <span className="max-w-[72ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              {product.automaticCategorization === null
                ? 'Nothing has been categorized, and a rate over no rows is not a rate — it is reported as nothing rather than as a hundred percent.'
                : 'Transactions the system categorized without a person correcting it afterwards. Never described as «fully automated»: the figure and the review count are both shown because both are true.'}
            </span>
          </p>
        </Section>

        <Section
          title="The assistant"
          detail="Every call is recorded, whether it succeeded, failed, or was answered from cache."
          className="mt-14"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Requests" value={assistant.requests} />
            <Metric label="Spend" value={spend(assistant.costMicros)} tone="brand" />
            <Metric
              label="Answered from cache"
              value={cacheRate === null ? '—' : `${cacheRate.toFixed(0)}%`}
              detail={cacheRate === null ? 'No requests yet' : 'A cache hit costs nothing'}
            />
            <Metric
              label="Median latency"
              value={
                assistant.medianLatencyMs === null ? '—' : `${String(assistant.medianLatencyMs)} ms`
              }
              detail="The median, not the mean: one timeout should not describe every request"
            />
          </div>

          {assistant.requests === 0 && (
            <div className="mt-8">
              <EmptyState
                title="The assistant has not been used yet"
                body="Requests are written to app.ai_invocations on every call. Once somebody asks a question or opens the advice screen, the spend, the cache rate and the per-feature breakdown fill in here."
              />
            </div>
          )}
        </Section>

        {assistant.byFeature.length > 0 && (
          <Section
            title="Where the spend goes"
            detail="By feature, then by model."
            className="mt-14"
          >
            <div className="grid gap-10 lg:grid-cols-2">
              <div>
                <p className="mb-4 text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
                  By feature
                </p>
                <Share
                  total={assistant.requests}
                  rows={assistant.byFeature.map((entry) => ({
                    key: entry.feature,
                    label: entry.feature.replace(/[-_]/g, ' '),
                    value: entry.requests,
                    detail: spend(entry.costMicros),
                  }))}
                  empty={null}
                />
              </div>
              <div>
                <p className="mb-4 text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
                  By model
                </p>
                <Share
                  total={assistant.requests}
                  rows={assistant.byModel.map((entry) => ({
                    key: entry.model,
                    label: entry.model,
                    value: entry.requests,
                    detail: spend(entry.costMicros),
                  }))}
                  empty={null}
                />
              </div>
            </div>
          </Section>
        )}

        <Section
          title="Failures"
          detail={
            failureRate === null
              ? 'A refusal is recorded as a failed call, and a refusal is often the correct outcome.'
              : `${failureRate.toFixed(1)}% of calls did not succeed. A guardrail refusal counts here, and a refusal is often the correct outcome.`
          }
          className="mt-14"
        >
          {assistant.recentFailures.length === 0 ? (
            <EmptyState
              title="No failed calls"
              body="When a call fails or a guardrail rejects an answer, the engine's own words are recorded and the ten most recent appear here. A provider's response body never is: those echo household facts back."
            />
          ) : (
            <Ledger caption="Recent assistant failures">
              <LedgerHead>
                <LedgerColumn>Feature</LedgerColumn>
                <LedgerColumn>Outcome</LedgerColumn>
                <LedgerColumn>Detail</LedgerColumn>
                <LedgerColumn align="end">When</LedgerColumn>
              </LedgerHead>
              <LedgerBody>
                {assistant.recentFailures.map((failure, index) => (
                  <LedgerRow key={`${failure.feature}-${String(index)}`}>
                    <LedgerCell>{failure.feature.replace(/[-_]/g, ' ')}</LedgerCell>
                    <LedgerCell>
                      <Status tone="caution">{failure.outcome}</Status>
                    </LedgerCell>
                    <LedgerCell secondary>{failure.detail ?? '—'}</LedgerCell>
                    <LedgerCell align="end" secondary>
                      <span className="tabular">{failure.at.toISOString().slice(0, 16)}</span>
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
