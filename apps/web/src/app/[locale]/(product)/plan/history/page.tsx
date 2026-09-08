import { formatMoney } from '@app/domain';
import {
  Amount,
  Card,
  EmptyState,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Page,
  PageHeader,
  Section,
  Status,
} from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AcceptPlanButton } from '@/components/accept-plan-button';
import { Link } from '@/i18n/navigation';
import { formatPlainDate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadAcceptedPlans } from '@/server/repositories/plan-history';
import { requireHousehold } from '@/server/session';

/**
 * Did I do what I decided?
 *
 * Until the plan could be accepted it was recomputed on every visit and never
 * written down — a suggestion that evaporated. A household could read «put
 * $2,590 against this card», do it, and have nothing to compare a month later.
 *
 * Compliance is shown only where it can be checked against money that actually
 * arrived somewhere. A plan with nothing observable says so, rather than
 * printing a percentage built on an assumption.
 */
export default async function PlanHistoryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const plans = await loadAcceptedPlans(session, session.activeHouseholdId, context.currency);

  const t = await getTranslations('planHistory');
  const shared = await getTranslations('records');

  return (
    <Page>
      <div className="mb-6">
        <Link
          href="/plan"
          className="text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)] hover:decoration-[color:var(--color-brand)]"
        >
          {t('title')}
        </Link>
      </div>

      <PageHeader title={t('title')} detail={t('detail')} />

      <Card>
        <div className="flex flex-col gap-4">
          <p className="max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {t('acceptDetail')}
          </p>
          <AcceptPlanButton
            locale={locale}
            labels={{
              action: t('accept'),
              accepted: t('accepted'),
              errorTitle: shared('errorTitle'),
              errors: {
                nothingToAccept: shared('errors.nothingToAccept'),
                generic: shared('errors.generic'),
              },
            }}
          />
        </div>
      </Card>

      <Section title={t('list.title')} className="mt-12">
        {plans.length === 0 ? (
          <Card>
            <EmptyState title={t('empty.title')} body={t('empty.body')} />
          </Card>
        ) : (
          <ul className="flex flex-col gap-6">
            {plans.map((plan) => (
              <li key={plan.id}>
                <Card padding="none">
                  <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 pt-5 pb-4 sm:px-6">
                    <div className="min-w-0">
                      <p className="font-medium text-[color:var(--color-ink)]">
                        {t('on', { date: formatPlainDate(plan.generatedFor, locale) })}
                      </p>
                      <p className="mt-1 text-sm text-[color:var(--color-ink-secondary)]">
                        {t('incoming', {
                          amount: formatMoney(plan.incoming, { locale: context.moneyLocale }),
                        })}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Status tone={plan.outcome === 'accepted' ? 'positive' : 'neutral'}>
                        {t(`outcomes.${plan.outcome}`)}
                      </Status>
                      {plan.compliance !== null && (
                        <Status tone={plan.compliance >= 80 ? 'positive' : 'caution'}>
                          {t('compliance', { percent: plan.compliance })}
                        </Status>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <Ledger caption={t('list.title')}>
                      <LedgerHead>
                        <LedgerColumn>{t('columns.line')}</LedgerColumn>
                        <LedgerColumn align="end">{t('columns.planned')}</LedgerColumn>
                        <LedgerColumn align="end">{t('columns.actual')}</LedgerColumn>
                      </LedgerHead>
                      <LedgerBody>
                        {plan.lines.map((line) => (
                          <LedgerRow key={line.id}>
                            <LedgerCell>
                              {line.label}
                              <span className="mt-0.5 block text-xs text-[color:var(--color-ink-tertiary)]">
                                {line.explanation}
                              </span>
                            </LedgerCell>
                            <LedgerCell align="end">
                              <Amount
                                value={line.planned}
                                locale={context.moneyLocale}
                                size="sm"
                                tone="plain"
                              />
                            </LedgerCell>
                            <LedgerCell align="end" secondary>
                              {line.actual === null ? (
                                '—'
                              ) : (
                                <Amount
                                  value={line.actual}
                                  locale={context.moneyLocale}
                                  size="sm"
                                  tone="plain"
                                />
                              )}
                            </LedgerCell>
                          </LedgerRow>
                        ))}
                      </LedgerBody>
                    </Ledger>
                  </div>

                  {plan.compliance === null && (
                    <p className="px-5 pb-5 text-sm text-[color:var(--color-ink-secondary)] sm:px-6">
                      {t('notMeasurable')}
                    </p>
                  )}
                  {plan.compliance !== null && (
                    <p className="px-5 pb-5 text-sm text-[color:var(--color-ink-secondary)] sm:px-6">
                      {t('complianceDetail')}
                    </p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
