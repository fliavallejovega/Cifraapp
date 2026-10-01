import { Card, EmptyState, Page, PageHeader, Section } from '@app/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  TripCard,
  type TripCardData,
  type TripCardLabels,
  type TripMoment,
} from '@/components/trips/trip-card';
import { Link } from '@/i18n/navigation';
import { loadHouseholdContext } from '@/server/household-context';
import { loadTrips, tripsEnabled, type TripListItem } from '@/server/repositories/trips';
import { requireHousehold } from '@/server/session';

/**
 * Viajes: every trip the household is planning, living or remembering.
 *
 * The trip under way, when there is one, comes first and in the panel's ink —
 * it is the only one that needs something today. Then what is coming, ideas,
 * and the past. A household with no trips sees the two ways in, side by side:
 * starting from the money, or from tickets already bought.
 */
export default async function TripsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  if (!(await tripsEnabled(session, session.activeHouseholdId))) notFound();
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const t = await getTranslations('trips');

  const trips = await loadTrips(session, session.activeHouseholdId);
  const today = context.today;

  const momentOf = (trip: TripListItem): TripMoment => {
    if (trip.status === 'idea') return 'idea';
    if (trip.status === 'completed' || trip.status === 'cancelled' || trip.endDate < today)
      return 'past';
    if (trip.startDate <= today && today <= trip.endDate) return 'current';
    return 'upcoming';
  };

  const cards: TripCardData[] = trips.map((trip) => ({
    id: trip.id,
    name: trip.name,
    mark: trip.countryCode ?? trip.cities[0]?.slice(0, 2).toUpperCase() ?? '—',
    cities: trip.cities,
    startDate: trip.startDate,
    endDate: trip.endDate,
    moment: momentOf(trip),
    currency: trip.baseCurrency,
    totalBudget: trip.totalBudget,
    spent: trip.spent,
    goal: trip.goal,
  }));

  const labels: TripCardLabels = {
    moment: {
      current: t('list.moment.current'),
      upcoming: t('list.moment.upcoming'),
      idea: t('list.moment.idea'),
      past: t('list.moment.past'),
    },
    startsIn: (days) => t('list.startsIn', { days }),
    saved: (saved, target) => t('list.saved', { saved, target }),
    spentOf: (spent, total) => t('list.spentOf', { spent, total }),
    action: {
      current: t('list.action.current'),
      upcoming: t('list.action.upcoming'),
      idea: t('list.action.idea'),
      past: t('list.action.past'),
    },
    noCities: t('list.noCities'),
  };

  const groups: { key: TripMoment; trips: TripCardData[] }[] = (
    ['current', 'upcoming', 'idea', 'past'] as const
  )
    .map((key) => ({
      key,
      trips: cards
        .filter((card) => card.moment === key)
        .sort((a, b) =>
          key === 'past'
            ? b.startDate.localeCompare(a.startDate)
            : a.startDate.localeCompare(b.startDate),
        ),
    }))
    .filter((group) => group.trips.length > 0);

  const primary = (
    <Link
      href="/trips/new"
      className="inline-flex h-12 items-center justify-center rounded-(--radius-md) bg-[color:var(--color-panel)] px-6 text-base font-medium text-[color:var(--color-panel-ink)] shadow-(--shadow-card) hover:bg-[color:var(--color-panel-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-ink)]"
    >
      {t('list.plan')}
    </Link>
  );

  if (cards.length === 0) {
    return (
      <Page>
        <PageHeader title={t('title')} detail={t('detail')} />
        <Card padding="lg">
          <EmptyState
            title={t('empty.title')}
            body={t('empty.body')}
            action={
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/trips/new?from=budget"
                  className="inline-flex h-12 items-center justify-center rounded-(--radius-md) bg-[color:var(--color-panel)] px-6 text-base font-medium text-[color:var(--color-panel-ink)] shadow-(--shadow-card) hover:bg-[color:var(--color-panel-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-ink)]"
                >
                  {t('empty.fromBudget')}
                </Link>
                <Link
                  href="/trips/scan"
                  className="inline-flex h-12 items-center justify-center rounded-(--radius-md) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-6 text-base font-medium shadow-(--shadow-card) hover:bg-[color:var(--color-ground-sunk)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-ink)]"
                >
                  {t('empty.fromDocuments')}
                </Link>
              </div>
            }
          />
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} actions={primary} />
      <div className="flex flex-col gap-12">
        {groups.map((group) => (
          <Section key={group.key} title={t(`list.groups.${group.key}`)}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {group.trips.map((trip) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  locale={locale}
                  today={today}
                  labels={labels}
                  featured={group.key === 'current'}
                />
              ))}
            </div>
          </Section>
        ))}
      </div>
    </Page>
  );
}
