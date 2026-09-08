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

/**
 * The opt-in that lets a public page be found.
 *
 * The locale layout marks everything `noindex`, because everything under it is a
 * product surface holding somebody's money until a page says otherwise. That
 * default is the right way round — a marketing page missing from an index is a
 * bad week, an account page present in one is a breach — but it means every
 * public route has to say so, and forgetting is silent.
 */
export function publicRobots(indexable = true): Metadata['robots'] {
  return indexable ? { index: true, follow: true } : { index: false, follow: false };
}

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
    robots: publicRobots(!page.noIndex),
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
  /** When present, the offer is a range and is emitted as one. */
  highestPrice?: string;
  currency: string;
  inLanguage?: string;
}): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: input.name,
    description: input.description,
    applicationCategory: 'FinanceApplication',
    applicationSubCategory: 'Personal finance',
    operatingSystem: 'Web',
    url: input.url,
    ...(input.inLanguage ? { inLanguage: input.inLanguage } : {}),
    offers: input.highestPrice
      ? {
          '@type': 'AggregateOffer',
          lowPrice: input.lowestPrice,
          highPrice: input.highestPrice,
          priceCurrency: input.currency,
        }
      : {
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

/**
 * Metadata for the home page.
 *
 * The one page that has to be found by somebody who has never heard the name,
 * so its title leads with what it is — a family finance app — and the name
 * follows. Canonical and `hreflang` are emitted so the Spanish and English
 * pages are read as one page in two languages rather than as two competitors.
 */
export function landingMetadata(input: {
  readonly locale: string;
  readonly siteName: string;
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
}): Metadata {
  const base = getClientEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const url = `${base}/${input.locale}`;
  const title = `${input.title} · ${input.siteName}`;

  return {
    title,
    description: input.description,
    keywords: [...input.keywords],
    applicationName: input.siteName,
    category: 'finance',
    robots: publicRobots(),
    alternates: {
      canonical: url,
      languages: {
        ...Object.fromEntries(LOCALES.map((entry) => [entry, `${base}/${entry}`])),
        'x-default': `${base}/es`,
      },
    },
    openGraph: {
      type: 'website',
      title,
      description: input.description,
      url,
      siteName: input.siteName,
      locale: input.locale === 'en' ? 'en_US' : 'es_PA',
      alternateLocale: input.locale === 'en' ? ['es_PA'] : ['en_US'],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: input.description,
    },
  };
}

/**
 * `FAQPage` for the questions on the home page.
 *
 * The questions and answers are the ones the page shows, read from the same
 * rows; structured data that says something the page does not is the kind of
 * mismatch search engines demote.
 */
export function faqStructuredData(
  faqs: readonly { question: string; answer: string }[],
): string | null {
  if (faqs.length === 0) return null;

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  });
}

/** The absolute address of a public path, for structured data. */
export function absoluteUrl(path: string): string {
  const base = getClientEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  return `${base}${path}`;
}

/** Every public route, in every language. The sitemap and robots file read this. */
export const PUBLIC_PATHS = [
  '',
  '/features',
  '/couples',
  '/independents',
  '/accountants',
  '/pricing',
  '/security',
  '/about',
  '/blog',
  '/changelog',
  '/contact',
  '/terms',
  '/privacy',
] as const;

export { LOCALES as SITE_LOCALES };
