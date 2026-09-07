import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { signOut } from '@/server/auth-actions';
import { ShellChrome, type ShellDestination } from './shell-chrome';
import { IconSignOut } from './shell-icons';

/**
 * The signed-in product's frame, assembled on the server.
 *
 * Everything a screen shares — the column, the drawer, the household, the way
 * out — is decided here once, so a page is only ever its own content. The
 * chrome itself is a client component because the current route marks the
 * active destination; this file's job is to hand it words from the catalogue
 * and a sign-out form bound to its server action.
 */

const DESTINATIONS = [
  { href: '/overview', key: 'overview' },
  { href: '/accounts', key: 'accounts' },
  { href: '/documents', key: 'documents' },
  { href: '/plan', key: 'plan' },
  { href: '/reports', key: 'reports' },
] as const;

export async function AppShell({
  locale,
  householdName,
  children,
}: {
  readonly locale: string;
  readonly householdName: string;
  readonly children: ReactNode;
}) {
  const t = await getTranslations('nav');
  const common = await getTranslations('common');

  const destinations: ShellDestination[] = DESTINATIONS.map((destination) => ({
    href: destination.href,
    key: destination.key,
    label: t(destination.key),
  }));

  return (
    <ShellChrome
      destinations={destinations}
      householdName={householdName}
      labels={{
        brand: common('appName'),
        menu: t('label'),
        close: t('closeMenu'),
        back: t('backToPage'),
        household: t('householdLabel'),
      }}
      signOut={
        <form action={signOut}>
          <input type="hidden" name="locale" value={locale} />
          <button
            type="submit"
            title={t('signOut')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-(--radius-sm) text-[color:var(--color-panel-ink-secondary)] transition-colors duration-(--duration-quick) hover:bg-[color:var(--color-panel-raised)] hover:text-[color:var(--color-panel-ink)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--color-brand)]"
          >
            <span className="sr-only">{t('signOut')}</span>
            <IconSignOut />
          </button>
        </form>
      }
    >
      {children}
    </ShellChrome>
  );
}
