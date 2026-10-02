import type { Insight } from '@app/trip-engine';
import { Card, EmptyState, Page, PageHeader, Section, Status } from '@app/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CategoryBars, CumulativeLine } from '@/components/trips/report-charts';
import { ClosePanel, TemplateButton } from '@/components/trips/report-close';
import { Link } from '@/i18n/navigation';
import { formatAmount, formatDateRange, formatDay } from '@/lib/trip-format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadTripReport, tripsEnabled } from '@/server/repositories/trips';
import { requireHousehold } from '@/server/session';

/**
 * The closing report: what was planned against what happened.
 *
 * The headline is what the days spent against their plan; under it, the
 * sentences that explain it — written by rule from the engine's numbers —
 * then where the money went, and at the end, closing the trip: freezing the
 * report and sending the leftover somewhere useful.
 */
export default async function TripReportPage({
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
  const view = /^[0-9a-f-]{36}$/.test(tripId)
    ? await loadTripReport(
        session,
        session.activeHouseholdId,
        tripId,
        context.today,
        context.currency,
      )
    : null;
  if (!view) notFound();

  const { dashboard, report } = view;
  const { trip } = dashboard;
  const currency = report.currency.trim();
  const money = (value: string) => formatAmount(value.replace(/^-/, ''), currency, locale);
  const closed = trip.status === 'completed';
  const timeZone =
    session.households.find((h) => h.id === session.activeHouseholdId)?.timeZone ??
    'America/Panama';
  const ended = context.today > trip.endDate;
  const hasSpending = /[1-9]/.test(report.actual);
  const legCity = new Map(dashboard.legs.map((l) => [l.id, l.city]));
  const travelerName = new Map(dashboard.travelers.map((tr) => [tr.id, tr.displayName]));

  const sentence = (
    insight: Insight,
  ): { text: string; tone: 'positive' | 'caution' | 'neutral' } => {
    switch (insight.kind) {
      case 'category_over':
        return {
          tone: 'caution',
          text: t('report.insight.categoryOver', {
            category: t(`common.category.${insight.category}`),
            percent: insight.percent,
          }),
        };
      case 'category_under':
        return {
          tone: 'positive',
          text: t('report.insight.categoryUnder', {
            category: t(`common.category.${insight.category}`),
            percent: insight.percent,
          }),
        };
      case 'overall_under':
        return {
          tone: 'positive',
          text: t('report.insight.overallUnder', { amount: money(insight.amount) }),
        };
      case 'overall_over':
        return {
          tone: 'caution',
          text: t('report.insight.overallOver', { amount: money(insight.amount) }),
        };
      case 'reserve_untouched':
        return { tone: 'positive', text: t('report.insight.reserveUntouched') };
      case 'reserve_used':
        return {
          tone: 'neutral',
          text: t('report.insight.reserveUsed', { percent: insight.percent }),
        };
      case 'exchange':
        return insight.amount.startsWith('-')
          ? {
              tone: 'positive',
              text: t('report.insight.exchangeCheaper', { amount: money(insight.amount) }),
            }
          : {
              tone: 'caution',
              text: t('report.insight.exchangeDearer', { amount: money(insight.amount) }),
            };
    }
  };

  const under = !report.difference.startsWith('-');
  const csvHref = `/api/trips/${trip.id}/export?locale=${locale === 'en' ? 'en' : 'es'}`;

  return (
    <Page>
      <div className="mb-6">
        <Link
          href={`/trips/${trip.id}`}
          className="inline-flex min-h-11 items-center text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)]"
        >
          {t('today.backToTrip')}
        </Link>
      </div>
      <PageHeader
        title={trip.name}
        detail={`${t('report.title')} — ${formatDateRange(trip.startDate, trip.endDate, locale)}`}
      />

      {!ended && !closed && (
        <div className="mb-6">
          <Status tone="signal">{t('report.provisional')}</Status>
        </div>
      )}

      <Card tone="panel" padding="lg">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[color:var(--color-panel-ink-secondary)]">
            {t('report.hero.label')}
          </p>
          <p className="readout text-4xl tracking-[-0.03em] tabular-nums sm:text-5xl">
            {money(report.actual)}
          </p>
          <p className="text-sm text-[color:var(--color-panel-ink-secondary)]">
            {hasSpending
              ? t(under ? 'report.hero.under' : 'report.hero.over', {
                  planned: money(report.planned),
                  difference: money(report.difference),
                })
              : t('report.hero.planned', { planned: money(report.planned) })}
          </p>
        </div>
      </Card>

      {!hasSpending ? (
        <Card className="mt-8">
          <EmptyState
            title={t('report.empty.title')}
            body={t('report.empty.body')}
            action={
              <Link
                href={`/trips/${trip.id}/today`}
                className="text-sm font-medium underline underline-offset-4"
              >
                {t('report.empty.action')}
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          {report.insights.length > 0 && (
            <Section title={t('report.insights')} className="mt-12">
              <ul className="flex flex-col gap-3">
                {report.insights.map((insight, i) => {
                  const s = sentence(insight);
                  return (
                    <li key={`${insight.kind}-${String(i)}`}>
                      <Status tone={s.tone}>{s.text}</Status>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          <Section
            title={t('report.byCategory.title')}
            detail={t('report.byCategory.detail')}
            className="mt-12"
          >
            <Card>
              <CategoryBars
                rows={report.byCategory.map((row) => ({
                  key: row.key,
                  label: t(`common.category.${row.key as 'food'}`),
                  planned: row.planned,
                  actual: row.actual,
                }))}
                currency={currency}
                locale={locale}
                labels={{ actual: t('report.actual'), planned: t('report.planned') }}
              />
            </Card>
          </Section>

          {report.byDay.length > 1 && (
            <Section
              title={t('report.byDay.title')}
              detail={t('report.byDay.detail')}
              className="mt-12"
            >
              <Card>
                <CumulativeLine
                  days={report.byDay}
                  currency={currency}
                  locale={locale}
                  labels={{
                    actual: t('report.actual'),
                    planned: t('report.planned'),
                    day: t('report.byDay.day'),
                    caption: t('report.byDay.caption'),
                  }}
                />
              </Card>
            </Section>
          )}

          <div className="mt-12 grid gap-8 lg:grid-cols-2">
            {report.byLeg.length > 1 && (
              <Section title={t('report.byLeg')} className="mt-0">
                <Rows
                  rows={report.byLeg.map((row) => ({
                    key: row.key,
                    label: legCity.get(row.key) ?? '—',
                    value: money(row.actual),
                    detail: t('report.ofPlanned', { planned: money(row.planned) }),
                  }))}
                />
              </Section>
            )}
            {report.byTraveler.length > 1 && (
              <Section title={t('report.byTraveler')} className="mt-0">
                <Rows
                  rows={report.byTraveler.map((row) => ({
                    key: row.travelerId ?? 'shared',
                    label: row.travelerId
                      ? (travelerName.get(row.travelerId) ?? '—')
                      : t('report.shared'),
                    value: money(row.actual),
                  }))}
                />
              </Section>
            )}
            <Section title={t('report.reserve.title')} className="mt-0">
              <Rows
                rows={[
                  {
                    key: 'reserve',
                    label: t('report.reserve.used', { percent: report.reserve.usedPercent }),
                    value: money(report.reserve.used),
                    detail: t('report.ofPlanned', { planned: money(report.reserve.planned) }),
                  },
                  {
                    key: 'exchange',
                    label: report.exchangeEffect.startsWith('-')
                      ? t('report.exchange.cheaper')
                      : t('report.exchange.dearer'),
                    value: money(report.exchangeEffect),
                  },
                  ...(/[1-9]/.test(report.overrun)
                    ? [{ key: 'overrun', label: t('report.overrun'), value: money(report.overrun) }]
                    : []),
                ]}
              />
            </Section>
            {view.byAccount.length > 0 && (
              <Section title={t('report.byAccount')} className="mt-0">
                <Rows
                  rows={view.byAccount.map((row) => ({
                    key: row.accountId,
                    label: row.name,
                    value: money(row.amount),
                  }))}
                />
              </Section>
            )}
          </div>
        </>
      )}

      <Section
        title={closed ? t('report.closed.title') : t('report.close.title')}
        detail={
          closed
            ? t('report.closed.detail', {
                date: trip.completedAt
                  ? formatDay(trip.completedAt.toLocaleDateString('en-CA', { timeZone }), locale, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })
                  : '',
              })
            : t('report.close.detail')
        }
        className="mt-12"
      >
        <Card>
          <div className="flex flex-col gap-6">
            {closed ? null : ended ? (
              <ClosePanel
                tripId={trip.id}
                surplus={report.surplus}
                currency={currency}
                locale={locale}
                goals={view.goals}
                accounts={dashboard.accounts
                  .filter((a) => a.currency.trim() === currency)
                  .map((a) => ({ id: a.id, name: a.name }))}
                fundingAccountId={trip.fundingAccountId}
              />
            ) : (
              <p className="text-sm text-[color:var(--color-ink-secondary)]">
                {t('report.close.notYet', {
                  date: formatDay(trip.endDate, locale, { day: 'numeric', month: 'long' }),
                })}
              </p>
            )}
            <div className="flex flex-wrap items-start gap-3 border-t border-[color:var(--color-rule)] pt-6">
              <TemplateButton tripId={trip.id} locale={locale} />
              <a
                href={csvHref}
                download
                className="inline-flex h-12 items-center rounded-(--radius-md) px-4 text-base font-medium underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)]"
              >
                {t('report.csv')}
              </a>
            </div>
            <p className="text-sm text-[color:var(--color-ink-secondary)]">
              {t('report.template.detail')}
            </p>
          </div>
        </Card>
      </Section>
    </Page>
  );
}

function Rows({
  rows,
}: {
  readonly rows: readonly { key: string; label: string; value: string; detail?: string }[];
}) {
  return (
    <Card>
      <ul className="flex flex-col divide-y divide-[color:var(--color-rule)]">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0"
          >
            <span className="min-w-0 break-words">{row.label}</span>
            <span className="flex shrink-0 flex-col items-end text-right">
              <span className="font-medium tabular-nums">{row.value}</span>
              {row.detail && (
                <span className="text-sm text-[color:var(--color-ink-secondary)] tabular-nums">
                  {row.detail}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
