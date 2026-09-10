import { formatMoney } from '@app/domain';
import { Card, EmptyState, Page, PageHeader } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SingleForm } from '@/components/records';
import type { FieldSpec } from '@/components/records/spec';
import { Link } from '@/i18n/navigation';
import { loadHouseholdContext } from '@/server/household-context';
import { createManualMovement } from '@/server/movement-actions';
import { loadAccountOptions, loadCategories } from '@/server/repositories/administration';
import { loadDebtOptions } from '@/server/repositories/review-options';
import { requireHousehold } from '@/server/session';

/**
 * The movement no bank will ever send.
 *
 * Cash is where a household's figures quietly stop matching its life: the
 * taxi, the fonda, the twenty dollars lent to a neighbour. A product that only
 * knows what the bank knows reports less spending than actually happened, which
 * makes «available» generous in exactly the direction that hurts.
 *
 * Today is pre-filled, the account is pre-selected, and the direction defaults
 * to money going out — because the overwhelming majority of hand-recorded
 * movements are an expense that happened today. Everything a person is likely
 * to keep is already filled in.
 *
 * ## Y también es donde se registra un pago
 *
 * Un pago es un movimiento que además baja una deuda. No hay una segunda
 * pantalla para eso: sería la misma pantalla con un campo más y dos nombres
 * distintos para lo mismo, y alguien terminaría registrando el pago en la
 * equivocada. Se llega con la deuda ya elegida desde la tarjeta o la deuda que
 * se está mirando, o se elige aquí.
 */
export default async function NewMovementPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  /** `account` y `debt` llegan desde la tarjeta o la cuenta que se estaba mirando. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const [accounts, categories, debts] = await Promise.all([
    loadAccountOptions(session, session.activeHouseholdId),
    loadCategories(session, session.activeHouseholdId),
    loadDebtOptions(session, session.activeHouseholdId, context.currency),
  ]);

  /** Lo que venga en la dirección sólo cuenta si es del hogar. */
  const asked = (key: string) => {
    const value = query[key];
    return typeof value === 'string' ? value : '';
  };

  const preselectedAccount = accounts.some((one) => one.id === asked('account'))
    ? asked('account')
    : (accounts[0]?.id ?? '');

  const preselectedDebt = debts.some((one) => one.id === asked('debt')) ? asked('debt') : '';

  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';
  /*
    Un pago es un movimiento que además baja una deuda: la misma pantalla, no
    otra. Lo único que cambia es el encabezado —para que quien vino a registrar
    un pago sepa que llegó bien— y que el selector de deuda arranque abierto.
  */
  const isPayment = asked('kind') === 'payment' || preselectedDebt !== '';

  const t = await getTranslations('movementNew');
  const shared = await getTranslations('records');
  const errors: unknown = shared.raw('errors');

  if (accounts.length === 0) {
    return (
      <Page>
        <PageHeader title={t('title')} detail={t('detail')} />
        <Card>
          <EmptyState
            title={t('noAccounts.title')}
            body={t('noAccounts.body')}
            action={
              <Link
                href="/accounts"
                className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
              >
                {t('noAccounts.action')}
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  const expenseCategories = categories.filter((category) => !category.isArchived);

  const fields: readonly FieldSpec[] = [
    {
      kind: 'text',
      name: 'description',
      label: t('description'),
      hint: t('descriptionHint'),
      required: true,
      maxLength: 200,
    },
    { kind: 'money', name: 'amount', label: t('amount'), required: true, half: true },
    { kind: 'date', name: 'transactionDate', label: t('date'), required: true, half: true },
    {
      kind: 'select',
      name: 'accountId',
      label: t('account'),
      hint: t('accountHint'),
      required: true,
      half: true,
      options: accounts.map((account) => ({ value: account.id, label: account.name })),
    },
    /*
      La dirección, salvo cuando se vino a registrar un pago.

      Un pago hecho desde esta pantalla sale siempre de la cuenta que se elija:
      se le paga a Giovanni desde la cuenta de ahorros, o se le paga a la
      tarjeta desde la cuenta de ahorros. El caso contrario —plata entrando a la
      tarjeta— se anota en la tarjeta misma, donde así es como se piensa.

      Ofrecer la opción aquí sería pedirle a la casa que decida un signo
      contable para poder registrar algo que ya sabía qué era.
    */
    ...(isPayment
      ? []
      : [
          {
            kind: 'select' as const,
            name: 'direction',
            label: t('direction'),
            half: true,
            options: [
              { value: 'outflow', label: t('outflow') },
              { value: 'inflow', label: t('inflow') },
            ],
          },
        ]),
    {
      kind: 'select',
      name: 'categoryId',
      label: t('category'),
      hint: t('categoryHint'),
      options: [
        { value: '', label: t('noCategory') },
        ...expenseCategories.map((category) => ({
          value: category.id,
          label: `${'— '.repeat(category.depth)}${category.name}`,
        })),
      ],
    },
    /*
      La deuda que este movimiento paga, si paga alguna.

      Sólo aparece cuando el dinero sale: una entrada no baja una deuda — la
      sube, o es otra cosa. Y lleva el saldo al lado de cada nombre, porque
      elegir «Préstamo de Giovanni» sin ver que quedan $1,800 no deja juzgar si
      este pago de $500 tiene sentido ahí.
    */
    ...(debts.length > 0
      ? [
          {
            kind: 'select' as const,
            name: 'debtId',
            label: t('debt'),
            hint: t('debtHint'),
            required: isPayment,
            ...(isPayment ? {} : { showWhen: { field: 'direction', is: ['outflow'] as const } }),
            options: [
              { value: '', label: t('noDebt') },
              ...debts.map((debt) => ({
                value: debt.id,
                label: `${debt.name} — ${formatMoney(debt.outstanding, { locale: moneyLocale })}`,
              })),
            ],
          },
        ]
      : []),
    { kind: 'note', name: 'notes', label: t('notes') },
  ];

  return (
    <Page>
      <PageHeader
        title={isPayment ? t('paymentTitle') : t('title')}
        detail={isPayment ? t('paymentDetail') : t('detail')}
      />

      <Card>
        <SingleForm
          locale={locale}
          fields={fields}
          currencySymbol={context.currencySymbol}
          action={createManualMovement}
          values={{
            description: '',
            amount: '',
            transactionDate: context.today,
            accountId: preselectedAccount,
            direction: 'outflow',
            categoryId: '',
            debtId: preselectedDebt,
            notes: '',
          }}
          labels={{
            submit: t('submit'),
            // The action redirects to the new movement, so this never shows.
            // It is here because the contract requires it and a blank string
            // would trip the catalogue's no-empty-values test.
            saved: t('submit'),
            errorTitle: shared('errorTitle'),
            errors: isStringRecord(errors) ? errors : {},
          }}
        >
          <p className="max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {t('why')}
          </p>
        </SingleForm>
      </Card>
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
