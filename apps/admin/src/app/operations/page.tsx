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
import { loadOperationsMetrics, loadSecurityMetrics } from '@/server/analytics';
import { requireAdmin } from '@/server/guard';

export const dynamic = 'force-dynamic';

/**
 * The things that break at night.
 *
 * The queue first, because a stuck job is the one failure mode a customer
 * feels without being told: their import never finishes and the screen just
 * keeps saying «working». A job claimed and still claimed fifteen minutes
 * later is a worker that died mid-flight, and it is the single number here
 * worth waking somebody for.
 *
 * The schema version at the foot is not decoration. A deployment whose code
 * expects migration 28 against a database at 27 fails in ways that look like
 * anything else, and having both stated in one place has already saved one
 * afternoon.
 */
export default async function OperationsPage() {
  const session = await requireAdmin();
  const [ops, security] = await Promise.all([loadOperationsMetrics(), loadSecurityMetrics()]);

  const totalJobs = ops.byStatus.reduce((sum, row) => sum + row.jobs, 0);
  const failed = ops.byStatus.find((row) => row.status === 'failed')?.jobs ?? 0;
  const queued = ops.byStatus.find((row) => row.status === 'queued')?.jobs ?? 0;

  return (
    <Console current="operations" email={session.email} role={session.role}>
      <ConsolePage
        title="Operations"
        detail="The background queue, the schema the deployment is running against, and the security posture of the accounts that can reach any of it."
      >
        {ops.stuck > 0 && (
          <div className="mb-8">
            <Problem
              title={`${String(ops.stuck)} ${ops.stuck === 1 ? 'job has' : 'jobs have'} been running for over fifteen minutes`}
              body="A job claimed and still claimed this long is a worker that died mid-flight. The household sees an import that never finishes, and nothing will retry it until the stale claim is released."
            />
          </div>
        )}

        <Section title="The queue">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Jobs, all time" value={totalJobs} />
            <Metric label="Waiting" value={queued} detail="Queued and not yet claimed" />
            <Metric
              label="Failed"
              value={failed}
              detail={failed === 0 ? 'Nothing has failed' : 'After exhausting their attempts'}
              tone={failed > 0 ? 'brand' : 'plain'}
            />
            <Metric
              label="Stuck"
              value={ops.stuck}
              detail="Claimed over fifteen minutes ago and never finished"
            />
          </div>

          {totalJobs === 0 ? (
            <div className="mt-8">
              <EmptyState
                title="Nothing has been queued yet"
                body="Imports, duplicate scans, transfer detection and categorization all run through app.jobs. The queue fills the first time somebody uploads a statement."
              />
            </div>
          ) : (
            <div className="mt-8 grid gap-10 lg:grid-cols-2">
              <div>
                <p className="mb-4 text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
                  By state
                </p>
                <Share
                  total={totalJobs}
                  rows={ops.byStatus.map((row) => ({
                    key: row.status,
                    label: row.status,
                    value: row.jobs,
                  }))}
                  empty={null}
                />
              </div>
              <div>
                <p className="mb-4 text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
                  By kind
                </p>
                <Share
                  total={totalJobs}
                  rows={ops.byKind.map((row) => ({
                    key: row.kind,
                    label: row.kind.replace(/[-_.]/g, ' '),
                    value: row.jobs,
                    ...(row.failed > 0 ? { detail: `${String(row.failed)} failed` } : {}),
                  }))}
                  empty={null}
                />
              </div>
            </div>
          )}
        </Section>

        <Section
          title="Recent failures"
          detail="The message is the one the household is shown, so it is written for them rather than for a log."
          className="mt-14"
        >
          {ops.recentFailures.length === 0 ? (
            <EmptyState
              title="No failed jobs"
              body="When a job exhausts its attempts it stops here with the reason it gave up, and the household sees the same sentence."
            />
          ) : (
            <Ledger caption="Recent job failures">
              <LedgerHead>
                <LedgerColumn>Kind</LedgerColumn>
                <LedgerColumn align="end">Attempts</LedgerColumn>
                <LedgerColumn>Why it stopped</LedgerColumn>
                <LedgerColumn align="end">When</LedgerColumn>
              </LedgerHead>
              <LedgerBody>
                {ops.recentFailures.map((failure, index) => (
                  <LedgerRow key={`${failure.kind}-${String(index)}`}>
                    <LedgerCell>{failure.kind.replace(/[-_.]/g, ' ')}</LedgerCell>
                    <LedgerCell align="end">
                      <span className="tabular">{failure.attempts}</span>
                    </LedgerCell>
                    <LedgerCell secondary>{failure.message ?? '—'}</LedgerCell>
                    <LedgerCell align="end" secondary>
                      <span className="tabular">{failure.at.toISOString().slice(0, 16)}</span>
                    </LedgerCell>
                  </LedgerRow>
                ))}
              </LedgerBody>
            </Ledger>
          )}
        </Section>

        <Section
          title="Access"
          detail="Who can reach anything, and what is protecting their account."
          className="mt-14"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Accounts" value={security.people} />
            <Metric
              label="Administrators"
              value={security.administrators}
              detail="Rows in platform.admin_users that are not disabled"
            />
            <Metric
              label="With two-step verification"
              value={
                security.people === 0
                  ? '—'
                  : `${String(security.withTwoFactor)}/${String(security.people)}`
              }
              detail={
                security.people > 0 && security.withTwoFactor < security.people
                  ? 'An account with only a password is one leaked password away'
                  : 'Every account has an authenticator enrolled'
              }
            />
            <Metric
              label="Open invitations"
              value={security.pendingInvitations}
              detail={
                security.expiredInvitations > 0
                  ? `${String(security.expiredInvitations)} expired without being accepted`
                  : 'None expired unaccepted'
              }
            />
          </div>

          {security.people > 0 && security.withTwoFactor < security.administrators && (
            <p className="mt-6 flex flex-wrap items-center gap-3">
              <Status tone="caution">Worth fixing</Status>
              <span className="max-w-[72ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
                At least one administrator has no second factor. An administrator's password is the
                key to every household on the platform, and this console will not ask for anything
                more than that password until they enrol one from the product&apos;s settings.
              </span>
            </p>
          )}
        </Section>

        <Section title="This deployment" className="mt-14">
          <Ledger caption="Deployment">
            <LedgerBody>
              <LedgerRow>
                <LedgerCell>Database schema</LedgerCell>
                <LedgerCell align="end">
                  <span className="tabular">{ops.schemaVersion}</span>
                </LedgerCell>
              </LedgerRow>
              <LedgerRow>
                <LedgerCell secondary>{ops.schemaDescription}</LedgerCell>
                <LedgerCell align="end" secondary>
                  {''}
                </LedgerCell>
              </LedgerRow>
            </LedgerBody>
          </Ledger>
          <p className="mt-4 max-w-[76ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
            Code that expects a later migration than the database is running fails in ways that look
            like anything else. Both facts belong in one place.
          </p>
        </Section>
      </ConsolePage>
    </Console>
  );
}
