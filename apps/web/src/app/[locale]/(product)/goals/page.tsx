import { formatMoney, Money } from '@app/domain';
import { Card, Page, PageHeader, Section, Stat } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RecordsManager } from '@/components/records';
import type { FieldSpec, RecordRow } from '@/components/records/spec';
import { createGoal, removeGoal, updateGoal } from '@/server/goal-actions';
import { loadHouseholdContext } from '@/server/household-context';
import { recordLabels } from '@/server/record-labels';
import { loadGoals } from '@/server/repositories/administration';
import { requireHousehold } from '@/server/session';
import { formatPlainDate, percentOf } from '@/lib/format';

/**
 * What the household is saving toward.
 *
 * A goal without visible progress is a wish. The questionnaire collected these
 * and the product never showed a single one again — no «how much is left», no
 * «at this rate, when». The progress on each row is the whole point of the
 * screen; the totals above it are only there so the household can see whether
 * the goals, added up, are a plan or a fantasy.
 */
export default async function GoalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const goals = await loadGoals(session, session.activeHouseholdId, context.currency);

  const t = await getTranslations('goals');
  const shared = await getTranslations('records');

  // Abandoned goals are shown, muted, but never counted. A total that included
  // what the household gave up on would overstate what it is working toward.
  const counted = goals.filter((goal) => goal.status === 'active' || goal.status === 'reached');
  const target = Money.sum(
    counted.map((goal) => goal.targetAmount),
    context.currency,
  );
  const saved = Money.sum(
    counted.map((goal) => goal.currentAmount),
    context.currency,
  );

  const fields: readonly FieldSpec[] = [
    { kind: 'text', name: 'name', label: t('form.name'), hint: t('form.nameHint'), required: true },
    { kind: 'money', name: 'targetAmount', label: t('form.target'), required: true, half: true },
    {
      kind: 'money',
      name: 'currentAmount',
      label: t('form.saved'),
      hint: t('form.savedHint'),
      required: true,
      half: true,
    },
    {
      kind: 'date',
      name: 'targetDate',
      label: t('form.date'),
      hint: t('form.dateHint'),
      half: true,
    },
    {
      kind: 'select',
      name: 'priority',
      label: t('form.priority'),
      half: true,
      options: (['100', '200', '300'] as const).map((value) => ({
        value,
        label: t(`priorities.${value}`),
      })),
    },
    {
      kind: 'select',
      name: 'status',
      label: t('form.status'),
      half: true,
      options: (['active', 'reached', 'paused', 'abandoned'] as const).map((value) => ({
        value,
        label: t(`statuses.${value}`),
      })),
    },
  ];

  const rows: readonly RecordRow[] = goals.map((goal) => {
    const missing = goal.targetAmount.subtract(goal.currentAmount);
    const reached = !missing.isPositive();

    return {
      id: goal.id,
      title: goal.name,
      href: `/goals/${goal.id}`,
      subtitle: [
        reached
          ? t('row.reached')
          : t('row.progress', {
              percent: percentOf(goal.currentAmount, goal.targetAmount),
              amount: formatMoney(missing, { locale: context.moneyLocale }),
            }),
        ...(goal.targetDate
          ? [t('row.by', { date: formatPlainDate(goal.targetDate, locale) })]
          : []),
      ].join(' · '),
      amount: formatMoney(goal.currentAmount, { locale: context.moneyLocale }),
      amountDetail: formatMoney(goal.targetAmount, { locale: context.moneyLocale }),
      badges:
        goal.status === 'active'
          ? []
          : [
              {
                label: t(`statuses.${goal.status}`),
                tone: goal.status === 'reached' ? ('positive' as const) : ('neutral' as const),
              },
            ],
      muted: goal.status === 'abandoned' || goal.status === 'paused',
      values: {
        name: goal.name,
        targetAmount: goal.targetAmount.toDecimalString(),
        currentAmount: goal.currentAmount.toDecimalString(),
        targetDate: goal.targetDate ?? '',
        priority: String(goal.priority),
        status: goal.status,
      },
    };
  });

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {counted.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <Stat label={t('summary.target')}>
              {formatMoney(target, { locale: context.moneyLocale })}
            </Stat>
          </Card>
          <Card>
            <Stat label={t('summary.saved')} detail={t('summary.savedDetail')}>
              {formatMoney(saved, { locale: context.moneyLocale })}
            </Stat>
          </Card>
        </div>
      )}

      <Section title={t('list.title')} detail={t('list.detail')} className="mt-12">
        <Card>
          <RecordsManager
            locale={locale}
            currencySymbol={context.currencySymbol}
            rows={rows}
            fields={fields}
            create={createGoal}
            update={updateGoal}
            remove={removeGoal}
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
    </Page>
  );
}
