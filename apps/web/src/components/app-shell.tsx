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
 * The five destinations, and nothing else in the column.
 *
 * The column used to list thirty-four screens under six headings, and a
 * household that opened it could not tell where to start. Five answer what a
 * person comes to do: see how things stand, look at what moved, get a
 * statement in, decide what to do next, and set up the home. Every other
 * screen still exists and is reached from inside one of these — Plan carries
 * its own tabs, and Hogar lists the rest — so the screens a destination owns
 * mark it as current (`also`).
 */
const DESTINATIONS = [
  { href: '/overview', key: 'overview', also: [] },
  {
    href: '/movements',
    key: 'movements',
    also: ['/review', '/accounts', '/cards', '/merchants', '/categories', '/rules'],
  },
  { href: '/documents', key: 'documents', also: ['/family-expenses'] },
  {
    href: '/plan',
    key: 'plan',
    also: [
      '/goals',
      '/budgets',
      '/debts',
      '/debt-simulator',
      '/commitments',
      '/income',
      '/projection',
      '/scenarios',
      '/advice',
    ],
  },
  { href: '/household', key: 'household', also: [] },
] as const;

/**
 * The screens a destination owns, shown as tabs across the top of each one, so
 * moving between the plan and its goals, or between movements and what is left
 * to review, never needs the column.
 */
const FAMILIES = [
  [
    { href: '/plan', key: 'plan' },
    { href: '/goals', key: 'goals' },
    { href: '/budgets', key: 'budgets' },
    { href: '/debts', key: 'debts' },
    { href: '/commitments', key: 'commitments' },
    { href: '/income', key: 'income' },
    { href: '/projection', key: 'projection' },
    { href: '/scenarios', key: 'scenarios' },
    { href: '/debt-simulator', key: 'debtSimulator' },
    { href: '/advice', key: 'advice' },
  ],
  [
    { href: '/movements', key: 'movements' },
    { href: '/review', key: 'review' },
    { href: '/accounts', key: 'accounts' },
    { href: '/cards', key: 'cards' },
    { href: '/categories', key: 'categories' },
    { href: '/rules', key: 'rules' },
    { href: '/merchants', key: 'merchants' },
  ],
] as const;

export async function AppShell({
  locale,
  householdName,
  consoleUrl,
  children,
}: {
  readonly locale: string;
  readonly householdName: string;
  /** The administrative console, for the few people who hold a seat there. */
  readonly consoleUrl: string | null;
  readonly children: ReactNode;
}) {
  const t = await getTranslations('nav');
  const common = await getTranslations('common');

  const destinations: ShellDestination[] = DESTINATIONS.map((destination) => ({
    href: destination.href,
    key: destination.key,
    label: t(`primary.${destination.key}`),
    group: '',
    also: destination.also,
  }));

  const families = FAMILIES.map((family) =>
    family.map((tab) => ({ href: tab.href, label: t(tab.key) })),
  );

  return (
    <ShellChrome
      destinations={destinations}
      families={families}
      householdName={householdName}
      consoleUrl={consoleUrl}
      labels={{
        brand: common('appName'),
        menu: t('label'),
        close: t('closeMenu'),
        back: t('backToPage'),
        household: t('householdLabel'),
        collapse: t('collapse'),
        expand: t('expand'),
        console: t('console'),
        upload: t('upload'),
        uploadShort: t('uploadShort'),
        bar: t('bar'),
        tabs: t('tabs'),
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
