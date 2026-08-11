import 'server-only';

import { getDb } from '@app/database';
import {
  contentAuthors,
  contentPages,
  faqs,
  mediaAssets,
  legalDocuments,
  redirects,
  testimonials,
} from '@app/database/schema';
import { getServerEnv } from '@app/validation/env';
import { and, asc, desc, eq } from 'drizzle-orm';

/**
 * Marketing content, read with the anonymous role.
 *
 * These reads carry no session and touch no household data. Row-level security
 * on `platform.content_pages` only exposes published rows, so a draft cannot
 * reach the site even if a route asks for one by slug — the policy is the
 * guarantee, not the `where` clause below.
 *
 * Everything returns null or an empty list when there is nothing, and every
 * caller has to render that. A marketing site that throws on missing content
 * fails the one request that mattered: the first one, from someone deciding
 * whether to trust a financial product.
 */

export type ContentKind =
  'page' | 'post' | 'feature' | 'comparison' | 'case_study' | 'changelog' | 'legal';

export interface ContentPage {
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string | null;
  readonly body: string;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly canonicalUrl: string | null;
  readonly ogTitle: string | null;
  readonly ogDescription: string | null;
  readonly ogImageUrl: string | null;
  readonly ogImageAlt: string | null;
  readonly structuredData: unknown;
  readonly noIndex: boolean;
  readonly publishedAt: Date | null;
  readonly authorName: string | null;
}

function database() {
  return getDb(getServerEnv().DATABASE_URL);
}

export async function loadPage(
  kind: ContentKind,
  slug: string,
  locale: string,
): Promise<ContentPage | null> {
  const rows = await database()
    .select({
      slug: contentPages.slug,
      title: contentPages.title,
      excerpt: contentPages.excerpt,
      body: contentPages.body,
      seoTitle: contentPages.seoTitle,
      seoDescription: contentPages.seoDescription,
      canonicalUrl: contentPages.canonicalUrl,
      ogTitle: contentPages.ogTitle,
      ogDescription: contentPages.ogDescription,
      ogImageUrl: mediaAssets.url,
      ogImageAlt: mediaAssets.alt,
      structuredData: contentPages.structuredData,
      noIndex: contentPages.noIndex,
      publishedAt: contentPages.publishedAt,
      authorName: contentAuthors.name,
    })
    .from(contentPages)
    .leftJoin(mediaAssets, eq(mediaAssets.id, contentPages.ogImageId))
    .leftJoin(contentAuthors, eq(contentAuthors.id, contentPages.authorId))
    .where(
      and(
        eq(contentPages.kind, kind),
        eq(contentPages.slug, slug),
        eq(contentPages.locale, locale),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function listPages(
  kind: ContentKind,
  locale: string,
  limit = 50,
): Promise<readonly Pick<ContentPage, 'slug' | 'title' | 'excerpt' | 'publishedAt'>[]> {
  return database()
    .select({
      slug: contentPages.slug,
      title: contentPages.title,
      excerpt: contentPages.excerpt,
      publishedAt: contentPages.publishedAt,
    })
    .from(contentPages)
    .where(and(eq(contentPages.kind, kind), eq(contentPages.locale, locale)))
    .orderBy(desc(contentPages.publishedAt), asc(contentPages.sortOrder))
    .limit(limit);
}

export async function listFaqs(
  locale: string,
): Promise<readonly { question: string; answer: string }[]> {
  return database()
    .select({ question: faqs.question, answer: faqs.answer })
    .from(faqs)
    .where(eq(faqs.locale, locale))
    .orderBy(asc(faqs.sortOrder));
}

/**
 * Approved testimonials.
 *
 * Returns an empty list until somebody real says something real and consents to
 * it being quoted. Callers render nothing rather than an example — a placeholder
 * quote on a financial product's landing page is a lie with a face on it.
 */
export async function listTestimonials(
  locale: string,
): Promise<readonly { quote: string; attribution: string; role: string | null }[]> {
  return database()
    .select({
      quote: testimonials.quote,
      attribution: testimonials.attribution,
      role: testimonials.role,
    })
    .from(testimonials)
    .where(eq(testimonials.locale, locale));
}

export async function loadLegalDocument(
  kind: 'terms' | 'privacy' | 'tax_disclaimer' | 'cookies',
  locale: string,
): Promise<{ title: string; body: string; version: string; reviewedAt: Date | null } | null> {
  const rows = await database()
    .select({
      title: legalDocuments.title,
      body: legalDocuments.body,
      version: legalDocuments.version,
      reviewedAt: legalDocuments.reviewedAt,
    })
    .from(legalDocuments)
    .where(and(eq(legalDocuments.kind, kind), eq(legalDocuments.locale, locale)))
    .orderBy(desc(legalDocuments.effectiveFrom))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * A redirect for a path, if one is configured.
 *
 * Content moves, and a URL somebody bookmarked or a search engine indexed should
 * keep working. Redirects are rows so that fixing a broken link is not a
 * deployment.
 */
export async function findRedirect(
  path: string,
): Promise<{ toPath: string; statusCode: number } | null> {
  const rows = await database()
    .select({ toPath: redirects.toPath, statusCode: redirects.statusCode })
    .from(redirects)
    .where(eq(redirects.fromPath, path))
    .limit(1);

  return rows[0] ?? null;
}
