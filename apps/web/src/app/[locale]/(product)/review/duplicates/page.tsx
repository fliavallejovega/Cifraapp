import { formatMoney } from '@app/domain';
import { Page, PageHeader, Section } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ReviewQueue, type QueueRow } from '@/components/review-queue';
import { Link } from '@/i18n/navigation';
import { formatPlainDate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadDuplicateQueue, type DuplicateSideView } from '@/server/repositories/review';
import { resolveDuplicate } from '@/server/review-actions';
import { requireHousehold } from '@/server/session';

/**
 * The duplicate queue.
 *
 * The engine already reached a verdict and recorded the signals behind it; this
 * is the screen that finally shows them. Both sides are printed in full,
 * because «is this the same purchase?» is a question about two specific rows
 * and cannot be answered from a summary of either.
 */
export default async function DuplicatesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = await loadHouseholdContext(session, session.activeHouseholdId, locale);
  const candidates = await loadDuplicateQueue(session, session.activeHouseholdId, context.currency);

  const t = await getTranslations('duplicates');
  const shared = await getTranslations('records');
  const errors: unknown = shared.raw('errors');

  const describe = (side: DuplicateSideView): string =>
    `${formatPlainDate(side.date, locale)} · ${side.description} · ${side.accountName} · ${formatMoney(
      side.amount,
      { locale: context.moneyLocale },
    )}`;

  const rows: readonly QueueRow[] = candidates.map((candidate) => ({
    id: candidate.id,
    title: candidate.existing.description,
    subtitle: t('confidence', { percent: Math.round(candidate.confidence * 100) }),
    amount: formatMoney(candidate.existing.amount, { locale: context.moneyLocale }),
    facts: [
      { label: t('existing'), value: describe(candidate.existing) },
      ...(candidate.incoming
        ? [{ label: t('incoming'), value: describe(candidate.incoming) }]
        : []),
    ],
    // The signals the engine actually fired on, translated where the catalogue
    // knows the name and printed raw where it does not — an unknown signal
    // shown verbatim is more useful than one silently dropped.
    evidence: candidate.signals.map((signal) => signalLabel(signal, t)),
    choices: [
      { value: 'same', label: t('same'), variant: 'primary' as const },
      { value: 'different', label: t('different'), variant: 'ghost' as const },
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
          action={resolveDuplicate}
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
          {t('sameNote')}
        </p>
      )}
    </Page>
  );
}

function signalLabel(signal: string, t: (key: string) => string): string {
  try {
    return t(`signals.${signal}`);
  } catch {
    return signal;
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}
