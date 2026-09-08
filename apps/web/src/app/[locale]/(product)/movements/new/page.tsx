import { Card, EmptyState, Page, PageHeader } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SingleForm } from '@/components/records';
import type { FieldSpec } from '@/components/records/spec';
import { Link } from '@/i18n/navigation';
import { loadHouseholdContext } from '@/server/household-context';
import { createManualMovement } from '@/server/movement-actions';
import { loadAccountOptions, loadCategories } from '@/server/repositories/administration';
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
 */
export default async function NewMovementPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const [accounts, categories] = await Promise.all([
    loadAccountOptions(session, session.activeHouseholdId),
    loadCategories(session, session.activeHouseholdId),
  ]);

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
    {
      kind: 'select',
      name: 'direction',
      label: t('direction'),
      half: true,
      options: [
        { value: 'outflow', label: t('outflow') },
        { value: 'inflow', label: t('inflow') },
      ],
    },
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
    { kind: 'note', name: 'notes', label: t('notes') },
  ];

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

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
            accountId: accounts[0]?.id ?? '',
            direction: 'outflow',
            categoryId: '',
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
