import { formatMoney } from '@app/domain';
import { Page, PageHeader, Section } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ReviewQueue, type QueueRow } from '@/components/review-queue';
import { Link } from '@/i18n/navigation';
import { formatPlainDate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadCategories } from '@/server/repositories/administration';
import { loadCategoryQueue } from '@/server/repositories/review';
import { resolveCategory } from '@/server/review-actions';
import { requireHousehold } from '@/server/session';

/**
 * What the engine guessed and would not commit to.
 *
 * The threshold is the point of this screen. Anything the classifier is
 * confident about is applied and never appears here; anything below it is
 * filed as «needs review» rather than applied quietly, because a guess wearing
 * the same clothes as a fact is how a budget stops meaning anything.
 *
 * Whatever a person picks becomes `user`-sourced with full confidence, and no
 * later automatic pass may overwrite it.
 */
export default async function CategoryReviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = await loadHouseholdContext(session, session.activeHouseholdId, locale);
  const [pending, categories] = await Promise.all([
    loadCategoryQueue(session, session.activeHouseholdId, context.currency),
    loadCategories(session, session.activeHouseholdId),
  ]);

  const t = await getTranslations('categoryReview');
  const movementsT = await getTranslations('movements');
  const shared = await getTranslations('records');
  const errors: unknown = shared.raw('errors');

  const options = [
    { value: '', label: movementsT('noCategory') },
    ...categories
      .filter((category) => !category.isArchived)
      .map((category) => ({
        value: category.id,
        label: `${'— '.repeat(category.depth)}${category.name}`,
      })),
  ];

  const rows: readonly QueueRow[] = pending.map((movement) => ({
    id: movement.id,
    title: movement.description,
    subtitle: `${formatPlainDate(movement.date, locale)} · ${movement.accountName}`,
    amount: formatMoney(
      movement.direction === 'outflow' ? movement.amount.negate() : movement.amount,
      { locale: context.moneyLocale },
    ),
    facts: [
      {
        label: movement.categoryName
          ? t('suggested', { category: movement.categoryName })
          : t('noSuggestion'),
        value:
          movement.confidence === null
            ? ''
            : t('confidence', { percent: Math.round(movement.confidence * 100) }),
      },
    ],
    select: {
      name: 'categoryId',
      value: movement.categoryId ?? '',
      label: t('field'),
      options,
    },
    choices: [{ value: 'accept', label: t('accept'), variant: 'primary' as const }],
  }));

  return (
    <Page>
      <div className="mb-6">
        <Link
          href="/review"
          className="text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)] hover:decoration-[color:var(--color-brand)]"
        >
          {t('back')}
        </Link>
      </div>

      <PageHeader title={t('title')} detail={t('detail')} />

      <Section>
        <ReviewQueue
          locale={locale}
          rows={rows}
          action={resolveCategory}
          decisionName="decision"
          labels={{
            emptyTitle: t('empty.title'),
            emptyBody: t('empty.body'),
            errorTitle: shared('errorTitle'),
            errors: isStringRecord(errors) ? errors : {},
          }}
        />
      </Section>

      {rows.length > 0 && (
        <p className="mt-8 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {t('acceptNote')}
        </p>
      )}
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
