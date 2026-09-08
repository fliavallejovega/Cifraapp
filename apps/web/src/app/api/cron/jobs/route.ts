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
