'use client';

import { Button, Problem, Status } from '@app/ui';
import { useEffect, useState } from 'react';

import { useRouter } from '@/i18n/navigation';
import { readJobStatus } from '@/server/job-actions';
import type { JobView } from '@/server/repositories/jobs';

/**
 * Watching a file being read.
 *
 * The bar is honest about what it knows: the worker reports at four points —
 * reading, parsing, matching, ready — and the bar shows those, rather than
 * animating smoothly toward a number nobody measured. A progress bar that
 * moves on a timer is a lie told at sixty frames a second.
 *
 * The poll slows down as the wait goes on. A statement that takes two seconds
 * is caught by the first poll; one that takes two minutes does not need forty
 * round trips to say so.
 */

const FIRST_INTERVAL_MS = 1_200;
const MAX_INTERVAL_MS = 8_000;

export interface JobProgressLabels {
  readonly stages: Readonly<Record<string, string>>;
  readonly queued: string;
  readonly running: string;
  readonly failedTitle: string;
  readonly retrying: string;
  readonly cancelled: string;
  readonly succeeded: string;
  readonly review: string;
  readonly leaveNote: string;
  readonly refresh: string;
}

export function JobProgress({
  job: initial,
  reviewHref,
  labels,
}: {
  readonly job: JobView;
  /** Where a finished import sends the person. */
  readonly reviewHref: (importId: string) => string;
  readonly labels: JobProgressLabels;
}) {
  const [job, setJob] = useState(initial);
  const router = useRouter();

  const settled =
    job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled';

  useEffect(() => {
    if (settled) return;

    let cancelled = false;
    let interval = FIRST_INTERVAL_MS;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async (): Promise<void> => {
      const result = await readJobStatus(job.id);
      if (cancelled) return;

      if (result.job) {
        setJob(result.job);
        if (result.job.status === 'succeeded' && result.job.importId) {
          // The rows are the point. Landing on «done» and making a person find
          // them would be the same failure the product already made once.
          router.push(reviewHref(result.job.importId));
          return;
        }
        if (
          result.job.status === 'succeeded' ||
          result.job.status === 'failed' ||
          result.job.status === 'cancelled'
        ) {
          router.refresh();
          return;
        }
      }

      interval = Math.min(Math.round(interval * 1.5), MAX_INTERVAL_MS);
      timer = setTimeout(() => void poll(), interval);
    };

    timer = setTimeout(() => void poll(), interval);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [job.id, settled, router, reviewHref]);

  if (job.status === 'failed') {
    return (
      <div className="flex flex-col gap-4">
        <Problem
          title={labels.failedTitle}
          body={job.errorMessage ?? ''}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                router.refresh();
              }}
            >
              {labels.refresh}
            </Button>
          }
        />
      </div>
    );
  }

  if (job.status === 'cancelled') {
    return <Status tone="neutral">{labels.cancelled}</Status>;
  }

  if (job.status === 'succeeded') {
    return <Status tone="positive">{labels.succeeded}</Status>;
  }

  const stage = job.progressNote ? (labels.stages[job.progressNote] ?? '') : '';

  return (
    <div className="flex flex-col gap-4">
      <div
        role="progressbar"
        aria-valuenow={job.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={job.status === 'queued' ? labels.queued : labels.running}
        className="h-2 w-full overflow-hidden rounded-full bg-[color:var(--color-ground-sunk)]"
      >
        <div
          className="h-full rounded-full bg-[color:var(--color-brand)] transition-[width] duration-(--duration-settle) ease-(--ease-settle)"
          style={{ width: `${String(Math.max(4, job.progress))}%` }}
        />
      </div>

      <p className="text-sm text-[color:var(--color-ink)]">
        {job.status === 'queued' ? labels.queued : stage || labels.running}
      </p>

      {job.attempts > 1 && (
        <Status tone="caution">
          {labels.retrying
            .replace('{attempt}', String(job.attempts))
            .replace('{max}', String(job.maxAttempts))}
        </Status>
      )}

      <p className="text-sm text-[color:var(--color-ink-secondary)]">{labels.leaveNote}</p>
    </div>
  );
}
