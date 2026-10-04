import { Card, EmptyState, Page, PageHeader } from '@app/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DocumentReview } from '@/components/trips/document-review';
import { Link } from '@/i18n/navigation';
import { loadHouseholdContext } from '@/server/household-context';
import { loadTripDocumentReview, tripsEnabled } from '@/server/repositories/trips';
import { requireHousehold } from '@/server/session';

/**
 * Reviewing one travel document before it becomes a booking, an expense or a
 * trip. The proposal was read in the background; this screen is where a
 * person checks it, and the only place it can be filed from.
 */
export default async function TripDocumentPage({
  params,
}: {
  params: Promise<{ locale: string; documentId: string }>;
}) {
  const { locale, documentId } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  if (!(await tripsEnabled(session, session.activeHouseholdId))) notFound();
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const t = await getTranslations('trips');

  const data = /^[0-9a-f-]{36}$/.test(documentId)
    ? await loadTripDocumentReview(session, session.activeHouseholdId, documentId, context.currency)
    : null;

  return (
    <Page>
      <div className="mb-6">
        <Link
          href={data?.tripId ? `/trips/${data.tripId}` : '/trips/scan'}
          className="inline-flex min-h-11 items-center text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)]"
        >
          {data?.tripId ? t('documents.backToTrip') : t('documents.backToScan')}
        </Link>
      </div>
      <PageHeader title={t('documents.review.title')} detail={data?.fileName ?? ''} />
      {!data ? (
        <Card>
          <EmptyState
            title={t('documents.review.notFoundTitle')}
            body={t('documents.review.notFoundBody')}
          />
        </Card>
      ) : data.status === 'confirmed' ? (
        <Card>
          <EmptyState
            title={t('documents.review.confirmedTitle')}
            body={t('documents.review.confirmedBody')}
            action={
              <Link
                href={data.tripId ? `/trips/${data.tripId}` : '/trips'}
                className="py-3 text-sm font-medium underline underline-offset-4"
              >
                {t('documents.backToTrip')}
              </Link>
            }
          />
        </Card>
      ) : data.status === 'pending' || data.status === 'processing' ? (
        <Card>
          <EmptyState
            title={t('documents.review.readingTitle')}
            body={t('documents.review.readingBody')}
          />
        </Card>
      ) : (
        <DocumentReview
          data={data}
          locale={locale}
          currency={context.currency}
          today={context.today}
        />
      )}
    </Page>
  );
}
