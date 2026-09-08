import {
  EmptyState,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Status,
} from '@app/ui';
import { featureFlags } from '@app/database/schema';
import { asc, sql } from 'drizzle-orm';

import { ConsolePage } from '@/components/figures';
import { Console } from '@/components/shell';
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

  // One statement, not one per flag. Written as a query inside a `map` this
  // was seven round trips to a database a region away for a screen with seven
  // rows on it, which is the same shape of mistake that made the overview
  // screen time out.
  const flags = await db
    .select({
      key: featureFlags.key,
      description: featureFlags.description,
      defaultEnabled: featureFlags.defaultEnabled,
      overrides: sql<number>`(
        select count(*)::int from platform.feature_flag_overrides o
         where o.flag_key = ${featureFlags.key}
      )`,
    })
    .from(featureFlags)
    .orderBy(asc(featureFlags.key));

  return (
    <Console current="flags" email={session.email} role={session.role}>
      <ConsolePage
        title="Feature flags"
        detail="Resolved most specific first: user, then household, then organization, then global, then the default."
      >
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
              {flags.map((flag) => (
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
                  <LedgerCell align="end">
                    <span className="tabular">{flag.overrides}</span>
                  </LedgerCell>
                </LedgerRow>
              ))}
            </LedgerBody>
          </Ledger>
        )}

        <footer className="mt-16 border-t border-[color:var(--color-rule)] pt-6">
          <p className="max-w-[72ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
            Read-only. Toggling a flag safely means writing the before and after to the admin audit
            trail first, and shipping the button before that exists is how an incident ends up with
            no explanation.
          </p>
        </footer>
      </ConsolePage>
    </Console>
  );
}
