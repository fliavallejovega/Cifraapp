import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { LegalPageView } from '@/components/marketing/legal-page';
import { publicRobots } from '@/lib/seo';

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

interface RouteProps {
  readonly params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'marketing' });

  return { title: t('nav.privacy'), robots: publicRobots() };
}

export default async function PrivacyPage({ params }: RouteProps) {
  const { locale } = await params;
  return <LegalPageView locale={locale} kind="privacy" />;
}
