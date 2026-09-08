import { Card, Page, PageHeader, Section, Status } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RescanButton } from '@/components/rescan-button';
import { Link } from '@/i18n/navigation';
import { loadQueueCounts } from '@/server/repositories/review';
import { requireHousehold } from '@/server/session';

/**
 * One place that says what is waiting.
 *
 * The four queues are separate screens because they are four different
 * judgements, and this exists so they are not four things a household has to
 * remember to visit. «Eleven decisions waiting» is an obligation a person can
 * hold; four unvisited screens is not.
 *
 * A queue at zero is shown as clear rather than hidden. Knowing the system
 * looked and found nothing is worth as much as knowing it found something.
 */

const QUEUES = [
  { key: 'duplicates', href: '/review/duplicates' },
  { key: 'transfers', href: '/review/transfers' },
  { key: 'recurring', href: '/review/recurring' },
  { key: 'categories', href: '/review/categories' },
] as const;

export default async function ReviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const counts = await loadQueueCounts(session, session.activeHouseholdId);

  const t = await getTranslations('review');
  const shared = await getTranslations('records');

  return (
    <Page>
      <PageHeader
        title={t('title')}
        detail={counts.total === 0 ? t('detail') : t('totalPending', { count: counts.total })}
      />

      <Section>
        <ul className="grid gap-4 sm:grid-cols-2">
          {QUEUES.map((queue) => {
            const pending = counts[queue.key];
            return (
              <li key={queue.key}>
                <Card interactive>
                  <Link
                    href={queue.href}
                    className="flex flex-col gap-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--color-brand)]"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-[color:var(--color-ink)]">
                        {t(`queues.${queue.key}.title`)}
                      </span>
                      {pending === 0 ? (
                        <Status tone="positive">{t('clear')}</Status>
                      ) : (
                        <Status tone="caution">{t('pending', { count: pending })}</Status>
                      )}
                    </span>
                    <span className="text-sm text-[color:var(--color-ink-secondary)]">
                      {t(`queues.${queue.key}.detail`)}
                    </span>
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t('rescan')} detail={t('rescanDetail')} className="mt-12">
        <Card>
          <RescanButton
            locale={locale}
            labels={{
              action: t('rescan'),
              queued: t('rescanQueued'),
              errorTitle: t('errorTitle'),
              generic: shared('errors.generic'),
            }}
          />
        </Card>
      </Section>
    </Page>
  );
}
