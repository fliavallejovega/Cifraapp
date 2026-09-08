'use server';

import { z } from 'zod';

import { cancelJob, runJobNow } from './jobs';
import { loadJob, type JobView } from './repositories/jobs';
import { revalidateFinancials } from './revalidate';
import { loadSession } from './session';

/**
 * What the progress screen calls while it waits.
 *
 * Polling rather than a socket, deliberately. The wait is measured in seconds,
 * happens once per uploaded file, and the alternative is a persistent
 * connection held open on a serverless platform for a job that is usually
 * already finished by the time the screen paints.
 *
 * Every poll also nudges the queue. On a platform where a killed invocation can
 * strand a job, a person sitting on the screen watching is the most reliable
 * worker available — and it costs one claim query that returns nothing when
 * there is nothing to do.
 */

export interface JobStatusResult {
  readonly job: JobView | null;
}

export async function readJobStatus(jobId: string): Promise<JobStatusResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { job: null };

  const id = z.uuid().safeParse(jobId);
  if (!id.success) return { job: null };

  const job = await loadJob(session, session.activeHouseholdId, id.data);

  if (job?.status === 'queued') {
    try {
      await runJobNow(job.id);
      return { job: await loadJob(session, session.activeHouseholdId, id.data) };
    } catch {
      // The cron runner remains the guarantee. A poll that could not run the
      // job still reports its status honestly.
    }
  }

  return { job };
}

export interface CancelJobResult {
  readonly error?: string;
  readonly ok?: true;
}

export async function cancelQueuedJob(
  _previous: CancelJobResult,
  formData: FormData,
): Promise<CancelJobResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const cancelled = await cancelJob(session, session.activeHouseholdId, id.data);
  if (!cancelled) return { error: 'alreadyStarted' };

  revalidateFinancials(formData);
  return { ok: true };
}
