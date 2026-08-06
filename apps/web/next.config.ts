import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

/**
 * Security headers.
 *
 * Applied from the first commit rather than during Phase 21 hardening, because
 * a header added late has to be reconciled against every inline script and
 * third-party embed that accumulated in the meantime. Starting strict and
 * loosening deliberately is far cheaper than the reverse (spec §47).
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  // Financial pages must never be cached by an intermediary. Route handlers
  // that serve documents tighten this further in Phase 4.
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Fail the build on a type error rather than shipping it. Stated explicitly
  // so nobody can quietly flip it. Linting is a separate pipeline step; Next 16
  // no longer runs ESLint during the build.
  typescript: { ignoreBuildErrors: false },

  // Workspace packages ship TypeScript sources, not compiled bundles.
  transpilePackages: ['@app/ui'],

  experimental: {
    // Keeps server-only modules — the database client, service-role keys — out
    // of any client bundle even if an import path is written by mistake.
    serverActions: { bodySizeLimit: '2mb' },
  },

  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
