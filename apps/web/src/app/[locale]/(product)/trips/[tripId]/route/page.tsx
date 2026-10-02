import { Card, EmptyState, Page, PageHeader, Status, type StatusTone } from '@app/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { LodgingBoard, Notices } from '@/components/rumbo/lodging-board';
import { RouteExplorer } from '@/components/rumbo/route-explorer';
import { RoutingStatus } from '@/components/rumbo/routing-status';
import { TakeItAlong } from '@/components/rumbo/take-it-along';
import { TodoList } from '@/components/rumbo/todo-list';
import { Link } from '@/i18n/navigation';
import { loadHouseholdContext } from '@/server/household-context';
import { tripsEnabled } from '@/server/repositories/trips';
import { loadRumbo, type RumboView } from '@/server/rumbo';
import {
  countryName,
  noticeText,
  presentLodging,
  presentRoute,
  presentTodos,
  shortDate,
  type Presenter,
} from '@/server/rumbo-present';
import { loadTripShares } from '@/server/rumbo-share';
import { requireHousehold } from '@/server/session';
import { getClientEnv } from '@app/validation/env';

/**
 * Rumbo: the trip armed end to end.
 *
 * Three tabs, one per question a person carries on the phone during the
 * trip: where are we going today (the route), where do we sleep and what
 * does it cost (lodging), and what do we need at the border and to buy
 * before we go (visas and bookings).
 */

const TABS = ['route', 'stay', 'entry'] as const;
type Tab = (typeof TABS)[number];

