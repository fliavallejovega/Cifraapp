import { incomeStatementToCsv, statementToJson, transactionsToCsv } from '@app/reporting';

import { loadReport } from '@/server/repositories/reports';
import { loadSession } from '@/server/session';

/**
 * Exports, streamed straight to the browser.
 *
 * The same rows the reports page rendered, serialized. Not a second computation
 * — a report and its export that disagree is the kind of defect nobody notices
 * until an accountant does.
 *
 * Nothing is written to object storage on the way out. A financial export
 * sitting in a bucket is a second copy of the most sensitive data in the system,
 * kept for the convenience of a download that already succeeded.
 */

const FORMATS = new Set(['csv', 'json']);
const KINDS = new Set(['transactions', 'income']);

export async function GET(request: Request): Promise<Response> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get('format') ?? 'csv';
  const kind = url.searchParams.get('kind') ?? 'transactions';

  if (!FORMATS.has(format) || !KINDS.has(kind)) {
    return new Response('Unsupported export', { status: 400 });
  }

  const view = await loadReport(session, session.activeHouseholdId);
  const household =
    session.households.find((entry) => entry.id === session.activeHouseholdId)?.name ?? 'household';

  const generatedAt = new Date().toISOString();
  const stem = `${slug(household)}-${kind}-${view.period.start}`;

  if (format === 'json') {
    return download(
      statementToJson(view.income, { householdName: household, generatedAt }),
      `${stem}.json`,
      'application/json; charset=utf-8',
    );
  }

  const body =
    kind === 'income' ? incomeStatementToCsv(view.income) : transactionsToCsv(view.transactions);

  return download(body, `${stem}.csv`, 'text/csv; charset=utf-8');
}

function download(body: string, filename: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${filename}"`,
      // A financial export must never sit in a shared cache, and a browser that
      // restores it from history after a sign-out is the same problem.
      'cache-control': 'no-store, private',
    },
  });
}

function slug(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'household'
  );
}
