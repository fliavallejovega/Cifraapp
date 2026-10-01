import { Card, Page, PageHeader, Section } from '@app/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DocumentList, DocumentUpload } from '@/components/trips/document-upload';
import { Link } from '@/i18n/navigation';
import { loadTripDocuments, tripsEnabled } from '@/server/repositories/trips';
import { requireHousehold } from '@/server/session';

/**
 * Starting a trip from what was already bought: tickets, a hotel booking.
 * Each document is read in the background and waits here for review; from
 * the review the trip is created with its destination, dates and travellers.
 */
export default async function ScanTripPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  if (!(await tripsEnabled(session, session.activeHouseholdId))) notFound();
  const t = await getTranslations('trips');
  const docs = await loadTripDocuments(session, session.activeHouseholdId, null);

  return (
    <Page>
      <div className="mb-6">
        <Link
          href="/trips"
          className="inline-flex min-h-11 items-center text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)]"
        >
          {t('backToList')}
        </Link>
      </div>
      <PageHeader title={t('documents.scanTitle')} detail={t('documents.scanDetail')} />
      <Card>
        <div className="@container">
          <DocumentUpload tripId={null} locale={locale} primary />
        </div>
      </Card>
      <Section title={t('documents.waiting')} className="mt-12">
        <Card>
          <DocumentList documents={docs} locale={locale} />
        </Card>
      </Section>
    </Page>
  );
}
