import { formatMoney } from '@app/domain';
import { Page, PageHeader, Section } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ReviewQueue, type QueueRow } from '@/components/review-queue';
import { Link } from '@/i18n/navigation';
import { formatPlainDate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadRecurringQueue } from '@/server/repositories/review';
import { resolveRecurring } from '@/server/review-actions';
import { requireHousehold } from '@/server/session';

/**
 * Patterns the engine found in a household's own movements.
 *
 * A detected series arrives inactive on purpose: an unconfirmed pattern must
 * not start subtracting from what a household believes it can spend. Confirming
 * is what turns it on, and the two confirm buttons are the same decision with
 * the one distinction that matters to the plan — essential claims are protected
 * before anything else.
 *
 * How many times it was seen and how much the amount wanders are both printed,
 * because «seen 3 times, varies 42%» and «seen 14 times, always the same» are
 * very different claims and the confidence number alone flattens them.
 */
export default async function RecurringReviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = await loadHouseholdContext(session, session.activeHouseholdId, locale);
  const detected = await loadRecurringQueue(session, session.activeHouseholdId, context.currency);

  const t = await getTranslations('recurringReview');
  const incomeT = await getTranslations('income');
  const shared = await getTranslations('records');
  const errors: unknown = shared.raw('errors');

  const rows: readonly QueueRow[] = detected.map((series) => ({
    id: series.id,
    title: series.name,
    subtitle: [
      incomeT(`frequencies.${series.frequency}`),
      t('next', { date: formatPlainDate(series.nextExpectedDate, locale) }),
    ].join(' · '),
    amount: formatMoney(series.expectedAmount, { locale: context.moneyLocale }),
    facts: [
      { label: t('seen', { count: series.occurrenceCount }), value: '' },
      {
        label:
          series.amountVariation === 0
            ? t('steady')
            : t('variation', { percent: Math.round(series.amountVariation * 100) }),
        value: '',
      },
      { label: t('confidence', { percent: Math.round(series.confidence * 100) }), value: '' },
      ...(series.categoryName ? [{ label: series.categoryName, value: '' }] : []),
    ],
    choices: [
      { value: 'confirm', label: t('confirm'), variant: 'primary' as const },
      { value: 'dismiss', label: t('dismiss'), variant: 'ghost' as const },
    ],
    extras: { isEssential: 'false' },
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
          action={resolveRecurring}
          decisionName="decision"
          labels={{
            emptyTitle: t('empty.title'),
            emptyBody: t('empty.body'),
            errorTitle: shared('errorTitle'),
            errors: isStringRecord(errors) ? errors : {},
          }}
        />
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
