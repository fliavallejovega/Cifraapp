import { formatMoney, Money } from '@app/domain';
import { Card, EmptyState, Page, PageHeader, Section, Stat, Status } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { loadHouseholdContext } from '@/server/household-context';
import { loadAdvice, type AdviceStep } from '@/server/repositories/advice';
import { countUncategorized, loadAlerts } from '@/server/repositories/alerts';
import { loadCommitments, loadDebts, loadGoals } from '@/server/repositories/administration';
import { loadBudgets } from '@/server/repositories/budgets';
import { loadPlan } from '@/server/repositories/plan';
import { loadQueueCounts } from '@/server/repositories/review';
import { requireHousehold } from '@/server/session';

/**
 * What to do this month, in order.
 *
 * Every step is a figure the deterministic engines already computed. The
 * copilot's paragraph sits below them and is additive by construction: if the
 * provider is missing, over budget or ungrounded, the household loses the
 * paragraph and keeps every number. That ordering is the product's argument
 * about AI made visible — the engine decides, the model explains.
 *
 * The screen says so out loud when the copilot is off, rather than leaving a
 * blank space that reads as a bug.
 */
export default async function AdvicePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const householdId = session.activeHouseholdId;
  const context = await loadHouseholdContext(session, householdId, locale);

  const [plan, debts, goals, commitments, budgets, queues, uncategorized] = await Promise.all([
    loadPlan(session, householdId),
    loadDebts(session, householdId, context.currency),
    loadGoals(session, householdId, context.currency),
    loadCommitments(session, householdId, context.currency),
    loadBudgets(session, householdId, context.currency, context.today),
    loadQueueCounts(session, householdId),
    countUncategorized(session, householdId),
  ]);

  const { alerts } = await loadAlerts(session, householdId, {
    currency: context.currency,
    today: context.today,
    plan,
    budgets,
    debts,
    goals,
    commitments,
    queues,
    uncategorized,
  });

  const advice = await loadAdvice(
    session,
    householdId,
    { currency: context.currency, today: context.today, plan, debts, goals, budgets, alerts },
    locale === 'en' ? 'en' : 'es',
  );

  const t = await getTranslations('advice');

  const money = (value: string) =>
    formatMoney(Money.fromDecimalString(value, context.currency), {
      locale: context.moneyLocale,
    });

  /** Fills a step's message with its own figures, formatted for reading. */
  const describe = (step: AdviceStep): string => {
    const values = Object.fromEntries(
      Object.entries(step.values).map(([key, value]) => [
        key,
        key === 'amount' || key === 'projected' || key === 'planned' ? money(value) : value,
      ]),
    );
    return t(`steps.${step.kind}`, values);
  };

  if (advice.isEmpty) {
    return (
      <Page>
        <PageHeader title={t('title')} detail={t('detail')} />
        <Card>
          <EmptyState
            title={t('empty.title')}
            body={t('empty.body')}
            action={
              <Link
                href="/accounts"
                className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
              >
                {t('empty.title')}
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <Stat label={t('available')}>
            {formatMoney(advice.available, { locale: context.moneyLocale })}
          </Stat>
        </Card>
        <Card>
          <Stat label={t('committed')}>
            {formatMoney(advice.committed, { locale: context.moneyLocale })}
          </Stat>
        </Card>
      </div>

      <Section title={t('steps.title')} className="mt-12">
        <ol className="flex flex-col gap-4">
          {advice.steps.map((step, index) => (
            <li key={step.kind}>
              <Card>
                <div className="flex gap-4">
                  <span className="readout shrink-0 text-sm text-[color:var(--color-brand-ink)]">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-pretty text-[color:var(--color-ink)]">{describe(step)}</p>
                    <p className="mt-2">
                      <Link
                        href={step.href}
                        className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
                      >
                        {t('openPlan')}
                      </Link>
                    </p>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section title={t('copilot.title')} detail={t('copilot.detail')} className="mt-12">
        <Card tone="sunk">
          {advice.narrative.state === 'answered' ? (
            <div className="flex flex-col gap-3">
              <p className="max-w-[62ch] text-pretty text-[color:var(--color-ink)]">
                {advice.narrative.summary}
              </p>
              {advice.narrative.cautions.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {advice.narrative.cautions.map((caution) => (
                    <li
                      key={caution}
                      className="max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]"
                    >
                      {caution}
                    </li>
                  ))}
                </ul>
              )}
              <p className="max-w-[62ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
                {t('copilot.disclaimer')}
              </p>
            </div>
          ) : advice.narrative.state === 'unavailable' ? (
            <p className="max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              {t('copilot.unavailable')}
            </p>
          ) : (
            <Status tone="caution">{t(`copilot.${advice.narrative.reason}`)}</Status>
          )}
        </Card>
      </Section>
    </Page>
  );
}
