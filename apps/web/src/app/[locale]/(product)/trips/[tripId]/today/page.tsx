import { convertToLocal, DAILY_CATEGORIES, divide, fromMinor, toMinor } from '@app/trip-engine';
import { Card, EmptyState, Page, PageHeader } from '@app/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { TodayView, type TodayData } from '@/components/trips/today-view';
import { Link } from '@/i18n/navigation';
import { daysFrom, formatAmount } from '@/lib/trip-format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadTripDashboard, tripsEnabled } from '@/server/repositories/trips';
import { requireHousehold } from '@/server/session';

/**
 * «Hoy puedes gastar»: the trip while it happens.
 *
 * The figure is the engine's `today.remaining` in rolling mode — what was
 * left yesterday has already been spread over today and the days ahead. The
 * sentence under it says why it moved, from the same numbers, by rule.
 */
export default async function TripTodayPage({
  params,
}: {
  params: Promise<{ locale: string; tripId: string }>;
}) {
  const { locale, tripId } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  if (!(await tripsEnabled(session, session.activeHouseholdId))) notFound();
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const t = await getTranslations('trips');
  const data = /^[0-9a-f-]{36}$/.test(tripId)
    ? await loadTripDashboard(
        session,
        session.activeHouseholdId,
        tripId,
        context.today,
        context.currency,
      )
    : null;
  if (!data) notFound();

  const { trip, budget } = data;
  const base = trip.baseCurrency.trim();
  const back = (
    <div className="mb-6">
      <Link
        href={`/trips/${trip.id}`}
        className="inline-flex min-h-11 items-center text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)]"
      >
        {t('today.backToTrip')}
      </Link>
    </div>
  );

  if (budget.phase !== 'during' || !budget.today) {
    const days = daysFrom(context.today, trip.startDate);
    return (
      <Page>
        {back}
        <PageHeader title={trip.name} />
        <Card>
          <EmptyState
            title={
              budget.phase === 'before' ? t('today.notYetTitle', { days }) : t('today.overTitle')
            }
            body={budget.phase === 'before' ? t('today.notYetBody') : t('today.overBody')}
            action={
              <Link
                href={budget.phase === 'before' ? `/trips/${trip.id}` : `/trips/${trip.id}/report`}
                className="text-sm font-medium underline underline-offset-4"
              >
                {budget.phase === 'before' ? t('today.toPlan') : t('today.toReport')}
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  const today = budget.today;
  const todayDay = budget.days.find((d) => d.timing === 'today');
  const legRow = data.legs.find((l) => l.id === todayDay?.legId) ?? data.legs[0];
  const localCurrency = legRow?.localCurrency.trim() ?? base;
  const rate =
    localCurrency === base
      ? null
      : (trip.planningFx[localCurrency]?.rate ?? data.rates.get(localCurrency) ?? null);
  const localMinor = data.minorUnits.get(localCurrency) ?? 2;
  // The sentences speak the hero's currency: local when the leg has a rate.
  const money = (v: string) =>
    rate
      ? formatAmount(
          convertToLocal(v, rate, { minorUnits: 2 }, { minorUnits: localMinor }),
          localCurrency,
          locale,
        )
      : formatAmount(v, base, locale);

  // Why today's figure moved: yesterday against its original plan.
  const past = budget.days.filter((d) => d.timing === 'past');
  const yesterday = past[past.length - 1];
  const ahead = budget.days.filter((d) => d.timing !== 'past').length;
  let rollingNote: TodayData['rollingNote'] = null;
  if (yesterday && trip.rollingPolicy === 'rolling') {
    const diff = toMinor(yesterday.originalTotal, 2) - toMinor(yesterday.spentTotal, 2);
    if (diff !== 0n) {
      const amount = money(fromMinor(diff < 0n ? -diff : diff, 2));
      rollingNote = {
        tone: diff > 0n ? 'positive' : 'caution',
        text: t(diff > 0n ? 'today.rollingUp' : 'today.rollingDown', {
          amount,
          days: ahead,
          perDay: money(today.allowed),
        }),
      };
    }
  }
  const overCategories = DAILY_CATEGORIES.filter(
    (c) => toMinor(today.byCategory[c].spent, 2) > toMinor(today.byCategory[c].allowed, 2),
  ).map((c) =>
    t('today.overCategory', {
      amount: money(
        fromMinor(
          toMinor(today.byCategory[c].spent, 2) - toMinor(today.byCategory[c].allowed, 2),
          2,
        ),
      ),
      category: t(`common.category.${c}`),
    }),
  );

  const view: TodayData = {
    tripId: trip.id,
    today: context.today,
    dayNumber: budget.days.findIndex((d) => d.timing === 'today') + 1,
    totalDays: budget.days.length,
    legCity: legRow?.city ?? null,
    tripName: trip.name,
    baseCurrency: base,
    localCurrency,
    localMinor,
    rate,
    allowed: today.allowed,
    spent: today.spent,
    remaining: today.remaining,
    overspent: today.overspent,
    byCategory: today.byCategory,
    rollingNote,
    overCategories,
    days: budget.days.map((d) => ({
      date: d.date,
      state: d.state,
      timing: d.timing,
      planned: d.plannedTotal,
      spent: d.spentTotal,
    })),
    expenses: data.expenses
      .filter((e) => (e.tripDay ?? e.date) === context.today)
      .map((e) => ({
        id: e.id,
        category: e.category,
        description: e.description,
        amount: e.amount,
        originalAmount: e.originalAmount,
        originalCurrency: e.originalCurrency?.trim() ?? null,
      })),
    accounts: data.accounts
      .filter((a) => a.currency.trim() === base)
      .map((a) => ({ id: a.id, name: a.name, type: a.type })),
    fundingAccountId: trip.fundingAccountId,
    travelers: data.travelers.map((tr) => ({ id: tr.id, displayName: tr.displayName })),
    reserveAvailable: budget.reserve.available,
    shortfall:
      budget.diagnostics.status === 'deficit'
        ? budget.diagnostics.shortfall
        : fromMinor(divide(0n, 1n), 2),
    phase: budget.phase,
  };

  return (
    <Page>
      {back}
      <h1 className="sr-only">{trip.name}</h1>
      <TodayView data={view} locale={locale} />
    </Page>
  );
}
