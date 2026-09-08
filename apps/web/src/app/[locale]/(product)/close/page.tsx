import { Card, EmptyState, Page, PageHeader, Section, Status } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ClosePeriodForm } from '@/components/close-period-form';
import { ReopenControl } from '@/components/reopen-control';
import { formatMoment, formatPlainDate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadClose } from '@/server/repositories/close';
import { requireHousehold } from '@/server/session';

/**
 * Sealing a month.
 *
 * A closed period is a promise that the figures quoted from it will not change
 * underneath whoever quoted them. The checklist is what makes the promise
 * keepable: two of its steps block, because a month sealed over movements
 * nobody has categorized is a promise about numbers already known to be wrong.
 *
 * The month being closed is the previous one, not the current one. Closing the
 * month you are still living in seals a period that is still happening.
 */
export default async function ClosePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = await loadHouseholdContext(session, session.activeHouseholdId, locale);
  const view = await loadClose(session, session.activeHouseholdId, context.today);

  const t = await getTranslations('close');
  const shared = await getTranslations('records');

  const errors = {
    blockedByChecklist: t('errors.blockedByChecklist'),
    reasonRequired: t('errors.reasonRequired'),
    notFound: t('errors.notFound'),
    signInRequired: t('errors.signInRequired'),
    generic: t('errors.generic'),
  };

  return (
    <Page>
      <PageHeader
        title={t('title')}
        detail={t('period', {
          start: formatPlainDate(view.period.start, locale),
          end: formatPlainDate(view.period.end, locale),
        })}
      />

      <p className="mb-8 max-w-[62ch] text-pretty text-[color:var(--color-ink-secondary)]">
        {t('detail')} · {t('movements', { count: view.movementCount })}
      </p>

      <Section title={t('checklist.title')} detail={t('checklist.detail')}>
        <Card>
          <ul className="flex flex-col">
            {view.checklist.steps.map((step) => (
              <li
                key={step.step}
                className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[color:var(--color-rule)] py-4 last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="text-sm text-[color:var(--color-ink)]">
                    {t(`checklist.steps.${step.step}`)}
                  </span>
                  {step.blocks && (
                    <span className="mt-0.5 block text-xs text-[color:var(--color-ink-tertiary)]">
                      {t('checklist.blocks')}
                    </span>
                  )}
                </span>

                {step.outstanding === 0 ? (
                  <Status tone="positive">{t('checklist.clear')}</Status>
                ) : (
                  <Status tone={step.blocks ? 'negative' : 'caution'}>
                    {t('checklist.outstanding', { count: step.outstanding })}
                  </Status>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section className="mt-12">
        <Card>
          <ClosePeriodForm
            locale={locale}
            month={view.period.start}
            mayClose={view.checklist.mayClose}
            alreadyClosed={view.current?.status === 'closed'}
            labels={{
              close: t('action.close'),
              closed: t('action.closed'),
              blocked: t('action.blocked'),
              confirm: t('action.confirm'),
              errorTitle: t('errorTitle'),
              errors,
            }}
          />
        </Card>
      </Section>

      <Section title={t('history.title')} className="mt-12">
        <Card>
          {view.history.length === 0 ? (
            <EmptyState title={t('history.empty')} />
          ) : (
            <ul className="flex flex-col">
              {view.history.map((period) => (
                <li
                  key={period.id}
                  className="border-b border-[color:var(--color-rule)] py-4 last:border-b-0"
                >
                  <p className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-medium text-[color:var(--color-ink)]">
                      {formatPlainDate(period.periodStart, locale)} —{' '}
                      {formatPlainDate(period.periodEnd, locale)}
                    </span>
                    <Status tone={period.status === 'closed' ? 'positive' : 'caution'}>
                      {t(`history.statuses.${period.status}`)}
                    </Status>
                  </p>

                  <p className="mt-1 text-sm text-[color:var(--color-ink-secondary)]">
                    {period.closedAt &&
                      t('history.closedOn', {
                        date: formatMoment(period.closedAt, locale, context.timeZone),
                      })}
                    {period.reopenedAt &&
                      ` · ${t('history.reopenedOn', {
                        date: formatMoment(period.reopenedAt, locale, context.timeZone),
                      })}`}
                  </p>

                  {period.reopenReason && (
                    <p className="mt-1 text-sm text-[color:var(--color-ink-tertiary)]">
                      {period.reopenReason}
                    </p>
                  )}

                  {period.status === 'closed' && (
                    <div className="mt-3">
                      <ReopenControl
                        locale={locale}
                        periodId={period.id}
                        labels={{
                          title: t('reopen.title'),
                          detail: t('reopen.detail'),
                          reason: t('reopen.reason'),
                          action: t('reopen.action'),
                          cancel: shared('cancel'),
                          errorTitle: t('errorTitle'),
                          errors,
                        }}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
    </Page>
  );
}
