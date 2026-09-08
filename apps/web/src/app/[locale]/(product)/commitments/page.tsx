import { formatMoney, Money } from '@app/domain';
import { Card, Page, PageHeader, Section, Stat } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RecordsManager } from '@/components/records';
import type { FieldSpec, RecordRow } from '@/components/records/spec';
import { formatPlainDate } from '@/lib/format';
import { createCommitment, removeCommitment, updateCommitment } from '@/server/commitment-actions';
import { loadHouseholdContext } from '@/server/household-context';
import { recordLabels } from '@/server/record-labels';
import { loadCategories, loadCommitments } from '@/server/repositories/administration';
import { requireHousehold } from '@/server/session';

/**
 * What already has an owner.
 *
 * This is the screen that makes «available» mean something. A balance of $4,350
 * with $1,610 of rent, school and utilities already promised is not $4,350, and
 * the gap between those two figures is the entire argument of the product.
 *
 * Two totals, not one: everything committed, and how much of that is
 * essential. A household under pressure needs to know which part of the claim
 * can move and which part cannot, and one number cannot say that.
 */
export default async function CommitmentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = await loadHouseholdContext(session, session.activeHouseholdId, locale);
  const [commitments, categories] = await Promise.all([
    loadCommitments(session, session.activeHouseholdId, context.currency),
    loadCategories(session, session.activeHouseholdId),
  ]);

  const t = await getTranslations('commitments');
  const shared = await getTranslations('records');

  const open = commitments.filter((commitment) => !commitment.isSettled);
  const total = Money.sum(
    open.map((entry) => entry.expectedAmount),
    context.currency,
  );
  const essential = Money.sum(
    open.filter((entry) => entry.isEssential).map((entry) => entry.expectedAmount),
    context.currency,
  );

  const expenseCategories = categories.filter(
    (category) => category.kind === 'expense' && !category.isArchived,
  );

  const fields: readonly FieldSpec[] = [
    { kind: 'text', name: 'name', label: t('form.name'), hint: t('form.nameHint'), required: true },
    { kind: 'money', name: 'expectedAmount', label: t('form.amount'), required: true, half: true },
    {
      kind: 'integer',
      name: 'dueDay',
      label: t('form.day'),
      hint: t('form.dayHint'),
      min: 1,
      max: 31,
      required: true,
      half: true,
    },
    {
      kind: 'select',
      name: 'frequency',
      label: t('form.frequency'),
      half: true,
      options: (['monthly', 'weekly', 'biweekly', 'quarterly', 'annual'] as const).map((value) => ({
        value,
        label: t(`frequencies.${value}`),
      })),
    },
    {
      kind: 'select',
      name: 'categoryId',
      label: t('form.category'),
      hint: t('form.categoryHint'),
      half: true,
      options: [
        { value: '', label: t('noCategory') },
        ...expenseCategories.map((category) => ({
          value: category.id,
          label: `${'— '.repeat(category.depth)}${category.name}`,
        })),
      ],
    },
    {
      kind: 'toggle',
      name: 'isEssential',
      label: t('form.essential'),
      toggleLabel: t('form.essential'),
      hint: t('form.essentialHint'),
    },
  ];

  const rows: readonly RecordRow[] = commitments.map((commitment) => {
    const overdue = commitment.dueDate < context.today && !commitment.isSettled;

    return {
      id: commitment.id,
      title: commitment.name,
      subtitle: overdue
        ? t('overdue', { date: formatPlainDate(commitment.dueDate, locale) })
        : t('dueOn', { date: formatPlainDate(commitment.dueDate, locale) }),
      amount: formatMoney(commitment.expectedAmount, { locale: context.moneyLocale }),
      badges: [
        ...(overdue ? [{ label: t('badges.overdue'), tone: 'negative' as const }] : []),
        ...(commitment.isEssential
          ? [{ label: t('badges.essential'), tone: 'caution' as const }]
          : []),
        ...(commitment.isSettled
          ? [{ label: t('badges.settled'), tone: 'positive' as const }]
          : []),
      ],
      muted: commitment.isSettled,
      values: {
        name: commitment.name,
        expectedAmount: commitment.expectedAmount.toDecimalString(),
        dueDay: String(Number(commitment.dueDate.slice(8, 10))),
        frequency: commitment.frequency ?? 'monthly',
        categoryId: commitment.categoryId ?? '',
        isEssential: String(commitment.isEssential),
      },
    };
  });

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {open.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <Stat label={t('summary.total')} detail={t('summary.totalDetail')}>
              {formatMoney(total, { locale: context.moneyLocale })}
            </Stat>
          </Card>
          <Card>
            <Stat label={t('summary.essential')} detail={t('summary.essentialDetail')}>
              {formatMoney(essential, { locale: context.moneyLocale })}
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
            create={createCommitment}
            update={updateCommitment}
            remove={removeCommitment}
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
