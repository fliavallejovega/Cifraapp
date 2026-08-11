import { EmptyState, Page, PageHeader } from '@app/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Prose } from '@/components/marketing/prose';
import { publicRobots } from '@/lib/seo';
import { MarketingShell } from '@/components/marketing/site-chrome';
import { listPages, loadPage } from '@/server/repositories/content';

/**
 * Rendered per request rather than at build time.
 *
 * Every word on this page comes out of the database, and a build has no database
 * — CI builds this repository with `SKIP_ENV_VALIDATION`, with no credentials at
 * all. Prerendering would either fail the build or, worse, bake an empty page
 * into the deployment. Caching these at the edge with revalidation is a Phase 21
 * performance item; correctness first.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'marketing' });

  return {
    title: t('changelog.title'),
    description: t('changelog.detail'),
    robots: publicRobots(),
  };
}

/**
 * What actually shipped, newest first.
 *
 * A changelog is the cheapest credibility a product has and the easiest to
 * fake. Entries are rows written after the fact; nothing here is generated from
 * commits, because a commit log is a record of work and a changelog is a record
 * of what changed for a person using the product.
 */
export default async function ChangelogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const t = await getTranslations('marketing');
  const entries = await listPages('changelog', locale);

  const bodies = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      page: await loadPage('changelog', entry.slug, locale),
    })),
  );

  return (
    <Page>
      <MarketingShell locale={locale}>
        <PageHeader title={t('changelog.title')} detail={t('changelog.detail')} />

        {bodies.length === 0 ? (
          <EmptyState title={t('changelog.empty.title')} body={t('changelog.empty.body')} />
        ) : (
          <ol className="divide-y divide-[color:var(--color-rule)]">
            {bodies.map(({ entry, page }) => (
              <li key={entry.slug} className="py-8 first:pt-0">
                <p className="tabular gradation-label uppercase">
                  {entry.publishedAt?.toISOString().slice(0, 10) ?? ''}
                </p>
                <h2
                  className="mt-2 text-lg font-medium"
                  style={{ letterSpacing: 'var(--tracking-title)' }}
                >
                  {entry.title}
                </h2>
                {page && <div className="mt-4">{<Prose body={page.body} />}</div>}
              </li>
            ))}
          </ol>
        )}
      </MarketingShell>
    </Page>
  );
}
