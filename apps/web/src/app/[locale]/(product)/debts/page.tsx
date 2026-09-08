import { formatMoney, Money } from '@app/domain';
import { Card, Page, PageHeader, Section, Stat } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RecordsManager } from '@/components/records';
import type { FieldSpec, RecordRow } from '@/components/records/spec';
import { createDebt, removeDebt, updateDebt } from '@/server/debt-actions';
import { loadHouseholdContext } from '@/server/household-context';
import { recordLabels } from '@/server/record-labels';
import { loadDebts } from '@/server/repositories/administration';
import { requireHousehold } from '@/server/session';
import { percentOf, trimRate } from '@/lib/format';

/**
 * What is owed.
 *
 * Ordered by rate, highest first, on purpose. The plan argues every month that
 * the extra dollar belongs to the most expensive balance; a list that showed
 * debts in the order they were typed would quietly contradict the advice on the
 * next screen, and a household that notices two screens disagreeing stops
 * believing either.
 */
export default async function DebtsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const debts = await loadDebts(session, session.activeHouseholdId, context.currency);

  const t = await getTranslations('debts');
  const shared = await getTranslations('records');

  const owed = Money.sum(
    debts.map((debt) => debt.currentBalance),
    context.currency,
  );
  const minimums = Money.sum(
    debts.map((debt) => debt.minimumPayment),
    context.currency,
  );

  const fields: readonly FieldSpec[] = [
    { kind: 'text', name: 'name', label: t('form.name'), hint: t('form.nameHint'), required: true },
    {
      kind: 'money',
      name: 'currentBalance',
      label: t('form.balance'),
      hint: t('form.balanceHint'),
      required: true,
      half: true,
    },
    {
      kind: 'rate',
      name: 'apr',
      label: t('form.apr'),
      hint: t('form.aprHint'),
      suffix: '%',
      required: true,
      half: true,
    },
    { kind: 'money', name: 'minimumPayment', label: t('form.minimum'), required: true, half: true },
    {
      kind: 'money',
      name: 'creditLimit',
      label: t('form.limit'),
      hint: t('form.limitHint'),
      half: true,
    },
    {
      kind: 'integer',
      name: 'dueDay',
      label: t('form.dueDay'),
      hint: t('form.dueDayHint'),
      min: 1,
      max: 31,
      half: true,
    },
    {
      kind: 'integer',
      name: 'statementDay',
      label: t('form.statementDay'),
      min: 1,
      max: 31,
      half: true,
    },
  ];

  const rows: readonly RecordRow[] = debts.map((debt) => ({
    id: debt.id,
    title: debt.name,
    href: `/debts/${debt.id}`,
    subtitle: [
      t('row.apr', { apr: trimRate(debt.apr) }),
      t('row.minimum', {
        amount: formatMoney(debt.minimumPayment, { locale: context.moneyLocale }),
      }),
      ...(debt.dueDay === null ? [] : [t('row.dueDay', { day: debt.dueDay })]),
      ...(debt.creditLimit?.isPositive()
        ? [t('row.used', { percent: percentOf(debt.currentBalance, debt.creditLimit) })]
        : []),
    ].join(' · '),
    amount: formatMoney(debt.currentBalance, { locale: context.moneyLocale }),
    values: {
      name: debt.name,
      currentBalance: debt.currentBalance.toDecimalString(),
      apr: trimRate(debt.apr),
      minimumPayment: debt.minimumPayment.toDecimalString(),
      creditLimit: debt.creditLimit?.toDecimalString() ?? '',
      dueDay: debt.dueDay === null ? '' : String(debt.dueDay),
      statementDay: debt.statementDay === null ? '' : String(debt.statementDay),
    },
  }));

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {debts.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <Stat label={t('summary.owed')} detail={t('summary.owedDetail')}>
              {formatMoney(owed, { locale: context.moneyLocale })}
            </Stat>
          </Card>
          <Card>
            <Stat label={t('summary.minimums')} detail={t('summary.minimumsDetail')}>
              {formatMoney(minimums, { locale: context.moneyLocale })}
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
            create={createDebt}
            update={updateDebt}
            remove={removeDebt}
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
