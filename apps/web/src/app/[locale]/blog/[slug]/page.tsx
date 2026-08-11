import { Page, PageHeader } from '@app/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { Prose } from '@/components/marketing/prose';
import { MarketingShell } from '@/components/marketing/site-chrome';
import { articleStructuredData, metadataFor } from '@/lib/seo';
import { loadPage } from '@/server/repositories/content';

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

interface PostProps {
  readonly params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: PostProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const page = await loadPage('post', slug, locale);
  if (!page) return {};

  const common = await getTranslations({ locale, namespace: 'common' });
  return metadataFor({ page, locale, path: `/blog/${slug}`, siteName: common('appName') });
}

/**
 * One article.
 *
 * `Article` structured data is emitted only when the post genuinely has an
 * author and a publication date. A schema block filled with placeholders asserts
 * facts to a machine that no person ever checked.
 */
export default async function PostPage({ params }: PostProps) {
  const { locale, slug } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const page = await loadPage('post', slug, locale);
  if (!page) notFound();

  const structuredData = articleStructuredData(page, `/${locale}/blog/${slug}`);

  return (
    <Page>
      <MarketingShell locale={locale}>
        <article>
          <PageHeader title={page.title} {...(page.excerpt ? { detail: page.excerpt } : {})} />

          {(page.authorName ?? page.publishedAt) && (
            <p className="mb-10 text-sm text-[color:var(--color-ink-tertiary)]">
              {[page.authorName, page.publishedAt?.toISOString().slice(0, 10)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          <Prose body={page.body} />
        </article>
      </MarketingShell>

      {structuredData && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      )}
    </Page>
  );
}
