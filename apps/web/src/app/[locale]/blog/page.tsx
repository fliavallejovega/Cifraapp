import { EmptyState, Page, PageHeader } from '@app/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { publicRobots } from '@/lib/seo';
import { MarketingShell } from '@/components/marketing/site-chrome';
import { Link } from '@/i18n/navigation';
import { listPages } from '@/server/repositories/content';

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

  return { title: t('blog.title'), description: t('blog.detail'), robots: publicRobots() };
}

/**
 * The blog index.
 *
 * Empty is the honest state on the day this ships, and the empty state says so
 * plainly rather than showing three placeholder articles. A marketing site that
 * fakes activity is making its first claim to a visitor before any real one.
 */
export default async function BlogIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const t = await getTranslations('marketing');
  const posts = await listPages('post', locale);

  return (
    <Page>
      <MarketingShell locale={locale}>
        <PageHeader title={t('blog.title')} detail={t('blog.detail')} />

        {posts.length === 0 ? (
          <EmptyState title={t('blog.empty.title')} body={t('blog.empty.body')} />
        ) : (
          <ul className="divide-y divide-[color:var(--color-rule)]">
            {posts.map((post) => (
              <li key={post.slug} className="py-6 first:pt-0">
                <Link
                  href={`/blog/${post.slug}`}
                  className="text-lg font-medium underline underline-offset-4"
                >
                  {post.title}
                </Link>
                {post.excerpt && (
                  <p className="mt-2 max-w-[68ch] text-pretty text-[color:var(--color-ink-secondary)]">
                    {post.excerpt}
                  </p>
                )}
                {post.publishedAt && (
                  <p className="tabular mt-2 text-xs text-[color:var(--color-ink-tertiary)]">
                    {post.publishedAt.toISOString().slice(0, 10)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </MarketingShell>
    </Page>
  );
}
