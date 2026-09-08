import { formatMoney } from '@app/domain';
import { Card, Page, PageHeader, Problem, Section, Stat, Status } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PlanChooser } from '@/components/plan-chooser';
import { formatPlainDate } from '@/lib/format';
import { checkoutIsReady } from '@/server/billing-actions';
import { loadHouseholdContext } from '@/server/household-context';
import { loadSubscription } from '@/server/repositories/billing';
import { requireHousehold } from '@/server/session';

/**
 * What the household pays, and what it is getting.
 *
 * The usage figures are the reason this screen exists. «Plus, $9.99» tells
 * somebody nothing; «184 of your 250 movements this month» tells them whether
 * the plan they are on still fits, which is the only question a subscription
 * screen has to answer.
 *
 * A deployment with no payment processor says so out loud. Most installations
 * of this product are in that state, and it has to read as a state of the world
 * rather than as an outage — the free plan's limits are applied either way.
 */
export default async function SubscriptionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = await loadHouseholdContext(session, session.activeHouseholdId, locale);
  const ready = await checkoutIsReady();
  const view = await loadSubscription(
    session,
    session.activeHouseholdId,
    context.currency,
    context.today,
    ready,
  );

  const t = await getTranslations('subscription');

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <Stat label={t('current.title')}>{view.planName}</Stat>
        </Card>
        <Card>
          <Stat label={t('current.status')}>{t(`statuses.${view.status}`)}</Stat>
        </Card>
        <Card>
          <Stat
            label={t('plans.perMonth')}
            {...(view.currentPeriodEnd
              ? {
                  detail: view.cancelAt
                    ? t('current.cancels', {
                        date: formatPlainDate(view.cancelAt, locale),
                      })
                    : t('current.renews', {
                        date: formatPlainDate(view.currentPeriodEnd, locale),
                      }),
                }
              : {})}
          >
            {view.price ? formatMoney(view.price, { locale: context.moneyLocale }) : '—'}
          </Stat>
        </Card>
      </div>

      <Section title={t('usage.title')} detail={t('usage.detail')} className="mt-12">
        <Card>
          <ul className="flex flex-col">
            {view.usage.map((row) => (
              <li
                key={row.key}
                className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[color:var(--color-rule)] py-3 last:border-b-0"
              >
                <span className="text-sm text-[color:var(--color-ink)]">
                  {t(`usage.keys.${row.key}`)}
                </span>
                <span className="readout text-sm text-[color:var(--color-ink-secondary)] tabular-nums">
                  {row.limit === null ? (
                    t('usage.unlimited')
                  ) : row.limit === 0 ? (
                    <Status tone="neutral">{t('usage.notIncluded')}</Status>
                  ) : (
                    t('usage.of', { used: row.used, limit: row.limit })
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      {!ready && (
        <div className="mt-12">
          <Problem title={t('unavailable.title')} body={t('unavailable.body')} />
        </div>
      )}

      <Section title={t('plans.title')} className="mt-12">
        <PlanChooser
          locale={locale}
          checkoutAvailable={ready}
          plans={view.options.map((plan) => ({
            code: plan.code,
            name: plan.name,
            price: formatMoney(plan.price, { locale: context.moneyLocale }),
            interval: plan.interval === 'year' ? t('plans.perYear') : t('plans.perMonth'),
            isCurrent: plan.isCurrent,
          }))}
          labels={{
            current: t('plans.current'),
            choose: t('plans.choose'),
            errorTitle: t('errorTitle'),
            errors: {
              checkoutUnavailable: t('errors.checkoutUnavailable'),
              checkoutFailed: t('errors.checkoutFailed'),
              notFound: t('errors.notFound'),
              signInRequired: t('errors.signInRequired'),
              generic: t('errors.generic'),
            },
          }}
        />
      </Section>

      <p className="mt-8 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {t('provisional')}
      </p>
    </Page>
  );
}
