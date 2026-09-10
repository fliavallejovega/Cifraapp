import { formatMoney, Money } from '@app/domain';
import { Card, Page, PageHeader, Section, Stat } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RecordsManager } from '@/components/records';
import type { FieldSpec, RecordRow } from '@/components/records/spec';
import { backDebtWithAccount, createDebt, removeDebt, updateDebt } from '@/server/debt-actions';
import { loadHouseholdContext } from '@/server/household-context';
import { recordLabels } from '@/server/record-labels';
import { loadDebts, loadPeople } from '@/server/repositories/administration';
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
  const [debts, people] = await Promise.all([
    loadDebts(session, session.activeHouseholdId, context.currency),
    loadPeople(session, session.activeHouseholdId),
  ]);

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

  /**
   * Los tipos que se pagan en cuotas, y el que da vueltas.
   *
   * La forma decide qué preguntar. Una tarjeta tiene cupo y no termina; una
   * hipoteca no tiene cupo y sí tiene final. Enseñar los dos juegos de campos a
   * la vez le pide a cada una algo que por diseño no puede contestar, y un campo
   * vacío al lado de uno lleno se lee como un dato que falta.
   */
  const INSTALMENT_KINDS = [
    'auto_loan',
    'mortgage',
    'personal_loan',
    'student_loan',
    'informal',
    'other',
  ] as const;

  const fields: readonly FieldSpec[] = [
    { kind: 'text', name: 'name', label: t('form.name'), hint: t('form.nameHint'), required: true },
    // La clase va arriba porque decide el resto del formulario. Preguntarla al
    // final obligaría a volver a mirar campos que ya se contestaron.
    {
      kind: 'select',
      name: 'kind',
      label: t('form.kind'),
      hint: t('form.kindHint'),
      half: true,
      options: (
        [
          'credit_card',
          'auto_loan',
          'mortgage',
          'personal_loan',
          'student_loan',
          'other',
          'informal',
        ] as const
      ).map((value) => ({ value, label: t(`kinds.${value}`) })),
    },
    {
      kind: 'select',
      name: 'personId',
      label: t('form.person'),
      hint: t('form.personHint'),
      half: true,
      options: [
        { value: '', label: t('form.personHousehold') },
        ...people.map((person) => ({ value: person.id, label: person.displayName })),
      ],
    },
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

    // ── Sólo tarjeta ──────────────────────────────────────────────────────────
    {
      kind: 'money',
      name: 'creditLimit',
      label: t('form.limit'),
      hint: t('form.limitHint'),
      half: true,
      showWhen: { field: 'kind', is: ['credit_card'] },
    },
    {
      kind: 'text',
      name: 'maskedNumber',
      label: t('form.mask'),
      hint: t('form.maskHint'),
      maxLength: 4,
      placeholder: '0000',
      half: true,
      showWhen: { field: 'kind', is: ['credit_card'] },
    },
    {
      kind: 'integer',
      name: 'statementDay',
      label: t('form.statementDay'),
      hint: t('form.statementDayHint'),
      min: 1,
      max: 31,
      half: true,
      showWhen: { field: 'kind', is: ['credit_card'] },
    },
    {
      kind: 'integer',
      name: 'dueDay',
      label: t('form.dueDay'),
      hint: t('form.dueDayHint'),
      min: 1,
      max: 31,
      half: true,
      showWhen: { field: 'kind', is: ['credit_card'] },
    },

    // ── Sólo lo que se paga en cuotas ─────────────────────────────────────────
    {
      kind: 'integer',
      name: 'instalmentDay',
      label: t('form.instalmentDay'),
      hint: t('form.instalmentDayHint'),
      min: 1,
      max: 31,
      half: true,
      showWhen: { field: 'kind', is: INSTALMENT_KINDS },
    },
    {
      kind: 'integer',
      name: 'termMonths',
      label: t('form.termMonths'),
      hint: t('form.termMonthsHint'),
      min: 1,
      max: 600,
      half: true,
      showWhen: { field: 'kind', is: INSTALMENT_KINDS },
    },
    {
      kind: 'integer',
      name: 'paidMonths',
      label: t('form.paidMonths'),
      hint: t('form.paidMonthsHint'),
      min: 0,
      max: 600,
      half: true,
      showWhen: { field: 'kind', is: INSTALMENT_KINDS },
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
    // «Se lleva como cuenta» era plomería contada en voz alta: que una tarjeta
    // tenga cuenta detrás es cómo funciona el producto, no una noticia sobre la
    // deuda de alguien. Quien mira esta lista quiere saber cuánto debe y a qué
    // tasa; de quién es la deuda sí importa, porque decide quién la paga.
    badges: debt.personName ? [{ label: debt.personName, tone: 'neutral' as const }] : [],
    // Offered only while there is nothing carrying it yet. A debt already
    // backed by an account must not be able to open a second one holding the
    // same money.
    action: debt.accountId ? undefined : { label: t('carry'), intent: 'carry' },
    values: {
      name: debt.name,
      currentBalance: debt.currentBalance.toDecimalString(),
      apr: trimRate(debt.apr),
      minimumPayment: debt.minimumPayment.toDecimalString(),
      creditLimit: debt.creditLimit?.toDecimalString() ?? '',
      maskedNumber: debt.maskedNumber ?? '',
      dueDay: debt.dueDay === null ? '' : String(debt.dueDay),
      statementDay: debt.statementDay === null ? '' : String(debt.statementDay),
      instalmentDay: debt.instalmentDay === null ? '' : String(debt.instalmentDay),
      termMonths: debt.termMonths === null ? '' : String(debt.termMonths),
      paidMonths: debt.paidMonths === null ? '' : String(debt.paidMonths),
      kind: debt.kind,
      personId: debt.personId ?? '',
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
            rowAction={backDebtWithAccount}
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
