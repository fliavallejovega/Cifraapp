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

/**
 * Every signed-in destination, in the order the product argues for.
 *
 * The groups answer, in sequence, the questions the product exists to answer:
 * what do I have, what already claims it, how does the data get in, what should
 * I do, what is the record, and how is this household set up. A screen that
 * does not answer one of those does not belong in the column.
 */
const DESTINATIONS = [
  { href: '/overview', key: 'overview', group: 'money' },
  { href: '/accounts', key: 'accounts', group: 'money' },
  { href: '/movements', key: 'movements', group: 'money' },

  { href: '/commitments', key: 'commitments', group: 'claims' },
  { href: '/debts', key: 'debts', group: 'claims' },
  { href: '/goals', key: 'goals', group: 'claims' },
  { href: '/income', key: 'income', group: 'claims' },
  { href: '/budgets', key: 'budgets', group: 'claims' },

  { href: '/documents', key: 'documents', group: 'intake' },
  { href: '/review', key: 'review', group: 'intake' },
  { href: '/merchants', key: 'merchants', group: 'intake' },

  { href: '/plan', key: 'plan', group: 'decide' },
  { href: '/advice', key: 'advice', group: 'decide' },
  { href: '/alerts', key: 'alerts', group: 'decide' },
  { href: '/debt-simulator', key: 'debtSimulator', group: 'decide' },
  { href: '/scenarios', key: 'scenarios', group: 'decide' },
  { href: '/projection', key: 'projection', group: 'decide' },
  { href: '/chat', key: 'chat', group: 'decide' },

  { href: '/reports', key: 'reports', group: 'record' },
  { href: '/close', key: 'close', group: 'record' },
  { href: '/exports', key: 'exports', group: 'record' },

  { href: '/people', key: 'people', group: 'household' },
  { href: '/categories', key: 'categories', group: 'household' },
  { href: '/rules', key: 'rules', group: 'household' },
  { href: '/access', key: 'access', group: 'household' },
  { href: '/tax', key: 'tax', group: 'household' },
  { href: '/notifications', key: 'notifications', group: 'household' },
  { href: '/subscription', key: 'subscription', group: 'household' },
  { href: '/settings', key: 'settings', group: 'household' },
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
    group: t(`groups.${destination.group}`),
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
        collapse: t('collapse'),
        expand: t('expand'),
        theme: {
          legend: t('theme.legend'),
          system: t('theme.system'),
          light: t('theme.light'),
          dark: t('theme.dark'),
        },
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
