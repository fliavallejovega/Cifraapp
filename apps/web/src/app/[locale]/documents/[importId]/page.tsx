import { formatMoney, type CurrencyCode } from '@app/domain';
import { Page, PageHeader } from '@app/ui';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { AppNav } from '@/components/app-nav';
import { ImportReview, type ReviewRow } from '@/components/import-review';
import { Link } from '@/i18n/navigation';
import { loadImportReview } from '@/server/repositories/import-review';
import { requireHousehold } from '@/server/session';

/**
 * One import, line by line.
 *
 * The screen the pipeline was built for and never got. Everything before it —
 * hashing, parsing, fingerprinting, duplicate assessment — produced rows with
 * verdicts that nothing read, so the importer could take a file and never
 * produce a movement.
 */
export default async function ImportReviewPage({
  params,
}: {
  params: Promise<{ locale: string; importId: string }>;
}) {
  const { locale, importId } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const household = session.households.find((entry) => entry.id === session.activeHouseholdId);
  const currency = (household?.baseCurrency.trim() ?? 'USD') as CurrencyCode;

  const review = await loadImportReview(session, session.activeHouseholdId, importId, currency);
  if (!review) notFound();

  const t = await getTranslations('documents');
  const raw = rawOf(t);
  const format = await getFormatter();
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';

  const rows: ReviewRow[] = review.rows.map((row) => ({
    id: row.id,
    date: row.date ?? '—',
    description:
      row.description !== ''
        ? row.description
        : (row.raw ?? t('review.unreadableLine', { line: row.lineNumber ?? 0 })),
    amount: row.amount === null ? '—' : formatMoney(row.amount, { locale: moneyLocale }),
    isNegative: row.amount?.isNegative() ?? false,
    verdict: row.verdict,
    signals: row.signals,
    rejectionReason: row.rejectionReason,
    alreadyFiled: row.createdTransactionId !== null,
  }));

  return (
    <Page>
      <AppNav locale={locale} householdName={household?.name ?? ''} />

      <PageHeader
        title={review.fileName}
        detail={t('review.detail', {
          account: review.accountName ?? '—',
          when: format.dateTime(review.startedAt, { dateStyle: 'medium' }),
        })}
        actions={
          <Link href="/documents" className="text-sm underline underline-offset-4">
            {t('review.back')}
          </Link>
        }
      />

      <p className="tabular mb-8 text-sm text-[color:var(--color-ink-secondary)]">
        {t('review.counts', {
          new: review.counts.new,
          duplicate: review.counts.duplicate,
          review: review.counts.review,
          rejected: review.counts.rejected,
        })}
      </p>

      <ImportReview
        locale={locale}
        importId={review.id}
        rows={rows}
        labels={{
          selectAll: t('review.selectAll'),
          clearAll: t('review.clearAll'),
          confirm: raw('review.confirm'),
          confirmOne: t('review.confirmOne'),
          nothingSelected: t('review.nothingSelected'),
          discard: t('review.discard'),
          discardConfirm: t('review.discardConfirm'),
          discardConfirmYes: t('review.discardConfirmYes'),
          cancel: t('review.cancel'),
          filed: raw('review.filed'),
          alreadyFiled: t('review.alreadyFiled'),
          settled: t('review.settled'),
          columnDate: t('history.columns.when'),
          columnDescription: t('review.columnDescription'),
          columnAmount: t('history.columns.found'),
          verdicts: {
            new: t('review.verdicts.new'),
            duplicate: t('review.verdicts.duplicate'),
            review: t('review.verdicts.review'),
            rejected: t('review.verdicts.rejected'),
          },
          verdictHints: {
            new: t('review.hints.new'),
            duplicate: t('review.hints.duplicate'),
            review: t('review.hints.review'),
            rejected: t('review.hints.rejected'),
          },
          signalLabel: t('review.signalLabel'),
          errorTitle: t('review.errorTitle'),
          errors: {
            notFound: t('review.errors.notFound'),
            nothingSelected: t('review.errors.nothingSelected'),
            nothingFiled: t('review.errors.nothingFiled'),
            signInRequired: t('review.errors.signInRequired'),
            generic: t('review.errors.generic'),
          },
        }}
      />

      <p className="mt-12 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {t('review.scopeNote')}
      </p>
    </Page>
  );
}

/**
 * A message that carries placeholders filled in the browser, where the value is
 * client state the server never had — a selection count, a running total.
 * `t()` would try to resolve them here and throw; the template has to travel
 * whole.
 */
function rawOf(t: { raw: (key: string) => unknown }): (key: string) => string {
  return (key) => {
    const value = t.raw(key);
    return typeof value === 'string' ? value : '';
  };
}
