import { getClientEnv } from '@app/validation/env';
import type { Metadata } from 'next';

import type { ContentPage } from '@/server/repositories/content';

/**
 * Metadata for a content-driven page.
 *
 * Two rules the specification is explicit about, both enforced here rather than
 * left to whoever writes the next route:
 *
 *   **Never fabricate a rating.** `aggregateRating` appears nowhere in this file
 *   and must not be added until there are real, attributable reviews. Structured
 *   data claiming stars nobody gave is the kind of thing search engines penalize
 *   and customers are right to resent.
 *
 *   **Canonical and alternates always.** A bilingual site without `hreflang`
 *   competes with itself: the Spanish and English versions of the same page look
 *   like duplicates, and the one that ranks is arbitrary.
 */

const LOCALES = ['es', 'en'] as const;

export interface SeoInput {
  readonly page: ContentPage;
  readonly locale: string;
  readonly path: string;
  readonly siteName: string;
}

export function metadataFor(input: SeoInput): Metadata {
  const { page, locale, path } = input;
  const base = getClientEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const url = page.canonicalUrl ?? `${base}/${locale}${path}`;

  const title = page.seoTitle ?? page.title;
  const description = page.seoDescription ?? page.excerpt ?? undefined;

  return {
    title,
    ...(description ? { description } : {}),
    alternates: {
      canonical: url,
      languages: Object.fromEntries(LOCALES.map((entry) => [entry, `${base}/${entry}${path}`])),
    },
    // `noIndex` is a column rather than a convention because the pages that most
    // need it — a comparison page under revision, a legal draft — are exactly
    // the ones nobody remembers to exclude.
    robots: page.noIndex ? { index: false, follow: false } : undefined,
    openGraph: {
      type: 'website',
      title: page.ogTitle ?? title,
      ...((page.ogDescription ?? description)
        ? { description: page.ogDescription ?? description }
        : {}),
      url,
      siteName: input.siteName,
      locale,
      ...(page.ogImageUrl
        ? { images: [{ url: page.ogImageUrl, alt: page.ogImageAlt ?? page.title }] }
        : {}),
    },
  };
}

/**
 * `Article` structured data for a post.
 *
 * Only emitted when the page actually has an author and a publication date. A
 * schema block with placeholder values is worse than none: it asserts facts to a
 * machine that a person never checked.
 */
export function articleStructuredData(page: ContentPage, url: string): string | null {
  if (!page.authorName || !page.publishedAt) return null;

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: page.title,
    ...(page.excerpt ? { description: page.excerpt } : {}),
    datePublished: page.publishedAt.toISOString(),
    author: { '@type': 'Person', name: page.authorName },
    mainEntityOfPage: url,
  });
}

/**
 * `SoftwareApplication` for the product itself.
 *
 * Carries the offer — a price a search engine can read — and deliberately no
 * `aggregateRating`. There are no reviews, and inventing them is out of the
 * question.
 */
export function productStructuredData(input: {
  name: string;
  description: string;
  url: string;
  lowestPrice: string;
  currency: string;
}): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: input.name,
    description: input.description,
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    url: input.url,
    offers: {
      '@type': 'Offer',
      price: input.lowestPrice,
      priceCurrency: input.currency,
    },
  });
}

/** Breadcrumbs, for a page that sits under something. */
export function breadcrumbStructuredData(
  trail: readonly { name: string; url: string }[],
): string | null {
  if (trail.length < 2) return null;

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: entry.url,
    })),
  });
}
