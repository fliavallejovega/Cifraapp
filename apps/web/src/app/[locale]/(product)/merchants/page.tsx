import { formatMoney } from '@app/domain';
import { Card, Page, PageHeader, Section } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RecordsManager } from '@/components/records';
import type { FieldSpec, RecordRow } from '@/components/records/spec';
import { loadHouseholdContext } from '@/server/household-context';
import { recordLabels } from '@/server/record-labels';
import { loadCategories } from '@/server/repositories/administration';
import { loadMerchants } from '@/server/repositories/review';
import { createMerchant } from '@/server/merchant-actions';
import { removeMerchant, updateMerchant } from '@/server/review-actions';
import { requireHousehold } from '@/server/session';

/**
 * Where the money actually went.
 *
 * A statement says «SUPER 99 VIA ESPANA 0012» and «SUPER 99 CDE 4471»; a
 * household says «the supermarket». Merchants are what closes that gap, and
 * setting a category here once is what stops the same question being asked
 * thirty-four times.
 *
 * The count and the total on each row are the reason to open the screen at all.
 * «Super 99 · 34 movements · $1,204» is a fact about a household's life that
 * none of the other screens can state.
 */
export default async function MerchantsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const [merchants, categories] = await Promise.all([
    loadMerchants(session, session.activeHouseholdId, context.currency),
    loadCategories(session, session.activeHouseholdId),
  ]);

  const t = await getTranslations('merchants');
  const shared = await getTranslations('records');

  const fields: readonly FieldSpec[] = [
    { kind: 'text', name: 'name', label: t('form.name'), hint: t('form.nameHint'), required: true },
    {
      kind: 'select',
      name: 'defaultCategoryId',
      label: t('form.category'),
      hint: t('form.categoryHint'),
      options: [
        { value: '', label: t('noCategory') },
        ...categories
          .filter((category) => !category.isArchived)
          .map((category) => ({
            value: category.id,
            label: `${'— '.repeat(category.depth)}${category.name}`,
          })),
      ],
    },
  ];

  const rows: readonly RecordRow[] = merchants.map((merchant) => ({
    id: merchant.id,
    title: merchant.name,
    subtitle: [
      merchant.defaultCategoryName ?? t('noCategory'),
      merchant.transactionCount === 0
        ? t('row.none')
        : t('row.movements', { count: merchant.transactionCount }),
    ].join(' · '),
    ...(merchant.transactionCount === 0
      ? {}
      : { amount: formatMoney(merchant.total.abs(), { locale: context.moneyLocale }) }),
    values: {
      name: merchant.name,
      defaultCategoryId: merchant.defaultCategoryId ?? '',
    },
  }));

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      <Section title={t('list.title')} detail={t('list.detail')}>
        <Card>
          <RecordsManager
            locale={locale}
            currencySymbol={context.currencySymbol}
            rows={rows}
            fields={fields}
            create={createMerchant}
            update={updateMerchant}
            remove={removeMerchant}
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
