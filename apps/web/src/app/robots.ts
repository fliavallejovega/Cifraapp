import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/seo';
import { PROTECTED_SEGMENTS } from '@/product-routes';

/**
 * What a crawler may read.
 *
 * Every product route is disallowed by name, from the same list the request
 * guard uses, so the two cannot disagree. The pages themselves also say
 * `noindex`; this file exists so a well-behaved crawler does not even ask.
 */
export default function robots(): MetadataRoute.Robots {
  const disallow = [
    '/api/',
    '/auth/',
    ...PROTECTED_SEGMENTS.flatMap((segment) => [`/es${segment}`, `/en${segment}`]),
  ];

  return {
    rules: [{ userAgent: '*', allow: '/', disallow }],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
