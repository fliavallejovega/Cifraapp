import { getSchemaVersion } from '@app/database';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { getDatabase } from '@/server/database';

/**
 * Phase 0 status screen.
 *
 * Provisional by design: it exists to make the foundation visible and testable,
 * and Phase 1 replaces it entirely. It is not an attempt at the product's
 * visual identity — that decision belongs to Phase 1, with DESIGN.md written
 * before the first line of it lands.
 */

/**
 * Rendered per request. A status screen that reports the database state as it
 * was at build time is worse than no status screen — it would say "connected"
 * long after the connection stopped working.
 */
export const dynamic = 'force-dynamic';

interface CheckResult {
  readonly label: string;
  readonly detail: string;
  readonly ready: boolean;
}

async function readSchemaVersion(): Promise<number | null> {
  try {
    const database = getDatabase();
    if (!database) return null;

    const version = await getSchemaVersion(database);
    return version?.version ?? null;
  } catch {
    return null;
  }
}

export default async function StatusPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Pending the next/root-params migration; see the note in layout.tsx.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const t = await getTranslations('status');
  const common = await getTranslations('common');
  const schemaVersion = await readSchemaVersion();

  const checks: CheckResult[] = [
    {
      label: t('checks.application'),
      detail: t('checks.applicationDetail'),
      ready: true,
    },
    {
      label: t('checks.localization'),
      detail: t('checks.localizationDetail'),
      ready: true,
    },
    {
      label: t('checks.database'),
      detail:
        schemaVersion === null
          ? t('checks.databaseDetailPending')
          : t('checks.databaseDetailConnected', { version: schemaVersion }),
      ready: schemaVersion !== null,
    },
  ];

  const otherLocale = routing.locales.find((candidate) => candidate !== locale) ?? 'en';

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-24">
      <header className="mb-16">
        <p
          className="mb-6 text-sm text-[color:var(--color-ink-subtle)]"
          style={{ letterSpacing: 'var(--tracking-caption)' }}
        >
          {common('appName')}
        </p>
        <h1
          className="mb-3 text-4xl font-medium text-balance"
          style={{ letterSpacing: 'var(--tracking-display)', lineHeight: 1.1 }}
        >
          {t('title')}
        </h1>
        <p className="text-lg text-[color:var(--color-ink-muted)]">{t('subtitle')}</p>
      </header>

      <section aria-labelledby="checks-heading">
        <h2 id="checks-heading" className="sr-only">
          {t('checks.heading')}
        </h2>

        <ul className="border-t border-[color:var(--color-border)]">
          {checks.map((check) => (
            <li
              key={check.label}
              className="flex items-baseline justify-between gap-6 border-b border-[color:var(--color-border)] py-5"
            >
              <div className="min-w-0">
                <p className="font-medium">{check.label}</p>
                <p className="mt-1 text-sm text-pretty text-[color:var(--color-ink-muted)]">
                  {check.detail}
                </p>
              </div>
              {/* State is carried by the word itself, not only by color — a
                  colorblind user gets identical information (spec §64). */}
              <span
                className="tabular shrink-0 text-sm"
                style={{
                  color: check.ready ? 'var(--color-positive)' : 'var(--color-ink-subtle)',
                }}
              >
                {check.ready ? t('state.ready') : t('state.pending')}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-16">
        <p className="mb-8 text-sm text-pretty text-[color:var(--color-ink-muted)]">
          {t('descriptionLead')}
        </p>
        <Link
          href="/"
          locale={otherLocale}
          className="text-sm underline underline-offset-4 transition-opacity duration-200 hover:opacity-60"
        >
          {t('switchLanguage')}
        </Link>
      </footer>
    </main>
  );
}
