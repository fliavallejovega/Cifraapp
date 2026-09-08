import { Card, Page, PageHeader, Section } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RecordsManager } from '@/components/records';
import type { FieldSpec, RecordRow } from '@/components/records/spec';
import { createCategory, removeCategory, updateCategory } from '@/server/category-actions';
import { loadHouseholdContext } from '@/server/household-context';
import { recordLabels } from '@/server/record-labels';
import { loadCategories } from '@/server/repositories/administration';
import { requireHousehold } from '@/server/session';

/**
 * The household's own vocabulary for where money goes.
 *
 * The tree ships seeded and, until now, sealed: no way to add «school bus», no
 * way to rename «Groceries» to what the household actually calls it. A category
 * system a person cannot shape is one they stop using, and every figure derived
 * from it is then a figure about nothing.
 *
 * Depth is shown by indentation rather than by nested lists, because the rows
 * are a flat set of things a person edits, and nesting the markup would make
 * the tenth child of the third parent a keyboard journey rather than a row.
 */
export default async function CategoriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = await loadHouseholdContext(session, session.activeHouseholdId, locale);
  const categories = await loadCategories(session, session.activeHouseholdId);

  const t = await getTranslations('categories');
  const shared = await getTranslations('records');

  // Only a top-level category can be a parent. Two levels is what the templates
  // ship and what a household can hold in its head; offering a third here would
  // invite a tree nobody can navigate on a phone.
  const parents = categories.filter(
    (category) => category.parentId === null && !category.isArchived,
  );

  const fields: readonly FieldSpec[] = [
    { kind: 'text', name: 'name', label: t('form.name'), hint: t('form.nameHint'), required: true },
    {
      kind: 'select',
      name: 'kind',
      label: t('form.kind'),
      hint: t('form.kindHint'),
      half: true,
      options: (['expense', 'income', 'transfer', 'investment'] as const).map((value) => ({
        value,
        label: t(`kinds.${value}`),
      })),
    },
    {
      kind: 'select',
      name: 'parentId',
      label: t('form.parent'),
      hint: t('form.parentHint'),
      half: true,
      options: [
        { value: '', label: t('form.noParent') },
        ...parents.map((parent) => ({ value: parent.id, label: parent.name })),
      ],
    },
  ];

  const rows: readonly RecordRow[] = categories.map((category) => ({
    id: category.id,
    // The indent is a non-breaking-space prefix rather than padding, so the
    // hierarchy survives a screen reader reading the list as text.
    title: `${'  '.repeat(category.depth)}${category.name}`,
    subtitle: [
      t(`kinds.${category.kind}`),
      category.transactionCount === 0
        ? t('usage.none')
        : t('usage.some', { count: category.transactionCount }),
    ].join(' · '),
    badges: [
      ...(category.isSystem ? [{ label: t('badges.system'), tone: 'neutral' as const }] : []),
      ...(category.isArchived ? [{ label: t('badges.archived'), tone: 'caution' as const }] : []),
    ],
    muted: category.isArchived,
    values: {
      name: category.name,
      kind: category.kind,
      parentId: category.parentId ?? '',
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
            create={createCategory}
            update={updateCategory}
            remove={removeCategory}
            labels={recordLabels(shared, {
              addAction: t('add'),
              addTitle: t('addTitle'),
              submitCreate: t('submitCreate'),
              submitUpdate: t('submitUpdate'),
              emptyTitle: t('empty.title'),
              emptyBody: t('empty.body'),
              removeConfirm: t('removeConfirm'),
              remove: t('removeAction'),
            })}
          />
        </Card>
      </Section>
    </Page>
  );
}
