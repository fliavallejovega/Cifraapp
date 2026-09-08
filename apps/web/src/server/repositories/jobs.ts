import 'server-only';

import { documents, imports, jobs } from '@app/database/schema';
import { and, desc, eq } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * What a background job is doing, as the household is allowed to see it.
 *
 * Read under RLS, like everything else on a screen. The worker writes these
 * rows with the admin handle; a member only ever reads them, and cancels one
 * that has not started.
 */

export interface JobView {
  readonly id: string;
  readonly kind: string;
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly progress: number;
  readonly progressNote: string | null;
  readonly errorMessage: string | null;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
  /** The file this job is about, when it is about a file. */
  readonly fileName: string | null;
  /** Set once the work produced an import worth reviewing. */
  readonly importId: string | null;
  readonly counts: {
    readonly found: number;
    readonly created: number;
    readonly duplicate: number;
    readonly review: number;
    readonly rejected: number;
  } | null;
}

export async function loadJob(
  session: Session,
  householdId: string,
  jobId: string,
): Promise<JobView | null> {
  return queryAsUser(session, async (tx) => {
    const [job] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.householdId, householdId)))
      .limit(1);

    if (!job) return null;

    const payload = job.payload as { documentId?: string };

    const [document] = payload.documentId
      ? await tx
          .select({ fileName: documents.fileName })
          .from(documents)
          .where(eq(documents.id, payload.documentId))
          .limit(1)
      : [];

    // The import is found through the job rather than through the result blob,
    // so a job whose result was never written still leads to its rows.
    const [run] = await tx
      .select({
        id: imports.id,
        found: imports.rowsFound,
        created: imports.rowsNew,
        duplicate: imports.rowsDuplicate,
        review: imports.rowsReview,
        rejected: imports.rowsRejected,
      })
      .from(imports)
      .where(and(eq(imports.jobId, job.id), eq(imports.householdId, householdId)))
      .limit(1);

    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      progress: job.progress,
      progressNote: job.progressNote,
      errorMessage: job.errorMessage,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      fileName: document?.fileName ?? null,
      importId: run?.id ?? null,
      counts: run
        ? {
            found: run.found,
            created: run.created,
            duplicate: run.duplicate,
            review: run.review,
            rejected: run.rejected,
          }
        : null,
    };
  });
}

/** Recent jobs, for the list beside the upload form. */
export async function loadRecentJobs(
  session: Session,
  householdId: string,
  limit = 5,
): Promise<readonly JobView[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.householdId, householdId))
      .orderBy(desc(jobs.createdAt))
      .limit(limit),
  );

  const views = await Promise.all(rows.map((row) => loadJob(session, householdId, row.id)));
  return views.filter((view): view is JobView => view !== null);
}

/** True when anything is still queued or running for this household. */
export async function hasWorkInFlight(session: Session, householdId: string): Promise<boolean> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.householdId, householdId), eq(jobs.status, 'running')))
      .limit(1),
  );

  return rows.length > 0;
}
