import { Card, EmptyState, Page, PageHeader, Section } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { JobProgress } from '@/components/job-progress';
import { Link } from '@/i18n/navigation';
import { formatMoment } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadJob } from '@/server/repositories/jobs';
import { requireHousehold } from '@/server/session';

/**
 * A file being read.
 *
 * This screen exists because the import stopped happening inside the request.
 * That was the right change — parsing a PDF in a synchronous request is the one
 * thing the project rules forbid — and it created an obligation: a person who
 * hands over a file is owed an answer about what happened to it that is better
 * than a spinner and more specific than «processing».
 *
 * So the screen states the stage, the attempt, and, when it fails, a sentence
 * written for the household rather than a stack trace. And it says out loud
 * that they can leave, because the most common reason people sit staring at a
 * progress bar is that nobody told them they did not have to.
 */
export default async function ImportProcessingPage({
  params,
}: {
  params: Promise<{ locale: string; jobId: string }>;
}) {
  const { locale, jobId } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const job = await loadJob(session, session.activeHouseholdId, jobId);

  const t = await getTranslations('importJob');

  if (!job) {
    return (
      <Page>
        <PageHeader title={t('title')} />
        <Card>
          <EmptyState
            title={t('notFound.title')}
            body={t('notFound.body')}
            action={
              <Link
                href="/documents"
                className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
              >
                {t('notFound.action')}
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <div className="mb-6">
        <Link
          href="/documents"
          className="text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)] hover:decoration-[color:var(--color-brand)]"
        >
          {t('backToImports')}
        </Link>
      </div>

      <PageHeader
        title={job.fileName ?? t('title')}
        detail={t('startedAt', {
          moment: formatMoment(job.createdAt, locale, context.timeZone),
        })}
      />

      <Card padding="lg">
        <JobProgress
          job={job}
          reviewHref={(importId) => `/documents/${importId}`}
          labels={{
            stages: {
              reading: t('stages.reading'),
              parsing: t('stages.parsing'),
              matching: t('stages.matching'),
              ready: t('stages.ready'),
            },
            queued: t('queued'),
            running: t('running'),
            failedTitle: t('failedTitle'),
            retrying: rawOf(t)('retrying'),
            cancelled: t('cancelled'),
            succeeded: t('succeeded'),
            review: t('review'),
            leaveNote: t('leaveNote'),
            refresh: t('refresh'),
          }}
        />
      </Card>

      {job.counts && (
        <Section title={t('summary.title')} className="mt-12">
          <Card>
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <Count label={t('summary.found')} value={job.counts.found} />
              <Count label={t('summary.new')} value={job.counts.created} />
              <Count label={t('summary.duplicate')} value={job.counts.duplicate} />
              <Count label={t('summary.rejected')} value={job.counts.rejected} />
            </dl>
            {job.importId && (
              <p className="mt-6">
                <Link
                  href={`/documents/${job.importId}`}
                  className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
                >
                  {t('review')}
                </Link>
              </p>
            )}
          </Card>
        </Section>
      )}
    </Page>
  );
}

function Count({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div>
      <dt className="gradation-label text-[color:var(--color-ink-tertiary)] uppercase">{label}</dt>
      <dd className="readout mt-1 text-xl text-[color:var(--color-ink)] tabular-nums">{value}</dd>
    </div>
  );
}

/** A template whose placeholders are filled in the browser from live state. */
function rawOf(t: { raw: (key: string) => unknown }): (key: string) => string {
  return (key) => {
    const value = t.raw(key);
    return typeof value === 'string' ? value : '';
  };
}
