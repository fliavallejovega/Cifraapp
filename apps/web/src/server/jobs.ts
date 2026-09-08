import 'server-only';

import { getAdminDb, type Database } from '@app/database';
import { jobs } from '@app/database/schema';
import { getServerEnv } from '@app/validation/env';
import { and, eq, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from './session';

/**
 * The queue, and the loop that drains it.
 *
 * Parsing a statement cannot happen inside the request that uploaded it: a
 * hundred-page PDF takes seconds, the platform's request budget does not
 * stretch that far, and a person watching a spinner cannot tell a slow parse
 * from a lost one. So the upload records the file and enqueues the work.
 *
 * Two rules the rest of the system depends on:
 *
 *   - Enqueueing runs as the household, under RLS. A job is theirs, and a
 *     screen reads it back through the same policy that let them create it.
 *   - Running does not. The worker moves a job through `running` and
 *     `succeeded`, and a status a member could write by hand would be a status
 *     that means nothing. That is why the runner takes the admin handle — one
 *     of the three sanctioned uses, alongside migrations and seeds.
 *
 * Claiming uses `for update skip locked`, so two workers started at once take
 * different jobs rather than the same one twice.
 */

/** How many jobs one invocation of the runner will drain before returning. */
const BATCH_SIZE = 5;

/** A job that has been `running` longer than this was killed mid-flight. */
const STALE_MINUTES = 15;

export type JobPayload = Readonly<Record<string, unknown>>;

export interface ClaimedJob {
  readonly id: string;
  readonly householdId: string;
  readonly kind: string;
  readonly payload: JobPayload;
  readonly attempts: number;
  readonly maxAttempts: number;
}

export interface JobOutcome {
  readonly result?: JobPayload;
  /** Written for the household, because they are the ones who will read it. */
  readonly failure?: string;
  /** False when the failure is permanent — a bad file will not parse next time. */
  readonly retryable?: boolean;
}

export type JobHandler = (
  job: ClaimedJob,
  report: (progress: number, note?: string) => Promise<void>,
) => Promise<JobOutcome>;

const handlers = new Map<string, JobHandler>();

/** Registers what a kind of work actually does. Unknown kinds fail loudly. */
export function registerJobHandler(kind: string, handler: JobHandler): void {
  handlers.set(kind, handler);
}

function adminDatabase(): Database {
  return getAdminDb(getServerEnv().DIRECT_URL);
}

/**
 * Enqueues work, as the household.
 *
 * Returns the existing job when one is already queued or running for the same
 * document — a person who double-clicks upload gets one import, not two. The
 * partial unique index is what makes that a fact rather than a hope.
 */
export async function enqueueJob(
  session: Session,
  householdId: string,
  kind: string,
  payload: JobPayload,
): Promise<string | null> {
  const [created] = await queryAsUser(session, (tx) =>
    tx
      .insert(jobs)
      .values({
        householdId,
        kind,
        payload,
        status: 'queued',
        createdBy: session.user.id,
      })
      .onConflictDoNothing()
      .returning({ id: jobs.id }),
  );

  return created?.id ?? null;
}

/** Marks a queued job cancelled. A running one is left to finish. */
export async function cancelJob(
  session: Session,
  householdId: string,
  jobId: string,
): Promise<boolean> {
  const [cancelled] = await queryAsUser(session, (tx) =>
    tx
      .update(jobs)
      .set({ status: 'cancelled', finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.householdId, householdId), eq(jobs.status, 'queued')))
      .returning({ id: jobs.id }),
  );

  return cancelled !== undefined;
}

/**
 * Runs up to a batch of queued jobs and reports how many finished.
 *
 * Safe to call concurrently: every claim is a single statement that both
 * selects and marks the row, so a job cannot be picked up twice.
 */
export async function runQueuedJobs(limit = BATCH_SIZE): Promise<{
  readonly ran: number;
  readonly succeeded: number;
  readonly failed: number;
}> {
  const db = adminDatabase();
  await releaseStaleJobs(db);

  let ran = 0;
  let succeeded = 0;
  let failed = 0;

  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextJob(db);
    if (!job) break;

    ran += 1;
    const outcome = await runOne(db, job);
    if (outcome) succeeded += 1;
    else failed += 1;
  }

  return { ran, succeeded, failed };
}

