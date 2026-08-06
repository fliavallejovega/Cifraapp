import { defineRouting } from 'next-intl/routing';

/**
 * The interface ships in Spanish and English from day one (ADR-003).
 *
 * Spanish is the default because the first market is Panama; English exists so
 * the product is legible to the region's international users and to future
 * white-label partners. Every user-visible string lives in `messages/`, and the
 * lint rule in `@app/config/eslint/next` fails a JSX literal that tries to skip
 * that.
 */
export const routing = defineRouting({
  locales: ['es', 'en'],
  defaultLocale: 'es',
  // The default locale carries its prefix too, so `/es/...` and `/en/...` are
  // symmetrical. Asymmetric prefixes make canonical URLs, sitemaps and
  // analytics attribution needlessly fiddly later.
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];
