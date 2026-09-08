import { accrueInterest, simulatePayoff } from '@app/debt-engine';
import { formatMoney, isOk, Money } from '@app/domain';
import { Card, EmptyState, Gauge, Page, PageHeader, Section, Stat } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RecordForm } from '@/components/records';
import type { FieldSpec } from '@/components/records/spec';
import { Link } from '@/i18n/navigation';
import { formatPlainDate, trimRate } from '@/lib/format';
import { createDebt, updateDebt } from '@/server/debt-actions';
import { loadHouseholdContext } from '@/server/household-context';
import { recordLabels } from '@/server/record-labels';
import { loadDebt } from '@/server/repositories/administration';
import { requireHousehold } from '@/server/session';

/** A month of interest, for a figure a person can act on today. */
const DAYS_IN_MONTH = 30;

/**
 * One debt, and the only two questions worth asking about it.
 *
 * What is it costing me this month, and when does it end. Both are computed by
 * the debt engine on today's balance and rate — no new charges assumed, because
 * assuming a spending pattern would make the date a forecast about the person
 * rather than a fact about the debt.
 *
 * «Never» is a real answer and is printed as one. A minimum payment that does
 * not cover the monthly interest never clears the balance, and a product that
 * rounded that up to «600 months» would be hiding the single most important
 * thing it knows about this account.
 */
export default async function DebtPage({
  params,
}: {
  params: Promise<{ locale: string; debtId: string }>;
}) {
  const { locale, debtId } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const debt = await loadDebt(session, session.activeHouseholdId, debtId, context.currency);

  const t = await getTranslations('debt');
  const listT = await getTranslations('debts');
  const shared = await getTranslations('records');

  if (!debt) {
    return (
      <Page>
        <PageHeader title={t('title')} />
        <Card>
          <EmptyState
            title={t('notFound.title')}
            body={t('notFound.body')}
            action={
              <Link
                href="/debts"
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

  const monthlyInterest = accrueInterest(debt.currentBalance, debt.apr, DAYS_IN_MONTH);
  const paid = debt.principal.subtract(debt.currentBalance);

  const simulation = simulatePayoff({
    debts: [
      {
        id: debt.id,
        name: debt.name,
        currentBalance: debt.currentBalance,
        apr: debt.apr,
        minimumPayment: debt.minimumPayment,
        creditLimit: debt.creditLimit,
      },
    ],
    strategy: 'avalanche',
    monthlyPayment: debt.minimumPayment,
    from: context.today,
  });

  const plan = isOk(simulation) ? simulation.value : null;
  // The engine returns a plan with no payoff date when the minimum never
  // clears the balance. That is the finding, not a failure.
  const clears = plan?.debtFreeOn ?? null;

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
      name: 'currentBalance',
      label: listT('form.balance'),
      hint: listT('form.balanceHint'),
      required: true,
      half: true,
    },
    {
      kind: 'rate',
      name: 'apr',
      label: listT('form.apr'),
      hint: listT('form.aprHint'),
      suffix: '%',
      required: true,
      half: true,
    },
    {
      kind: 'money',
      name: 'minimumPayment',
      label: listT('form.minimum'),
      required: true,
      half: true,
    },
    {
      kind: 'money',
      name: 'creditLimit',
      label: listT('form.limit'),
      hint: listT('form.limitHint'),
      half: true,
    },
    {
      kind: 'integer',
      name: 'dueDay',
      label: listT('form.dueDay'),
      hint: listT('form.dueDayHint'),
      min: 1,
      max: 31,
      half: true,
    },
    {
      kind: 'integer',
      name: 'statementDay',
      label: listT('form.statementDay'),
      min: 1,
      max: 31,
      half: true,
    },
  ];

  return (
    <Page>
      <div className="mb-6">
        <Link
          href="/debts"
          className="text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)] hover:decoration-[color:var(--color-brand)]"
        >
          {t('backToList')}
        </Link>
      </div>

      <PageHeader title={debt.name} detail={listT('row.apr', { apr: trimRate(debt.apr) })} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label={t('stats.balance')}>
            {formatMoney(debt.currentBalance, { locale: context.moneyLocale })}
          </Stat>
        </Card>
        <Card>
          <Stat label={t('stats.monthlyInterest')} detail={t('stats.monthlyInterestDetail')}>
            {formatMoney(monthlyInterest, { locale: context.moneyLocale })}
          </Stat>
        </Card>
        <Card>
          <Stat label={t('stats.minimum')}>
            {formatMoney(debt.minimumPayment, { locale: context.moneyLocale })}
          </Stat>
        </Card>
        <Card>
          <Stat label={t('stats.paid')} detail={t('stats.paidDetail')}>
            {formatMoney(paid.isPositive() ? paid : Money.zero(context.currency), {
              locale: context.moneyLocale,
            })}
          </Stat>
        </Card>
      </div>

      <Section title={t('payoff.title')} detail={t('payoff.detail')} className="mt-12">
        <Card>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[color:var(--color-ink-secondary)]">
              {t('payoff.atMinimum')}
            </p>
            <p className="readout text-2xl text-[color:var(--color-ink)]">
              {clears === null
                ? t('payoff.never')
                : t('payoff.months', { count: plan?.monthsToDebtFree ?? 0 })}
            </p>
            {clears !== null && (
              <>
                <p className="text-sm text-[color:var(--color-ink-secondary)]">
                  {t('payoff.freeOn', { date: formatPlainDate(clears, locale) })}
                </p>
                <p className="text-sm text-[color:var(--color-ink-secondary)]">
                  {t('payoff.interest', {
                    amount: formatMoney(plan?.totalInterest ?? Money.zero(context.currency), {
                      locale: context.moneyLocale,
                    }),
                  })}
                </p>
              </>
            )}
            <Link
              href="/debt-simulator"
              className="mt-2 self-start text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
            >
              {t('payoff.simulate')}
            </Link>
          </div>
        </Card>
      </Section>

      <Section title={t('usage.title')} detail={t('usage.detail')} className="mt-12">
        <Card>
          {debt.creditLimit?.isPositive() ? (
            <Gauge
              value={debt.currentBalance}
              max={debt.creditLimit}
              label={t('usage.title')}
              locale={context.moneyLocale}
              tone="caution"
            />
          ) : (
            <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('noLimit')}</p>
          )}
        </Card>
      </Section>

      <Section title={t('editTitle')} className="mt-12">
        <Card>
          <RecordForm
            locale={locale}
            fields={fields}
            currencySymbol={context.currencySymbol}
            create={createDebt}
            update={updateDebt}
            record={{
              id: debt.id,
              values: {
                name: debt.name,
                currentBalance: debt.currentBalance.toDecimalString(),
                apr: trimRate(debt.apr),
                minimumPayment: debt.minimumPayment.toDecimalString(),
                creditLimit: debt.creditLimit?.toDecimalString() ?? '',
                dueDay: debt.dueDay === null ? '' : String(debt.dueDay),
                statementDay: debt.statementDay === null ? '' : String(debt.statementDay),
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
