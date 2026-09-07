import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { SignOutButton } from './sign-out-button';
import { AppNavLink } from './app-nav-link';

/**
 * The product's navigation.
 *
 * There was none. Every signed-in screen carried its own header, the links
 * between them appeared only once a household already had data, and the import
 * screen had no link pointing at it from anywhere — so the one action a new
 * household needs was reachable only by typing the URL. A person who cannot get
 * to a screen does not have the feature on that screen.
 *
 * Five destinations is the whole product, so they are all visible rather than
 * folded behind a menu. On a narrow viewport the row scrolls sideways instead
 * of wrapping into a second line that pushes the page content down.
 */

export interface AppNavProps {
  readonly locale: string;
  readonly householdName: string;
}

const DESTINATIONS = [
  { href: '/overview', key: 'overview' },
  { href: '/accounts', key: 'accounts' },
  { href: '/documents', key: 'documents' },
  { href: '/plan', key: 'plan' },
  { href: '/reports', key: 'reports' },
] as const;

export async function AppNav({ locale, householdName }: AppNavProps) {
  const t = await getTranslations('nav');
  const common = await getTranslations('common');

  return (
    <header className="mb-12 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-6">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link href="/overview" className="gradation-label shrink-0 uppercase">
            {common('appName')}
          </Link>
          <span className="truncate text-sm text-[color:var(--color-ink-secondary)]">
            {householdName}
          </span>
        </div>
        <SignOutButton locale={locale} label={t('signOut')} />
      </div>

      <nav
        aria-label={t('label')}
        className="-mx-1 [scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex items-center gap-1 border-b border-[color:var(--color-rule)] px-1">
          {DESTINATIONS.map((destination) => (
            <li key={destination.href}>
              <AppNavLink href={destination.href} label={t(destination.key)} />
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
