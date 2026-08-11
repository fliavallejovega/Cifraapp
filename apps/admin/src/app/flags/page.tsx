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
  Status,
} from '@app/ui';
import { featureFlagOverrides, featureFlags } from '@app/database/schema';
import { asc, eq } from 'drizzle-orm';

import { AdminNav } from '@/components/shell';
import { adminDb } from '@/server/admin-session';
import { requireAdmin } from '@/server/guard';

export const dynamic = 'force-dynamic';

/**
 * Feature flags and their overrides.
 *
 * Read-only for now, and that is a deliberate stopping point rather than an
 * omission. Toggling a flag from a screen is one line of code; toggling it
 * *safely* means writing to `audit.admin_actions` first, recording the before
 * and after, and deciding who may do it — and shipping the button before that
 * exists is how a production incident acquires no explanation.
 */
export default async function FlagsPage() {
  const session = await requireAdmin();
  const db = adminDb();

  const flags = await db
    .select({
      key: featureFlags.key,
      description: featureFlags.description,
      defaultEnabled: featureFlags.defaultEnabled,
    })
    .from(featureFlags)
    .orderBy(asc(featureFlags.key));

  const overrides = await Promise.all(
    flags.map(async (flag) => ({
      key: flag.key,
      rows: await db
        .select({
          scope: featureFlagOverrides.scope,
          targetId: featureFlagOverrides.targetId,
          enabled: featureFlagOverrides.enabled,
        })
        .from(featureFlagOverrides)
        .where(eq(featureFlagOverrides.flagKey, flag.key)),
    })),
  );

  return (
    <Page>
      <AdminNav current="flags" email={session.email} />

      <PageHeader
        title="Feature flags"
        detail="Resolved most specific first: user, then household, then organization, then global, then the default."
      />

      {flags.length === 0 ? (
        <EmptyState title="No flags defined" body="Flags are rows; the migration seeds seven." />
      ) : (
        <Ledger caption="Feature flags">
          <LedgerHead>
            <LedgerColumn>Key</LedgerColumn>
            <LedgerColumn>What it covers</LedgerColumn>
            <LedgerColumn align="end">Default</LedgerColumn>
            <LedgerColumn align="end">Overrides</LedgerColumn>
          </LedgerHead>
          <LedgerBody>
            {flags.map((flag) => {
              const rows = overrides.find((entry) => entry.key === flag.key)?.rows ?? [];

              return (
                <LedgerRow key={flag.key}>
                  <LedgerCell>{flag.key}</LedgerCell>
                  <LedgerCell secondary>{flag.description}</LedgerCell>
                  <LedgerCell align="end">
                    {flag.defaultEnabled ? (
                      <Status tone="caution">on</Status>
                    ) : (
                      <span className="text-[color:var(--color-ink-secondary)]">off</span>
                    )}
                  </LedgerCell>
                  <LedgerCell align="end">{rows.length}</LedgerCell>
                </LedgerRow>
              );
            })}
          </LedgerBody>
        </Ledger>
      )}

      <Rule className="mt-16" />
      <footer className="mt-6">
        <p className="max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
          Read-only. Toggling a flag safely means writing the before and after to the admin audit
          trail first, and shipping the button before that exists is how an incident ends up with no
          explanation.
        </p>
      </footer>
    </Page>
  );
}