export default async function RumboPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; tripId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale, tripId } = await params;
  const { tab: rawTab } = await searchParams;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  if (!(await tripsEnabled(session, session.activeHouseholdId))) notFound();
  if (!/^[0-9a-f-]{36}$/.test(tripId)) notFound();
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const t = await getTranslations('rumbo');
  const view = await loadRumbo(session, session.activeHouseholdId, tripId, context.today);
  if (!view) notFound();

  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : 'route';
  const p: Presenter = { t, locale };
  const route = presentRoute(p, view);

  const back = (
    <div className="mb-6">
      <Link
        href={`/trips/${tripId}`}
        className="inline-flex min-h-11 items-center text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)]"
      >
        {t('backToTrip')}
      </Link>
    </div>
  );

  const setupLink = (
    <Link href={`/trips/${tripId}/route/setup`} className={route.composed ? SECONDARY : PRIMARY}>
      {route.composed ? t('editSetup') : t('notComposed.cta')}
    </Link>
  );

  if (!route.composed) {
    return (
      <Page>
        {back}
        <PageHeader title={view.trip.name} detail={t('title')} />
        <Card>
          <EmptyState
            title={t('notComposed.title')}
            body={t('notComposed.body')}
            action={setupLink}
          />
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      {back}
      <PageHeader
        title={view.trip.name}
        {...(route.summary ? { detail: route.summary } : {})}
        className="mb-4"
      />
      {/* Below the title, not beside it: on a phone the summary needs the full width. */}
      <div className="mb-8">{setupLink}</div>

      <nav aria-label={t('tabs.label')} className="mb-8 border-b border-[color:var(--color-rule)]">
        <ul className="-mb-px flex gap-6 overflow-x-auto">
          {TABS.map((key) => (
            <li key={key}>
              <Link
                href={`/trips/${tripId}/route?tab=${key}`}
                aria-current={tab === key ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center border-b-2 text-sm font-medium whitespace-nowrap ${
                  tab === key
                    ? 'border-[color:var(--color-ink)] text-[color:var(--color-ink)]'
                    : 'border-transparent text-[color:var(--color-ink-secondary)] hover:text-[color:var(--color-ink)]'
                }`}
              >
                {t(`tabs.${key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-8">
        <RoutingStatus tripId={tripId} routing={route.routing} />

        {tab === 'route' && (
          <>
            {(route.sacrifices ?? route.tripNotices.length > 0) && (
              <div className="flex flex-col gap-3">
                {route.sacrifices && <p className="max-w-[68ch] text-pretty">{route.sacrifices}</p>}
                {route.tripNotices.length > 0 && <Notices notices={route.tripNotices} />}
              </div>
            )}
            <RouteExplorer data={route} locale={locale} />
          </>
        )}

        {tab === 'stay' && (
          <section className="flex flex-col gap-6">
            <header className="flex flex-col gap-2">
              <h2 className="text-2xl font-medium">{t('lodging.title')}</h2>
              <p className="max-w-[68ch] text-pretty text-[color:var(--color-ink-secondary)]">
                {t('lodging.detail')}
              </p>
            </header>
            <LodgingBoard tripId={tripId} data={presentLodging(p, view)} locale={locale} />
          </section>
        )}

        {tab === 'entry' && (
          <>
            <EntrySection p={p} view={view} />
            <section className="flex flex-col gap-6">
              <header className="flex flex-col gap-2">
                <h2 className="text-2xl font-medium">{t('todos.title')}</h2>
                <p className="max-w-[68ch] text-pretty text-[color:var(--color-ink-secondary)]">
                  {t('todos.detail')}
                </p>
              </header>
              <TodoList tripId={tripId} todos={presentTodos(p, view)} />
            </section>
          </>
        )}
        <TakeItAlong
          tripId={tripId}
          locale={locale}
          shares={await loadTripShares(session, session.activeHouseholdId, tripId)}
          origin={getClientEnv().NEXT_PUBLIC_APP_URL}
        />
      </div>
    </Page>
  );
}

const STATUS_TONE: Readonly<Record<string, StatusTone>> = {
  visa_free: 'positive',
  eta: 'caution',
  evisa: 'caution',
  visa_required: 'signal',
  unknown: 'caution',
};

function EntrySection({ p, view }: { readonly p: Presenter; readonly view: RumboView }) {
  const { t, locale } = p;
  const zones = [...new Set(view.entry.map((v) => v.zone))];
  const travelers = view.travelers;
  const missing = travelers.filter((tr) => tr.nationalities.length === 0);
  const needs = new Set(
    view.entry.filter((v) => v.status !== 'visa_free').map((v) => v.travelerId),
  );
  const unknown = view.entry.some((v) => v.status === 'unknown' || v.certainty === 'unverified');
  const zoneName = (z: string) => (z === 'schengen' ? t('entry.schengen') : countryName(z, locale));
  const sources = new Map<string, { name: string; url: string; date: string }>();
  for (const v of view.entry) {
    if (v.rule) {
      sources.set(v.rule.source.url, {
        name: v.rule.source.name,
        url: v.rule.source.url,
        date: shortDate(v.rule.source.checkedOn, locale),
      });
    }
  }
  const notices = [
    ...new Map(view.entry.flatMap((v) => v.notices).map((n) => [JSON.stringify(n), n])).values(),
  ].map((n) => noticeText(p, n, view));

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className="text-2xl font-medium">{t('entry.title')}</h2>
        <p className="max-w-[68ch] text-pretty">
          {travelers.length === 0
            ? t('entry.noTravelers')
            : needs.size > 0
              ? t('entry.summaryNeeds', { count: needs.size })
              : unknown
                ? t('entry.summaryUnknown')
                : t('entry.summaryAllFree')}
        </p>
        {missing.map((m) => (
          <p key={m.id} className="text-sm text-[color:var(--color-ink-secondary)]">
            {t('entry.noPassports', { name: m.name })}
          </p>
        ))}
      </header>

      {zones.length > 0 && (
        <Card padding="lg">
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="text-left text-[color:var(--color-ink-secondary)]">
                  <th className="py-2 pr-4 font-normal">{t('entry.destination')}</th>
                  {travelers.map((tr) => (
                    <th key={tr.id} className="py-2 pr-4 font-normal">
                      {tr.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z} className="border-t border-[color:var(--color-rule)] align-top">
                    <td className="py-3 pr-4 font-medium">{zoneName(z)}</td>
                    {travelers.map((tr) => {
                      const v = view.entry.find((e) => e.zone === z && e.travelerId === tr.id);
                      if (!v) {
                        return (
                          <td
                            key={tr.id}
                            className="py-3 pr-4 text-[color:var(--color-ink-secondary)]"
                          >
                            —
                          </td>
                        );
                      }
                      const status =
                        v.certainty === 'unverified' && v.status === 'visa_free'
                          ? 'unknown'
                          : v.status;
                      return (
                        <td key={tr.id} className="py-3 pr-4">
                          <div className="flex flex-col gap-1">
                            <Status tone={STATUS_TONE[status] ?? 'neutral'}>
                              {t(`entry.status.${v.status}`)}
                            </Status>
                            {v.certainty === 'unverified' && (
                              <span className="text-xs text-[color:var(--color-ink-secondary)]">
                                {t('certainty.unverified')}
                              </span>
                            )}
                            {v.maxStayDays !== null && (
                              <span className="text-xs text-[color:var(--color-ink-secondary)] tabular-nums">
                                {v.windowDays
                                  ? t('entry.daysWindow', {
                                      used: v.daysUsed,
                                      max: v.maxStayDays,
                                      window: v.windowDays,
                                    })
                                  : t('entry.days', { used: v.daysUsed, max: v.maxStayDays })}
                              </span>
                            )}
                            {v.systems.map((s) => (
                              <span
                                key={s}
                                className="text-xs text-[color:var(--color-ink-secondary)]"
                              >
                                {t(`entry.systems.${s}`)}
                              </span>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {notices.length > 0 && <Notices notices={notices} />}

      <div className="flex flex-col gap-2 text-sm text-[color:var(--color-ink-secondary)]">
        {[...sources.values()].map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center self-start underline decoration-[color:var(--color-rule-strong)] underline-offset-4"
          >
            {t('entry.source', { name: s.name, date: s.date })}
          </a>
        ))}
        <p className="max-w-[68ch] text-pretty">{t('entry.disclaimer')}</p>
      </div>
    </section>
  );
}

const PRIMARY =
  'inline-flex h-12 items-center justify-center rounded-(--radius-md) bg-[color:var(--color-panel)] px-6 text-base font-medium text-[color:var(--color-panel-ink)] shadow-(--shadow-card) hover:bg-[color:var(--color-panel-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-ink)]';
const SECONDARY =
  'inline-flex min-h-11 items-center justify-center rounded-(--radius-md) border border-[color:var(--color-rule-strong)] px-4 text-sm font-medium hover:border-[color:var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-ink)]';
