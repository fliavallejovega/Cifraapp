import { getClientEnv } from '@app/validation/env';
import type { ReactNode } from 'react';

import { AgentLauncher } from '@/components/agent/agent-launcher';
import { AppShell } from '@/components/app-shell';
import { loadSession } from '@/server/session';

/**
 * Every signed-in screen shares one frame: the ink column on desktop, the
 * revealed drawer on a phone, the household and the way out. Before this
 * layout existed each page assembled its own header, which is how the product
 * shipped screens with no navigation between them at all.
 *
 * The layout does not guard. Each page runs `requireHousehold` itself and owns
 * its redirect — a layout that both guarded and rendered would run its check
 * once per navigation type, which is exactly the inconsistency guards must not
 * have. With no session the shell renders empty-named for the instant before
 * the page's own redirect fires.
 */
export default async function ProductLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await loadSession();

  const householdName =
    session?.households.find((household) => household.id === session.activeHouseholdId)?.name ?? '';

  return (
    <AppShell
      locale={locale}
      householdName={householdName}
      consoleUrl={session?.isPlatformAdmin ? (getClientEnv().NEXT_PUBLIC_ADMIN_URL ?? null) : null}
    >
      {children}
      {/* Room under the last row so the assistant's button never sits on it. */}
      {session && <div aria-hidden="true" className="h-20" />}
      {session && <AgentLauncher locale={locale} />}
    </AppShell>
  );
}
