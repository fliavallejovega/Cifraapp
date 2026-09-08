import { formatMoney, Money } from '@app/domain';
import { Card, EmptyState, Gauge, Page, PageHeader, Section, Stat, Status } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RecordForm } from '@/components/records';
import type { FieldSpec } from '@/components/records/spec';
import { Link } from '@/i18n/navigation';
import { formatPlainDate, percentOf } from '@/lib/format';
import { createGoal, updateGoal } from '@/server/goal-actions';
import { loadHouseholdContext } from '@/server/household-context';
import { recordLabels } from '@/server/record-labels';
import { loadGoal } from '@/server/repositories/administration';
import { requireHousehold } from '@/server/session';

/**
 * One goal, and the number that makes it a plan instead of a wish.
 *
 * «How much a month to arrive on time» is the whole screen. Without a target
 * date it cannot be computed, and the screen says so and offers to take one
 * rather than inventing a horizon and printing a figure derived from it.
 */
export default async function GoalPage({
  params,
}: {
  params: Promise<{ locale: string; goalId: string }>;
}) {
  const { locale, goalId } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = await loadHouseholdContext(session, session.activeHouseholdId, locale);
  const goal = await loadGoal(session, session.activeHouseholdId, goalId, context.currency);

  const t = await getTranslations('goal');
  const listT = await getTranslations('goals');
  const shared = await getTranslations('records');

  if (!goal) {
    return (
      <Page>
        <PageHeader title={t('title')} />
        <Card>
          <EmptyState
            title={t('notFound.title')}
            body={t('notFound.body')}
            action={
              <Link
                href="/goals"
                className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
              >
                {t('notFound.action')}
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  const missing = goal.targetAmount.subtract(goal.currentAmount);
  const reached = !missing.isPositive();
  const monthsLeft = goal.targetDate ? monthsBetween(context.today, goal.targetDate) : null;
  const overdue = monthsLeft !== null && monthsLeft <= 0 && !reached;
  const perMonth =
    monthsLeft !== null && monthsLeft > 0 && !reached ? missing.divide(monthsLeft) : null;

  const fields: readonly FieldSpec[] = [
    {
      kind: 'text',
      name: 'name',
      label: listT('form.name'),
      hint: listT('form.nameHint'),
      required: true,
    },
    {
      kind: 'money',
      name: 'targetAmount',
      label: listT('form.target'),
      required: true,
      half: true,
    },
    {
      kind: 'money',
      name: 'currentAmount',
      label: listT('form.saved'),
      hint: listT('form.savedHint'),
      required: true,
      half: true,
    },
    {
      kind: 'date',
      name: 'targetDate',
      label: listT('form.date'),
      hint: listT('form.dateHint'),
      half: true,
    },
    {
      kind: 'select',
      name: 'priority',
      label: listT('form.priority'),
      half: true,
      options: (['100', '200', '300'] as const).map((value) => ({
        value,
        label: listT(`priorities.${value}`),
      })),
    },
    {
      kind: 'select',
      name: 'status',
      label: listT('form.status'),
      half: true,
      options: (['active', 'reached', 'paused', 'abandoned'] as const).map((value) => ({
        value,
        label: listT(`statuses.${value}`),
      })),
    },
  ];

  return (
    <Page>
      <div className="mb-6">
        <Link
          href="/goals"
          className="text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)] hover:decoration-[color:var(--color-brand)]"
        >
          {t('backToList')}
        </Link>
      </div>

      <PageHeader
        title={goal.name}
        {...(goal.targetDate
          ? { detail: listT('row.by', { date: formatPlainDate(goal.targetDate, locale) }) }
          : {})}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label={t('stats.target')}>
            {formatMoney(goal.targetAmount, { locale: context.moneyLocale })}
          </Stat>
        </Card>
        <Card>
          <Stat label={t('stats.saved')}>
            {formatMoney(goal.currentAmount, { locale: context.moneyLocale })}
          </Stat>
        </Card>
        <Card>
          <Stat label={t('stats.missing')}>
            {formatMoney(reached ? Money.zero(context.currency) : missing, {
              locale: context.moneyLocale,
            })}
          </Stat>
        </Card>
        <Card>
          <Stat label={t('stats.monthly')} detail={t('stats.monthlyDetail')}>
            {perMonth === null ? '—' : formatMoney(perMonth, { locale: context.moneyLocale })}
          </Stat>
        </Card>
      </div>

      <Section title={t('progress.title')} className="mt-12">
        <Card>
          <div className="flex flex-col gap-4">
            <Gauge
              value={goal.currentAmount}
              max={goal.targetAmount}
              label={t('progress.label')}
              locale={context.moneyLocale}
            />
            <p className="text-sm text-[color:var(--color-ink-secondary)]">
              {t('progress.percent', {
                percent: percentOf(goal.currentAmount, goal.targetAmount),
              })}
            </p>
            {reached && <Status tone="positive">{t('progress.reached')}</Status>}
            {overdue && (
              <Status tone="negative">
                {t('progress.late', {
                  amount: formatMoney(missing, { locale: context.moneyLocale }),
                })}
              </Status>
            )}
            {goal.targetDate === null && !reached && (
              <Status tone="caution">{t('progress.noDate')}</Status>
            )}
          </div>
        </Card>
      </Section>

      <Section title={t('editTitle')} className="mt-12">
        <Card>
          <RecordForm
            locale={locale}
            fields={fields}
            currencySymbol={context.currencySymbol}
            create={createGoal}
            update={updateGoal}
            record={{
              id: goal.id,
              values: {
                name: goal.name,
                targetAmount: goal.targetAmount.toDecimalString(),
                currentAmount: goal.currentAmount.toDecimalString(),
                targetDate: goal.targetDate ?? '',
                priority: String(goal.priority),
                status: goal.status,
              },
            }}
            labels={recordLabels(shared, {
              addAction: listT('add'),
              addTitle: listT('addTitle'),
              submitCreate: listT('submitCreate'),
              submitUpdate: listT('submitUpdate'),
              emptyTitle: listT('empty.title'),
              emptyBody: listT('empty.body'),
              removeConfirm: listT('removeConfirm'),
            })}
          />
        </Card>
      </Section>
    </Page>
  );
}

/**
 * Whole months from one calendar date to another.
 *
 * Rounded down, and never negative in a way the caller has to guard: a target
 * eleven days away is zero months, which is what makes the screen say «the date
 * has passed» rather than dividing by a fraction and printing a figure nobody
 * could act on.
 */
function monthsBetween(from: string, to: string): number {
  const [fromYear = 0, fromMonth = 1] = from.split('-').map(Number);
  const [toYear = 0, toMonth = 1] = to.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}