/** Runs one specific job, if it is still waiting. Used right after an upload. */
export async function runJobNow(jobId: string): Promise<boolean> {
  const db = adminDatabase();
  const job = await claimNextJob(db, jobId);
  if (!job) return false;
  return runOne(db, job);
}

async function runOne(db: Database, job: ClaimedJob): Promise<boolean> {
  const handler = handlers.get(job.kind);

  if (!handler) {
    // An unknown kind is a deploy that went out half-done. It fails at once
    // rather than retrying three times against a worker that will never know
    // what to do with it.
    await finish(db, job.id, 'failed', {
      failure: 'This kind of work is not available on this version.',
    });
    return false;
  }

  const report = async (progress: number, note?: string): Promise<void> => {
    await db
      .update(jobs)
      .set({
        progress: Math.max(0, Math.min(100, Math.round(progress))),
        ...(note === undefined ? {} : { progressNote: note }),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id));
  };

  let outcome: JobOutcome;
  try {
    outcome = await handler(job, report);
  } catch (error: unknown) {
    outcome = {
      // The household reads this. A stack trace tells them nothing they can act
      // on, and the detail belongs in the platform's own logs.
      failure: 'Something went wrong while processing this file.',
      retryable: true,
    };
    console.error('[jobs] handler threw', { jobId: job.id, kind: job.kind, error });
  }

  if (outcome.failure === undefined) {
    await finish(db, job.id, 'succeeded', outcome);
    return true;
  }

  const canRetry = outcome.retryable !== false && job.attempts < job.maxAttempts;

  if (canRetry) {
    // Exponential, in minutes, from the attempt just spent.
    const delayMinutes = 2 ** job.attempts;
    await db
      .update(jobs)
      .set({
        status: 'queued',
        errorMessage: outcome.failure,
        runAfter: new Date(Date.now() + delayMinutes * 60_000),
        startedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id));
    return false;
  }

  await finish(db, job.id, 'failed', outcome);
  return false;
}

async function finish(
  db: Database,
  jobId: string,
  status: 'succeeded' | 'failed',
  outcome: JobOutcome,
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status,
      progress: status === 'succeeded' ? 100 : undefined,
      ...(outcome.result === undefined ? {} : { result: outcome.result }),
      errorMessage: outcome.failure ?? null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

/**
 * Takes the next runnable job and marks it running, in one statement.
 *
 * `skip locked` is the whole trick: a second worker arriving mid-transaction
 * steps over the locked row and takes the one after it, instead of blocking or
 * — worse — reading the same row and importing a statement twice.
 */
async function claimNextJob(db: Database, onlyId?: string): Promise<ClaimedJob | null> {
  const rows = await db.execute<{
    id: string;
    household_id: string;
    kind: string;
    payload: JobPayload;
    attempts: number;
    max_attempts: number;
  }>(sql`
    update app.jobs as j
       set status = 'running',
           started_at = now(),
           attempts = j.attempts + 1,
           updated_at = now()
     where j.id = (
       select candidate.id
         from app.jobs as candidate
        where candidate.status = 'queued'
          and candidate.run_after <= now()
          ${onlyId ? sql`and candidate.id = ${onlyId}` : sql``}
        order by candidate.run_after, candidate.created_at
        for update skip locked
        limit 1
     )
    returning j.id, j.household_id, j.kind, j.payload, j.attempts, j.max_attempts
  `);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    householdId: row.household_id,
    kind: row.kind,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

/**
 * Returns jobs abandoned by a killed worker to the queue.
 *
 * Without this a job whose process was terminated mid-run stays `running`
 * forever, and the screen reporting on it says «in progress» for the rest of
 * the household's life. The attempt it already spent is not refunded, so a job
 * that reliably kills its worker still gives up after three tries.
 */
async function releaseStaleJobs(db: Database): Promise<void> {
  await db.execute(sql`
    update app.jobs
       set status = case when attempts >= max_attempts then 'failed'::app.job_status
                         else 'queued'::app.job_status end,
           error_message = 'The processing was interrupted and started again.',
           finished_at = case when attempts >= max_attempts then now() else null end,
           updated_at = now()
     where status = 'running'
       and started_at < now() - interval '${sql.raw(String(STALE_MINUTES))} minutes'
  `);
}
