import { Card, Page, PageHeader, Section } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { formatPlainDate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadReport } from '@/server/repositories/reports';
import { requireHousehold } from '@/server/session';

/**
 * The same figures, in whatever format the reader needs.
 *
 * Four formats, and each exists for a different reader. CSV opens anywhere.
 * Excel carries the types, which is what an accountant asks for — a decimal
 * that a spreadsheet reads as text sums to zero, and nobody finds out until the
 * column is wrong. PDF is what gets forwarded to a bank or a landlord. JSON is
 * for another system.
 *
 * These are plain links rather than buttons behind an action, because a
 * download is a navigation: the browser handles it, the response streams, and
 * nothing is written to storage on the way out.
 */

const KINDS = ['transactions', 'income'] as const;
const FORMATS = ['csv', 'xlsx', 'pdf', 'json'] as const;

export default async function ExportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  await loadHouseholdContext(session, session.activeHouseholdId, locale);
  const report = await loadReport(session, session.activeHouseholdId);

  const t = await getTranslations('exports');

  return (
    <Page>
      <PageHeader
        title={t('title')}
        detail={t('period', {
          start: formatPlainDate(report.period.start, locale),
          end: formatPlainDate(report.period.end, locale),
        })}
      />

      <p className="mb-8 max-w-[62ch] text-pretty text-[color:var(--color-ink-secondary)]">
        {t('detail')}
      </p>

      {KINDS.map((kind) => (
        <Section
          key={kind}
          title={t(`kinds.${kind}`)}
          detail={t(`kinds.${kind}Detail`)}
          className="mt-12 first:mt-0"
        >
          <ul className="grid gap-4 sm:grid-cols-2">
            {FORMATS.map((format) => (
              <li key={format}>
                <Card>
                  <div className="flex flex-col gap-2">
                    <span className="font-medium text-[color:var(--color-ink)]">
                      {t(`formats.${format}`)}
                    </span>
                    <span className="text-sm text-pretty text-[color:var(--color-ink-secondary)]">
                      {t(`formats.${format}Detail`)}
                    </span>
                    {/* A plain anchor, not a Link: this leaves the router and
                        the app entirely, and the browser owns what happens. */}
                    <a
                      href={`/api/reports/export?kind=${kind}&format=${format}`}
                      className="mt-2 self-start text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-brand)]"
                    >
                      {t('download')}
                    </a>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      ))}

      <p className="mt-12 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {t('note')}
      </p>
    </Page>
  );
}
