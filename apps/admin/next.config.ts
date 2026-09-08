import type { NextConfig } from 'next';

/**
 * The admin application.
 *
 * A separate deployment from the product, which is the point of it being a
 * separate application at all: it never shares a hostname with customer traffic,
 * its routes cannot be reached by a customer session that wandered, and its
 * headers can be stricter than a marketing site's without qualification.
 *
 * `noindex` on every response, because an administrative surface in a search
 * index is a list of doors to try.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  /**
   * `same-origin`, not `no-referrer`, and the difference is not cosmetic.
   *
   * Under `no-referrer` the Fetch specification serializes a request's origin
   * as the literal string «null» when it attaches the `Origin` header. React
   * posts Server Actions with `fetch`, and Next compares that `Origin` against
   * `x-forwarded-host` as its CSRF defence — so every action on this console,
   * sign-in included, was rejected as a forged cross-site request. The
   * console's own security header was locking the door from the outside.
   *
   * `same-origin` keeps the property that was actually wanted: no referrer
   * ever leaves for a third party, so no administrative URL leaks outward.
   * Requests to this origin keep theirs, which is what the framework needs to
   * tell a real form from an attack.
   */
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Nothing here may be cached anywhere. Every page carries either customer
  // identifiers or the company's own books.
  { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: false },
  transpilePackages: ['@app/ui'],

  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default nextConfig;
