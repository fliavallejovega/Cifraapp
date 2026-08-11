import { Rule } from '@app/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

/**
 * The marketing site's frame.
 *
 * Structure comes from gradation rules and space, as it does everywhere else in
 * this product — there is no header bar with a background, no card grid, and no
 * boxed footer. A marketing site that looks unrelated to the product it sells is
 * a promise the first screen after signing up will break.
 */

const NAV = [
  { href: '/features', key: 'features' },
  { href: '/independents', key: 'independents' },
  { href: '/couples', key: 'couples' },
  { href: '/pricing', key: 'pricing' },
  { href: '/security', key: 'security' },
] as const;

export async function SiteHeader({ locale }: { locale: string }) {
  const t = await getTranslations('marketing');
  const common = await getTranslations('common');
  const otherLocale = routing.locales.find((candidate) => candidate !== locale) ?? 'en';

  return (
    <header className="mb-16">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-4">
        <Link href="/" className="gradation-label uppercase">
          {common('appName')}
        </Link>

        <nav aria-label={t('nav.label')} className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          {NAV.map((entry) => (
            <Link
              key={entry.key}
              href={entry.href}
              className="text-sm text-[color:var(--color-ink-secondary)] transition-opacity duration-(--duration-quick) hover:opacity-60"
            >
              {t(`nav.${entry.key}`)}
            </Link>
          ))}
        </nav>

        <div className="flex items-baseline gap-6">
          <Link
            href="/"
            locale={otherLocale}
            className="text-xs text-[color:var(--color-ink-tertiary)] underline underline-offset-4"
          >
            {t('switchLanguage')}
          </Link>
          <Link href="/sign-in" className="text-sm underline underline-offset-4">
            {t('nav.signIn')}
          </Link>
        </div>
      </div>

      <Rule className="mt-6" />
    </header>
  );
}

export async function SiteFooter({ locale: _locale }: { locale: string }) {
  const t = await getTranslations('marketing');
  const common = await getTranslations('common');

  const columns = [
    {
      key: 'product',
      links: [
        { href: '/features', key: 'features' },
        { href: '/pricing', key: 'pricing' },
        { href: '/changelog', key: 'changelog' },
      ],
    },
    {
      key: 'who',
      links: [
        { href: '/independents', key: 'independents' },
        { href: '/couples', key: 'couples' },
        { href: '/accountants', key: 'accountants' },
      ],
    },
    {
      key: 'company',
      links: [
        { href: '/about', key: 'about' },
        { href: '/blog', key: 'blog' },
        { href: '/contact', key: 'contact' },
      ],
    },
    {
      key: 'legal',
      links: [
        { href: '/security', key: 'security' },
        { href: '/terms', key: 'terms' },
        { href: '/privacy', key: 'privacy' },
      ],
    },
  ] as const;

  return (
    <footer className="mt-24">
      <Rule />

      <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {columns.map((column) => (
          <div key={column.key}>
            <p className="gradation-label uppercase">{t(`footer.${column.key}`)}</p>
            <ul className="mt-3 space-y-2">
              {column.links.map((link) => (
                <li key={link.key}>
                  <Link
                    href={link.href}
                    className="text-sm text-[color:var(--color-ink-secondary)] transition-opacity duration-(--duration-quick) hover:opacity-60"
                  >
                    {t(`nav.${link.key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-10 max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
        {t('footer.note', { name: common('appName') })}
      </p>
    </footer>
  );
}

/** A marketing page's shell: header, content, footer, in that order and no boxes. */
export function MarketingShell({ locale, children }: { locale: string; children: ReactNode }) {
  return (
    <>
      <SiteHeader locale={locale} />
      {children}
      <SiteFooter locale={locale} />
    </>
  );
}
