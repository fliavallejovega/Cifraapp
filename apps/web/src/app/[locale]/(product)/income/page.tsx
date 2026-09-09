import { formatMoney, Money } from '@app/domain';
import { Card, Page, PageHeader, Section, Stat } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { IncomeFloorPanel } from '@/components/income-floor-panel';
import { RecordsManager } from '@/components/records';
import type { FieldSpec, RecordRow } from '@/components/records/spec';
import { createIncome, removeIncome, updateIncome } from '@/server/income-actions';
import { loadHouseholdContext } from '@/server/household-context';
import { recordLabels } from '@/server/record-labels';
import { ReceivableMatches } from '@/components/receivable-matches';
import { loadAccounts } from '@/server/repositories/accounts';
import { loadIncomes } from '@/server/repositories/administration';
import { loadIncomeFloor } from '@/server/repositories/income-floor';
import { loadMatchCandidates, loadReceivables } from '@/server/repositories/receivables';
import {
  confirmReceivableMatch,
  createReceivable,
  removeReceivable,
  updateReceivable,
} from '@/server/receivable-actions';
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
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const [incomes, receivables, candidates, floorView, accountsView] = await Promise.all([
    loadIncomes(session, session.activeHouseholdId, context.currency),
    loadReceivables(session, session.activeHouseholdId, context.currency),
    loadMatchCandidates(session, session.activeHouseholdId, context.currency, context.today),
    loadIncomeFloor(session, session.activeHouseholdId),
    loadAccounts(session, session.activeHouseholdId, context.currency),
  ]);

  const pending = receivables.filter((entry) => entry.receivedOn === null);
  const expectedTotal = Money.sum(
    pending.map((entry) => entry.amount),
    context.currency,
  );

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
    // La pregunta que decide una cifra: lo que escribiste, ¿ya viene con los
    // descuentos de planilla quitados? Pre-seleccionada en «neto» porque es lo
    // que casi todo el mundo lee de su banco.
    {
      kind: 'select',
      name: 'statedBasis',
      label: t('form.basis'),
      hint: t('form.basisHint'),
      half: true,
      options: (['net', 'gross'] as const).map((value) => ({
        value,
        label: t(`bases.${value}`),
      })),
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
      ...(income.statedBasis === 'gross'
        ? [{ label: t('badges.gross'), tone: 'neutral' as const }]
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
      statedBasis: income.statedBasis,
    },
  }));

  const receivableFields: readonly FieldSpec[] = [
    { kind: 'text', name: 'name', label: t('expected.form.name'), required: true },
    {
      kind: 'text',
      name: 'source',
      label: t('expected.form.source'),
      hint: t('expected.form.sourceHint'),
    },
    { kind: 'money', name: 'amount', label: t('expected.form.amount'), required: true, half: true },
    {
      kind: 'select',
      name: 'confidence',
      label: t('expected.form.confidence'),
      hint: t('expected.form.confidenceHint'),
      half: true,
      options: (['confirmed', 'likely', 'estimated'] as const).map((value) => ({
        value,
        label: t(`expected.confidences.${value}`),
      })),
    },
    // Two dates and not one. «Entre el 1 y el 10» is what somebody who bills
    // actually knows, and forcing them to pick a day would make them invent it.
    {
      kind: 'date',
      name: 'expectedFrom',
      label: t('expected.form.from'),
      hint: t('expected.form.fromHint'),
      half: true,
    },
    {
      kind: 'date',
      name: 'expectedTo',
      label: t('expected.form.to'),
      hint: t('expected.form.toHint'),
      half: true,
    },
    { kind: 'note', name: 'notes', label: t('expected.form.notes') },
  ];

  const receivableRows: readonly RecordRow[] = receivables.map((entry) => ({
    id: entry.id,
    title: entry.name,
    subtitle: [
      entry.source,
      entry.expectedFrom && entry.expectedTo
        ? entry.expectedFrom === entry.expectedTo
          ? t('expected.onDate', { date: formatPlainDate(entry.expectedFrom, locale) })
          : t('expected.between', {
              from: formatPlainDate(entry.expectedFrom, locale),
              to: formatPlainDate(entry.expectedTo, locale),
            })
        : t('expected.noDate'),
    ]
      .filter(Boolean)
      .join(' · '),
    amount: formatMoney(entry.amount, { locale: context.moneyLocale }),
    badges: [
      {
        label: t(`expected.confidences.${entry.confidence}`),
        tone:
          entry.confidence === 'confirmed'
            ? ('positive' as const)
            : entry.confidence === 'likely'
              ? ('caution' as const)
              : ('neutral' as const),
      },
      ...(entry.receivedOn ? [{ label: t('expected.collected'), tone: 'positive' as const }] : []),
    ],
    muted: entry.receivedOn !== null,
    values: {
      name: entry.name,
      source: entry.source ?? '',
      amount: entry.amount.toDecimalString(),
      confidence: entry.confidence,
      expectedFrom: entry.expectedFrom ?? '',
      expectedTo: entry.expectedTo ?? '',
      notes: entry.notes ?? '',
    },
  }));

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {(active.length > 0 || pending.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {active.length > 0 && (
            <Card>
              <Stat label={t('summary.monthly')} detail={t('summary.monthlyDetail')}>
                {formatMoney(monthly, { locale: context.moneyLocale })}
              </Stat>
            </Card>
          )}
          {/* Deliberately beside the monthly figure and never added to it. They
              answer different questions: one is what comes in every month, the
              other is what is owed and has not. */}
          {pending.length > 0 && (
            <Card>
              <Stat label={t('summary.expected')} detail={t('summary.expectedDetail')}>
                {formatMoney(expectedTotal, { locale: context.moneyLocale })}
              </Stat>
            </Card>
          )}
        </div>
      )}

      {/* El piso va antes que la lista de cobros porque es lo que decide qué se
          puede comprometer. La lista dice qué viene; el piso dice contra cuánto
          se puede vivir, y esa es la pregunta que se hace primero. */}
      <Section title={t('floor.title')} detail={t('floor.detail')} className="mt-14">
        <IncomeFloorPanel
          view={floorView}
          locale={locale}
          moneyLocale={context.moneyLocale}
          currencySymbol={context.currencySymbol}
          accounts={accountsView.accounts
            .filter((account) => account.isLiquid && account.status === 'active')
            .map((account) => ({ id: account.id, name: account.name }))}
          labels={{
            floorLabel: t('floor.floorLabel'),
            floorMeasured: t('floor.measured'),
            floorDeclared: t('floor.declared'),
            floorUnknown: t('floor.unknown'),
            emptyTitle: t('floor.emptyTitle'),
            emptyBody: t('floor.emptyBody'),
            monthsObserved: raw(t, 'floor.monthsObserved'),
            monthsNeeded: raw(t, 'floor.monthsNeeded'),
            worst: t('floor.worst'),
            typical: t('floor.typical'),
            best: t('floor.best'),
            cushionLabel: t('floor.cushionLabel'),
            cushionTarget: raw(t, 'floor.cushionTarget'),
            cushionGauge: t('floor.cushionGauge'),
            cushionFunded: t('floor.cushionFunded'),
            cushionMissing: raw(t, 'floor.cushionMissing'),
            cushionShort: raw(t, 'floor.cushionShort'),
            noRetention: t('floor.noRetention'),
            retentionHolds: raw(t, 'floor.retentionHolds'),
            release: t('floor.release'),
            form: {
              floor: t('floor.form.floor'),
              floorHint: t('floor.form.floorHint'),
              percentile: t('floor.form.percentile'),
              percentileHint: t('floor.form.percentileHint'),
              months: t('floor.form.months'),
              monthsHint: t('floor.form.monthsHint'),
              account: t('floor.form.account'),
              accountHint: t('floor.form.accountHint'),
              accountNone: t('floor.form.accountNone'),
              submit: t('floor.form.submit'),
              saved: t('floor.form.saved'),
              errorTitle: shared('errorTitle'),
              errors: {
                generic: shared('errors.generic'),
                notFound: shared('errors.notFound'),
                signInRequired: shared('errors.signInRequired'),
                amountInvalid: t('floor.errors.amountInvalid'),
                percentileInvalid: t('floor.errors.percentileInvalid'),
                monthsInvalid: t('floor.errors.monthsInvalid'),
              },
            },
          }}
        />
      </Section>

      <Section title={t('expected.title')} detail={t('expected.detail')} className="mt-14">
        <Card>
          <RecordsManager
            locale={locale}
            currencySymbol={context.currencySymbol}
            rows={receivableRows}
            fields={receivableFields}
            create={createReceivable}
            update={updateReceivable}
            remove={removeReceivable}
            labels={recordLabels(shared, {
              addAction: t('expected.add'),
              addTitle: t('expected.addTitle'),
              submitCreate: t('expected.submitCreate'),
              submitUpdate: t('expected.submitUpdate'),
              emptyTitle: t('expected.emptyTitle'),
              emptyBody: t('expected.emptyBody'),
              removeConfirm: t('expected.removeConfirm'),
            })}
          />
        </Card>

        {/* Said under the list rather than in a tooltip, because it is the one
            thing a household most wants to be untrue: expected money is not
            spendable money, however certain it is. */}
        <p className="mt-4 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {t('expected.note')}
        </p>
      </Section>

      <Section title={t('reconcile.title')} detail={t('reconcile.detail')} className="mt-14">
        <ReceivableMatches
          locale={locale}
          confirm={confirmReceivableMatch}
          candidates={candidates.map((candidate) => ({
            receivableId: candidate.receivableId,
            receivableName: candidate.receivableName,
            transactionId: candidate.transactionId,
            date: formatPlainDate(candidate.date, locale),
            amount: formatMoney(candidate.amount, { locale: context.moneyLocale }),
            description: candidate.description,
            accountName: candidate.accountName,
            reasons: [...candidate.reasons],
          }))}
          labels={{
            title: t('reconcile.found'),
            detail: t('reconcile.foundDetail'),
            confirm: t('reconcile.confirm'),
            emptyTitle: t('reconcile.emptyTitle'),
            emptyBody: t('reconcile.emptyBody'),
            reasons: {
              amount_exact: t('reconcile.reasons.amountExact'),
              amount_close: t('reconcile.reasons.amountClose'),
              window_inside: t('reconcile.reasons.windowInside'),
              window_near: t('reconcile.reasons.windowNear'),
              no_window: t('reconcile.reasons.noWindow'),
              name_match: t('reconcile.reasons.nameMatch'),
            },
            errorTitle: shared('errorTitle'),
            errors: {
              generic: shared('errors.generic'),
              notFound: shared('errors.notFound'),
              alreadyMatched: t('reconcile.errors.alreadyMatched'),
            },
          }}
        />
      </Section>

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

/**
 * Un mensaje con marcadores que se rellenan donde están los valores.
 *
 * `t()` intentaría resolverlos aquí y fallaría; la plantilla tiene que viajar
 * entera hasta quien tiene el número.
 */
function raw(t: { raw: (key: string) => unknown }, key: string): string {
  const value = t.raw(key);
  return typeof value === 'string' ? value : '';
}
