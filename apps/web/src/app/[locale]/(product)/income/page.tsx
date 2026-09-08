import { formatMoney, Money } from '@app/domain';
import { Card, Page, PageHeader, Section, Stat } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RecordsManager } from '@/components/records';
import type { FieldSpec, RecordRow } from '@/components/records/spec';
import { createIncome, removeIncome, updateIncome } from '@/server/income-actions';
import { loadHouseholdContext } from '@/server/household-context';
import { recordLabels } from '@/server/record-labels';
import { loadIncomes } from '@/server/repositories/administration';
import { requireHousehold } from '@/server/session';
import { formatPlainDate } from '@/lib/format';

/**
 * What the household earns.
 *
 * The setup questionnaire created these rows and then nothing in the product
 * could show them, change them or take one away. A salary that changed, a
 * freelance contract that ended, a figure typed with a missing zero — all of it
 * permanent. This screen is the correction.
 *
 * The one summary figure is the monthly equivalent, because that is the number
 * every other screen reasons in. A weekly income and an annual bonus are not
 * comparable until they are both expressed per month, and doing that conversion
 * in the reader's head is exactly the work the product exists to remove.
 */

/** Twelve months over the payments in a year, as an exact ratio per cadence. */
const MONTHLY_EQUIVALENT = {
  weekly: { times: 52, over: 12 },
  biweekly: { times: 26, over: 12 },
  semimonthly: { times: 24, over: 12 },
  monthly: { times: 1, over: 1 },
  quarterly: { times: 1, over: 3 },
  annual: { times: 1, over: 12 },
} as const;

export default async function IncomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = await loadHouseholdContext(session, session.activeHouseholdId, locale);
  const incomes = await loadIncomes(session, session.activeHouseholdId, context.currency);

  const t = await getTranslations('income');
  const shared = await getTranslations('records');

  const active = incomes.filter((income) => income.isActive);
  const monthly = Money.sum(
    active.map((income) => {
      const ratio = MONTHLY_EQUIVALENT[income.frequency as keyof typeof MONTHLY_EQUIVALENT];
      // Multiply before dividing, so a weekly figure keeps its cents through
      // the 52/12 conversion instead of rounding twice.
      return ratio ? income.amount.multiply(ratio.times).divide(ratio.over) : income.amount;
    }),
    context.currency,
  );

  const fields: readonly FieldSpec[] = [
    { kind: 'text', name: 'name', label: t('form.name'), hint: t('form.nameHint'), required: true },
    {
      kind: 'money',
      name: 'amount',
      label: t('form.amount'),
      hint: t('form.amountHint'),
      required: true,
      half: true,
    },
    {
      kind: 'select',
      name: 'frequency',
      label: t('form.frequency'),
      required: true,
      half: true,
      options: (
        ['monthly', 'semimonthly', 'biweekly', 'weekly', 'quarterly', 'annual'] as const
      ).map((value) => ({ value, label: t(`frequencies.${value}`) })),
    },
    {
      kind: 'date',
      name: 'nextExpectedDate',
      label: t('form.next'),
      hint: t('form.nextHint'),
      half: true,
    },
    {
      kind: 'toggle',
      name: 'isApproximate',
      label: t('form.approximate'),
      toggleLabel: t('form.approximate'),
      hint: t('form.approximateHint'),
      half: true,
    },
  ];

  const rows: readonly RecordRow[] = incomes.map((income) => ({
    id: income.id,
    title: income.name,
    subtitle: `${t(`frequencies.${income.frequency}`)} · ${t('nextOn', {
      date: formatPlainDate(income.nextExpectedDate, locale),
    })}`,
    amount: formatMoney(income.amount, { locale: context.moneyLocale }),
    badges: [
      ...(income.isApproximate
        ? [{ label: t('badges.approximate'), tone: 'caution' as const }]
        : []),
      ...(income.isActive ? [] : [{ label: t('badges.inactive'), tone: 'neutral' as const }]),
    ],
    muted: !income.isActive,
    values: {
      name: income.name,
      amount: income.amount.toDecimalString(),
      frequency: income.frequency,
      nextExpectedDate: income.nextExpectedDate,
      isApproximate: String(income.isApproximate),
    },
  }));

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {active.length > 0 && (
        <Card>
          <Stat label={t('summary.monthly')} detail={t('summary.monthlyDetail')}>
            {formatMoney(monthly, { locale: context.moneyLocale })}
          </Stat>
        </Card>
      )}

      <Section title={t('list.title')} detail={t('list.detail')} className="mt-12">
        <Card>
          <RecordsManager
            locale={locale}
            currencySymbol={context.currencySymbol}
            rows={rows}
            fields={fields}
            create={createIncome}
            update={updateIncome}
            remove={removeIncome}
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
