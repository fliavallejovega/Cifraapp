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
  Stat,
  Status,
} from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { BudgetLines } from '@/components/budget-lines';
import { RecordForm } from '@/components/records';
import type { FieldSpec } from '@/components/records/spec';
import { Link } from '@/i18n/navigation';
import { clampedPercent, formatPlainDate } from '@/lib/format';
import { createBudget, updateBudget } from '@/server/budget-actions';
import { loadHouseholdContext } from '@/server/household-context';
import { recordLabels } from '@/server/record-labels';
import { loadCategories } from '@/server/repositories/administration';
import { loadBudget } from '@/server/repositories/budgets';
import { requireHousehold } from '@/server/session';

/**
 * One budget, line by line.
 *
 * The «left» column is the figure worth arguing about, and it is not planned
 * minus spent. It also subtracts what is committed and unpaid inside the
 * period — a household that has spent $300 of a $500 grocery line with the
 * school fee still to come is not $200 clear, and a budget screen that says so
 * is worse than no budget screen at all.
 *
 * The daily bars are there because a total hides the shape. «$480 of $500» is a
 * different month depending on whether it went out evenly or in one weekend.
 */
export default async function BudgetPage({
  params,
}: {
  params: Promise<{ locale: string; budgetId: string }>;
}) {
  const { locale, budgetId } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const budget = await loadBudget(
    session,
    session.activeHouseholdId,
    budgetId,
    context.currency,
    context.today,
  );

  const t = await getTranslations('budget');
  const listT = await getTranslations('budgets');
  const shared = await getTranslations('records');
  const errors: unknown = shared.raw('errors');

  if (!budget) {
    return (
      <Page>
        <PageHeader title={t('title')} />
        <Card>
          <EmptyState
            title={t('notFound.title')}
            body={t('notFound.body')}
            action={
              <Link
                href="/budgets"
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

  const categories = await loadCategories(session, session.activeHouseholdId);
  const peak = budget.dailySpend.reduce(
    (highest, day) => (day.amount.greaterThan(highest) ? day.amount : highest),
    budget.dailySpend[0]?.amount ?? budget.state.spent,
  );

  const fields: readonly FieldSpec[] = [
    { kind: 'text', name: 'name', label: listT('form.name'), required: true },
    {
      kind: 'select',
      name: 'period',
      label: listT('form.period'),
      half: true,
      options: (['monthly', 'weekly', 'annual', 'sinking'] as const).map((value) => ({
        value,
        label: listT(`periods.${value}`),
      })),
    },
    { kind: 'date', name: 'startsOn', label: listT('form.starts'), half: true },
    {
      kind: 'date',
      name: 'endsOn',
      label: listT('form.ends'),
      hint: listT('form.endsHint'),
      half: true,
    },
  ];

  return (
    <Page>
      <div className="mb-6">
        <Link
          href="/budgets"
          className="text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)] hover:decoration-[color:var(--color-brand)]"
        >
          {t('back')}
        </Link>
      </div>

      <PageHeader
        title={budget.name}
        detail={t('pace', {
          elapsed: budget.state.elapsedDays,
          total: budget.state.periodDays,
        })}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label={t('stats.planned')}>
            {formatMoney(budget.state.planned, { locale: context.moneyLocale })}
          </Stat>
        </Card>
        <Card>
          <Stat label={t('stats.spent')}>
            {formatMoney(budget.state.spent, { locale: context.moneyLocale })}
          </Stat>
        </Card>
        <Card>
          <Stat label={t('stats.committed')} detail={t('stats.committedDetail')}>
            {formatMoney(budget.state.committed, { locale: context.moneyLocale })}
          </Stat>
        </Card>
        <Card tone={budget.state.isOverspent ? 'sunk' : 'surface'}>
          <Stat label={t('stats.remaining')}>
            {formatMoney(budget.state.remaining, { locale: context.moneyLocale })}
          </Stat>
        </Card>
      </div>

      <Section title={t('lines.title')} detail={t('lines.detail')} className="mt-12">
        {budget.lines.length === 0 ? (
          <Card>
            <EmptyState title={t('lines.empty.title')} body={t('lines.empty.body')} />
          </Card>
        ) : (
          <Card padding="none">
            <div className="overflow-x-auto px-5 sm:px-6">
              <Ledger caption={t('lines.title')}>
                <LedgerHead>
                  <LedgerColumn>{t('lines.category')}</LedgerColumn>
                  <LedgerColumn align="end">{t('lines.planned')}</LedgerColumn>
                  <LedgerColumn align="end">{t('lines.spent')}</LedgerColumn>
                  <LedgerColumn align="end">{t('lines.remaining')}</LedgerColumn>
                  <LedgerColumn align="end">{t('lines.projected')}</LedgerColumn>
                </LedgerHead>
                <LedgerBody>
                  {budget.lines.map((line) => (
                    <LedgerRow key={line.id}>
                      <LedgerCell>
                        {line.categoryName ?? t('lines.noCategory')}
                        {line.isOverspent && (
                          <span className="ml-2">
                            <Status tone="negative">{t('lines.over')}</Status>
                          </span>
                        )}
                        {!line.isOverspent && line.isProjectedOver && (
                          <span className="ml-2">
                            <Status tone="caution">{t('lines.willBeOver')}</Status>
                          </span>
                        )}
                      </LedgerCell>
                      <LedgerCell align="end">
                        <Amount
                          value={line.planned}
                          locale={context.moneyLocale}
                          size="sm"
                          tone="plain"
                        />
                      </LedgerCell>
                      <LedgerCell align="end">
                        <Amount
                          value={line.spent}
                          locale={context.moneyLocale}
                          size="sm"
                          tone="plain"
                        />
                      </LedgerCell>
                      <LedgerCell align="end">
                        <Amount value={line.remaining} locale={context.moneyLocale} size="sm" />
                      </LedgerCell>
                      <LedgerCell align="end" secondary>
                        <Amount
                          value={line.projected}
                          locale={context.moneyLocale}
                          size="sm"
                          tone="plain"
                        />
                      </LedgerCell>
                    </LedgerRow>
                  ))}
                </LedgerBody>
              </Ledger>
            </div>
          </Card>
        )}

        <div className="mt-6">
          <Card>
            <BudgetLines
              locale={locale}
              budgetId={budget.id}
              currencySymbol={context.currencySymbol}
              lines={budget.lines.map((line) => ({
                id: line.id,
                categoryId: line.categoryId ?? '',
                planned: line.planned.toDecimalString(),
                categoryName: line.categoryName ?? t('lines.noCategory'),
              }))}
              categories={categories
                .filter((category) => !category.isArchived && category.kind === 'expense')
                .map((category) => ({
                  value: category.id,
                  label: `${'— '.repeat(category.depth)}${category.name}`,
                }))}
              labels={{
                category: t('lines.category'),
                planned: t('lines.planned'),
                add: t('lines.add'),
                addTitle: t('lines.addTitle'),
                save: t('lines.save'),
                remove: t('lines.remove'),
                removeConfirm: t('lines.removeConfirm'),
                cancel: shared('cancel'),
                edit: shared('edit'),
                noCategory: t('lines.noCategory'),
                errorTitle: shared('errorTitle'),
                errors: isStringRecord(errors) ? errors : {},
              }}
            />
          </Card>
        </div>
      </Section>

      {budget.dailySpend.length > 0 && (
        <Section title={t('shape.title')} detail={t('shape.detail')} className="mt-12">
          <Card>
            <ol className="flex items-end gap-1" aria-label={t('shape.title')}>
              {budget.dailySpend.map((day) => (
                <li
                  key={day.date}
                  className="flex-1"
                  title={`${formatPlainDate(day.date, locale)} · ${formatMoney(day.amount, {
                    locale: context.moneyLocale,
                  })}`}
                >
                  <span
                    className="block rounded-t-[2px] bg-[color:var(--color-brand)]"
                    style={{ height: `${String(Math.max(2, clampedPercent(day.amount, peak)))}px` }}
                  />
                </li>
              ))}
            </ol>
          </Card>
        </Section>
      )}

      <Section title={t('editTitle')} className="mt-12">
        <Card>
          <RecordForm
            locale={locale}
            fields={fields}
            currencySymbol={context.currencySymbol}
            create={createBudget}
            update={updateBudget}
            record={{
              id: budget.id,
              values: {
                name: budget.name,
                period: budget.period,
                startsOn: budget.startsOn,
                endsOn: budget.endsOn ?? '',
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

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}
