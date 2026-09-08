import { formatMoney } from '@app/domain';
import { Card, Page, PageHeader, Section, Stat, Status } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RecordsManager } from '@/components/records';
import type { FieldSpec, RecordRow } from '@/components/records/spec';
import { SuggestBudgetButton } from '@/components/suggest-budget-button';
import { createBudget, removeBudget, updateBudget } from '@/server/budget-actions';
import { loadHouseholdContext } from '@/server/household-context';
import { recordLabels } from '@/server/record-labels';
import { loadBudgets } from '@/server/repositories/budgets';
import { requireHousehold } from '@/server/session';

/**
 * What the household means to spend.
 *
 * The engine has computed a budget's state since Phase 7 and had no screen to
 * compute it for. Each row shows the two figures that matter and are usually
 * confused: what is left, which already subtracts commitments still to be paid,
 * and where the month lands at the current pace.
 */
export default async function BudgetsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const budgets = await loadBudgets(
    session,
    session.activeHouseholdId,
    context.currency,
    context.today,
  );

  const t = await getTranslations('budgets');
  const shared = await getTranslations('records');

  const fields: readonly FieldSpec[] = [
    { kind: 'text', name: 'name', label: t('form.name'), hint: t('form.nameHint'), required: true },
    {
      kind: 'select',
      name: 'period',
      label: t('form.period'),
      half: true,
      options: (['monthly', 'weekly', 'annual', 'sinking'] as const).map((value) => ({
        value,
        label: t(`periods.${value}`),
      })),
    },
    { kind: 'date', name: 'startsOn', label: t('form.starts'), half: true },
    { kind: 'date', name: 'endsOn', label: t('form.ends'), hint: t('form.endsHint'), half: true },
  ];

  const rows: readonly RecordRow[] = budgets.map((budget) => ({
    id: budget.id,
    title: budget.name,
    href: `/budgets/${budget.id}`,
    subtitle: [
      t(`periods.${budget.period}`),
      budget.lineCount === 0 ? t('row.noLines') : t('row.lines', { count: budget.lineCount }),
      formatMoney(budget.state.spent, { locale: context.moneyLocale }),
    ].join(' · '),
    amount: formatMoney(budget.state.planned, { locale: context.moneyLocale }),
    amountDetail: formatMoney(budget.state.remaining, { locale: context.moneyLocale }),
    badges: budget.state.isOverspent
      ? [
          {
            label: t('row.over', {
              amount: formatMoney(budget.state.remaining.abs(), { locale: context.moneyLocale }),
            }),
            tone: 'negative' as const,
          },
        ]
      : budget.state.isProjectedOver
        ? [{ label: t('row.pace'), tone: 'caution' as const }]
        : [],
    values: {
      name: budget.name,
      period: budget.period,
      startsOn: budget.startsOn,
      endsOn: budget.endsOn ?? '',
    },
  }));

  const active = budgets[0];

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {active && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <Stat label={t('summary.planned')}>
              {formatMoney(active.state.planned, { locale: context.moneyLocale })}
            </Stat>
          </Card>
          <Card>
            <Stat label={t('summary.spent')}>
              {formatMoney(active.state.spent, { locale: context.moneyLocale })}
            </Stat>
          </Card>
          <Card>
            <Stat label={t('summary.remaining')}>
              {formatMoney(active.state.remaining, { locale: context.moneyLocale })}
            </Stat>
          </Card>
          <Card>
            <Stat label={t('summary.projected')}>
              {formatMoney(active.state.projected, { locale: context.moneyLocale })}
            </Stat>
          </Card>
        </div>
      )}

      {budgets.length === 0 && (
        <Section title={t('suggest')} detail={t('suggestDetail')}>
          <Card>
            <SuggestBudgetButton
              locale={locale}
              labels={{
                action: t('suggest'),
                errorTitle: shared('errorTitle'),
                generic: shared('errors.generic'),
              }}
            />
          </Card>
        </Section>
      )}

      <Section title={t('list.title')} detail={t('list.detail')} className="mt-12">
        <Card>
          <RecordsManager
            locale={locale}
            currencySymbol={context.currencySymbol}
            rows={rows}
            fields={fields}
            create={createBudget}
            update={updateBudget}
            remove={removeBudget}
            labels={recordLabels(shared, {
              addAction: t('add'),
              addTitle: t('addTitle'),
              submitCreate: t('submitCreate'),
              submitUpdate: t('submitUpdate'),
              emptyTitle: t('empty.title'),
              emptyBody: t('empty.body'),
              removeConfirm: t('removeConfirm'),
            })}
          />
        </Card>
      </Section>

      {budgets.length > 0 && (
        <Section title={t('suggest')} detail={t('suggestDetail')} className="mt-12">
          <Card>
            <SuggestBudgetButton
              locale={locale}
              labels={{
                action: t('suggest'),
                errorTitle: shared('errorTitle'),
                generic: shared('errors.generic'),
              }}
            />
          </Card>
        </Section>
      )}

      {/* A status the summary above never shows on its own. */}
      {active?.state.isProjectedOver && !active.state.isOverspent && (
        <p className="mt-8">
          <Status tone="caution">{t('row.pace')}</Status>
        </p>
      )}
    </Page>
  );
}
