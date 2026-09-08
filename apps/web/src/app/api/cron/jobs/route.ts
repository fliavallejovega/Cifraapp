import { getServerEnv } from '@app/validation/env';
import { NextResponse } from 'next/server';

// Importing the service registers the statement-import handler. Without this
// the runner would claim jobs it has no idea how to execute.
import '@/server/import-service';
import { runQueuedJobs } from '@/server/jobs';

/**
 * The queue runner.
 *
 * Every import also tries to run itself the moment its response is flushed, and
 * every poll from the progress screen nudges the queue. This route is the
 * guarantee behind both: a job whose invocation was killed, or whose uploader
 * closed the tab before the work started, is picked up here.
 *
 * Not public. Only Vercel Cron, with the matching bearer secret, may invoke it.
 *
 * **It runs once a day, and that is a platform limit rather than a design.**
 * Vercel's Hobby plan accepts a cron only at daily frequency; a `*​/5 * * * *`
 * schedule is rejected at deploy time and takes the entire deployment down with
 * it, which is exactly how it was discovered. On a plan that allows it, every
 * five minutes is the right setting and only `vercel.json` has to change.
 *
 * A daily sweep is still the correct *fallback*, because it is not the primary
 * path: an import runs itself the moment its response is flushed, and the
 * progress screen nudges the queue on every poll. This exists for the job whose
 * invocation was killed and whose uploader closed the tab — and that job waits
 * hours rather than minutes until the plan changes.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const { CRON_SECRET } = getServerEnv();

  if (!CRON_SECRET || request.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const outcome = await runQueuedJobs();
    return NextResponse.json({ status: 'ok', ...outcome });
  } catch (error: unknown) {
    console.error('[jobs] runner failed', error);
    return NextResponse.json({ status: 'error' }, { status: 503 });
  }
}
