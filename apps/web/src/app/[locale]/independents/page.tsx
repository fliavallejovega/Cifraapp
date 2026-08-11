import {
  ContentPageView,
  contentMetadata,
  type ContentRouteProps,
} from '@/components/marketing/content-page';

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

const SLUG = 'independents';

export async function generateMetadata({ params }: ContentRouteProps) {
  const { locale } = await params;
  return contentMetadata(SLUG, locale);
}

export default async function IndependentsPage({ params }: ContentRouteProps) {
  const { locale } = await params;
  return <ContentPageView locale={locale} slug={SLUG} />;
}
