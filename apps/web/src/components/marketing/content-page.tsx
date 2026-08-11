import { Page, PageHeader } from '@app/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { metadataFor } from '@/lib/seo';
import { loadPage, type ContentKind } from '@/server/repositories/content';

import { Prose } from './prose';
import { MarketingShell } from './site-chrome';

/**
 * A marketing page whose entire content lives in the CMS.
 *
 * Seven routes share this: features, couples, independents, accountants,
 * security, about and contact. Each is a four-line file that names its slug,
 * because the difference between them is the copy — and copy belongs in rows,
 * not in seven React components somebody has to redeploy to fix a typo in.
 *
 * A missing page is a 404 rather than an empty shell. A marketing page that
 * renders a heading and nothing else looks like a broken product to exactly the
 * person deciding whether to trust one with their money.
 */

export interface ContentRouteProps {
  readonly params: Promise<{ locale: string }>;
}

export async function contentMetadata(
  slug: string,
  locale: string,
  kind: ContentKind = 'page',
): Promise<Metadata> {
  const page = await loadPage(kind, slug, locale);
  if (!page) return {};

  const common = await getTranslations({ locale, namespace: 'common' });
  return metadataFor({ page, locale, path: `/${slug}`, siteName: common('appName') });
}

export async function ContentPageView({
  locale,
  slug,
  kind = 'page',
}: {
  locale: string;
  slug: string;
  kind?: ContentKind;
}) {
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const page = await loadPage(kind, slug, locale);
  if (!page) notFound();

  return (
    <Page>
      <MarketingShell locale={locale}>
        <article>
          <PageHeader title={page.title} {...(page.excerpt ? { detail: page.excerpt } : {})} />
          <Prose body={page.body} />
        </article>
      </MarketingShell>
    </Page>
  );
}
