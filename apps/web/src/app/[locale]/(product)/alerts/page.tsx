import { formatMoney, Money } from '@app/domain';
import { Card, EmptyState, Page, PageHeader, Section } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AlertList } from '@/components/alert-list';
import { loadHouseholdContext } from '@/server/household-context';
import { loadCommitments, loadDebts, loadGoals } from '@/server/repositories/administration';
import { countUncategorized, loadAlerts } from '@/server/repositories/alerts';
import { loadBudgets } from '@/server/repositories/budgets';
import { loadPlan } from '@/server/repositories/plan';
import { loadQueueCounts } from '@/server/repositories/review';
import { requireHousehold } from '@/server/session';

/**
 * What will go wrong if nothing changes.
 *
 * Nothing on this screen is stored. Every alert is recomputed from the ledger
 * on each read, so it cannot disagree with the rows behind it — a stored alert
 * is a second copy of a fact, and the two diverge the moment somebody corrects
 * a transaction.
 *
 * What is stored is «I know». An alert that keeps shouting after a person has
 * answered it is how a household learns to ignore the whole screen, so the
 * acknowledgement lasts until the end of the month and then the question is
 * asked again — because a budget still overrunning in November is a new fact.
 */
export default async function AlertsPage({ params }: { params: Promise<{ locale: string }> }) {
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

  const view = await loadAlerts(session, householdId, {
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

  const t = await getTranslations('alerts');
  const shared = await getTranslations('records');

  const money = (value: string) =>
    formatMoney(Money.fromDecimalString(value, context.currency), {
      locale: context.moneyLocale,
    });

  const MONEY_KEYS = new Set(['amount', 'projected', 'planned', 'usual']);

  const rows = view.alerts.map((alert) => ({
    key: alert.key,
    severity: alert.severity,
    href: alert.href,
    message: t(
      `kinds.${alert.kind}`,
      Object.fromEntries(
        Object.entries(alert.values).map(([name, value]) => [
          name,
          MONEY_KEYS.has(name) ? money(value) : value,
        ]),
      ),
    ),
    severityLabel: t(`severities.${alert.severity}`),
  }));

  return (
    <Page>
      <PageHeader
        title={t('title')}
        detail={
          view.dismissedCount === 0
            ? t('detail')
            : `${t('detail')} · ${t('dismissed', { count: view.dismissedCount })}`
        }
      />

      <Section>
        {rows.length === 0 ? (
          <Card>
            <EmptyState title={t('empty.title')} body={t('empty.body')} />
          </Card>
        ) : (
          <AlertList
            locale={locale}
            alerts={rows}
            labels={{
              dismiss: t('dismiss'),
              go: t('go'),
              errorTitle: shared('errorTitle'),
              generic: shared('errors.generic'),
            }}
          />
        )}
      </Section>
    </Page>
  );
}
