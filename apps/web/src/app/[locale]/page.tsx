import { Button, Page } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { loadSession } from '@/server/session';

/**
 * The public entry point.
 *
 * A signed-in user never sees it — they go straight to their position, because
 * a marketing page is not what someone opens the product to read. Phase 17
 * replaces this with the full marketing site; what is here states the offer
 * plainly and exposes one action.
 */
export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await loadSession();
  if (session) {
    redirect(`/${locale}${session.activeHouseholdId ? '/overview' : '/welcome'}`);
  }

  const t = await getTranslations('landing');
  const common = await getTranslations('common');
  const otherLocale = routing.locales.find((candidate) => candidate !== locale) ?? 'en';

  return (
    <Page className="flex min-h-dvh max-w-3xl flex-col justify-center">
      <header className="mb-16 flex items-baseline justify-between gap-6">
        <span className="gradation-label uppercase">{common('appName')}</span>
        <Link
          href="/"
          locale={otherLocale}
          className="text-xs text-[color:var(--color-ink-secondary)] underline underline-offset-4"
        >
          {t('switchLanguage')}
        </Link>
      </header>

      <h1
        className="max-w-[18ch] text-5xl font-medium text-balance sm:text-6xl"
        style={{ letterSpacing: 'var(--tracking-display)', lineHeight: 1.02 }}
      >
        {t('headline')}
      </h1>

      <p className="mt-6 max-w-[52ch] text-lg text-pretty text-[color:var(--color-ink-secondary)]">
        {t('subheadline')}
      </p>

      <div className="mt-12 flex flex-wrap items-center gap-4">
        <Link href="/sign-up">
          <Button size="lg">{t('primaryCta')}</Button>
        </Link>
        <Link
          href="/sign-in"
          className="text-sm underline underline-offset-4 transition-opacity duration-(--duration-quick) hover:opacity-60"
        >
          {t('secondaryCta')}
        </Link>
      </div>
    </Page>
  );
}
