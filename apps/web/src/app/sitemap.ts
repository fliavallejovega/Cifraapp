import type { MetadataRoute } from 'next';

import { PUBLIC_PATHS, SITE_LOCALES, absoluteUrl } from '@/lib/seo';

/**
 * The public pages, and only those.
 *
 * Product routes are absent by construction — the list is the public one, not
 * the route directory minus exclusions — so a new screen behind sign-in can
 * never appear here by being forgotten. Each entry carries both languages so a
 * crawler reads them as translations, not duplicates.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return PUBLIC_PATHS.flatMap((path) =>
    SITE_LOCALES.map((locale) => ({
      url: absoluteUrl(`/${locale}${path}`),
      lastModified: now,
      changeFrequency: path === '' ? ('weekly' as const) : ('monthly' as const),
      priority: path === '' ? 1 : path === '/pricing' || path === '/features' ? 0.8 : 0.5,
      alternates: {
        languages: Object.fromEntries(
          SITE_LOCALES.map((entry) => [entry, absoluteUrl(`/${entry}${path}`)]),
        ),
      },
    })),
  );
}
