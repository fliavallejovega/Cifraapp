import { formatMoney } from '@app/domain';
import { Page, PageHeader, Section } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ReviewQueue, type QueueRow } from '@/components/review-queue';
import { Link } from '@/i18n/navigation';
import { formatPlainDate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadTransferQueue } from '@/server/repositories/review';
import { resolveTransfer } from '@/server/review-actions';
import { requireHousehold } from '@/server/session';

/**
 * The transfer queue.
 *
 * Confirming one of these takes two movements out of both spending and income
 * at once, which is why it is asked rather than assumed. The card-payment case
 * carries its own explanation on the row: a $1,200 payment counted as an
 * expense double-counts, because the purchases behind the balance were already
 * counted when they happened — and that is not obvious to anyone who has not
 * thought about it for a living.
 */
export default async function TransfersReviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = await loadHouseholdContext(session, session.activeHouseholdId, locale);
  const candidates = await loadTransferQueue(session, session.activeHouseholdId, context.currency);

  const t = await getTranslations('transfersReview');
  const shared = await getTranslations('records');
  const errors: unknown = shared.raw('errors');

  const rows: readonly QueueRow[] = candidates.map((candidate) => ({
    id: candidate.id,
    title: `${candidate.from.accountName} → ${candidate.to.accountName}`,
    subtitle: t('confidence', { percent: Math.round(candidate.confidence * 100) }),
    amount: formatMoney(candidate.amount, { locale: context.moneyLocale }),
    badges: candidate.isCardPayment ? [{ label: t('cardPayment'), tone: 'signal' as const }] : [],
    facts: [
      {
        label: t('from'),
        value: `${formatPlainDate(candidate.from.date, locale)} · ${candidate.from.description}`,
      },
      {
        label: t('to'),
        value: `${formatPlainDate(candidate.to.date, locale)} · ${candidate.to.description}`,
      },
      ...(candidate.isCardPayment
        ? [{ label: t('cardPayment'), value: t('cardPaymentNote') }]
        : []),
    ],
    choices: [
      { value: 'confirm', label: t('confirm'), variant: 'primary' as const },
      { value: 'reject', label: t('reject'), variant: 'ghost' as const },
    ],
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
          action={resolveTransfer}
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
