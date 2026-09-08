import { formatMoney } from '@app/domain';
import {
  incomeStatementToCsv,
  statementToJson,
  toPdf,
  toXlsx,
  transactionsToCsv,
  type CellValue,
  type IncomeStatement,
  type TransactionRow,
} from '@app/reporting';

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

const FORMATS = new Set(['csv', 'json', 'xlsx', 'pdf']);
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

  if (format === 'xlsx') {
    return downloadBytes(
      kind === 'income'
        ? incomeToXlsx(view.income, household)
        : transactionsToXlsx(view.transactions, household),
      `${stem}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  if (format === 'pdf') {
    const generatedNote = `${household} · ${generatedAt.slice(0, 10)}`;
    return downloadBytes(
      kind === 'income'
        ? incomeToPdf(view.income, household, generatedNote)
        : transactionsToPdf(view.transactions, household, view.period.start, generatedNote),
      `${stem}.pdf`,
      'application/pdf',
    );
  }

  const body =
    kind === 'income' ? incomeStatementToCsv(view.income) : transactionsToCsv(view.transactions);

  return download(body, `${stem}.csv`, 'text/csv; charset=utf-8');
}

/**
 * The same rows, as a spreadsheet.
 *
 * Amounts go across as numbers and dates as dates, which is the entire reason
 * to offer this over CSV: a decimal that Excel reads as text sums to zero, and
 * an accountant does not find out until the column is wrong.
 */
function transactionsToXlsx(rows: readonly TransactionRow[], household: string): Uint8Array {
  return toXlsx({
    name: household,
    headers: ['Date', 'Description', 'Category', 'Amount', 'Currency', 'Transfer', 'ID'],
    rows: rows.map((row): CellValue[] => [
      { kind: 'date', value: row.date },
      { kind: 'text', value: row.merchant ?? '' },
      { kind: 'text', value: row.categoryLabel ?? '' },
      { kind: 'number', value: row.amount.toDecimalString() },
      { kind: 'text', value: row.amount.currency },
      { kind: 'text', value: row.isTransfer ? 'true' : 'false' },
      { kind: 'text', value: row.id },
    ]),
  });
}

function incomeToXlsx(statement: IncomeStatement, household: string): Uint8Array {
  const lines = [
    ...statement.incomeLines.map((line) => ({ section: 'income', line })),
    ...statement.expenseLines.map((line) => ({ section: 'expense', line })),
  ];

  return toXlsx({
    name: household,
    headers: ['Section', 'Label', 'Amount', 'Currency'],
    rows: lines.map((entry): CellValue[] => [
      { kind: 'text', value: entry.section },
      { kind: 'text', value: entry.line.label },
      { kind: 'number', value: entry.line.amount.toDecimalString() },
      { kind: 'text', value: entry.line.amount.currency },
    ]),
  });
}

/**
 * The same rows, as a document.
 *
 * A PDF is what gets forwarded to a landlord, a bank or an accountant, and it
 * is the one export where the figures are formatted for reading rather than for
 * a parser — a person is the consumer, so the thousands separator belongs.
 */
function transactionsToPdf(
  rows: readonly TransactionRow[],
  household: string,
  periodStart: string,
  generatedNote: string,
): Uint8Array {
  return toPdf({
    title: household,
    subtitle: periodStart,
    columns: [
      { header: 'Date', width: 0.16, numeric: true },
      { header: 'Description', width: 0.42 },
      { header: 'Category', width: 0.24 },
      { header: 'Amount', width: 0.18, align: 'right', numeric: true },
    ],
    rows: rows.map((row) => [
      row.date,
      row.merchant ?? '',
      row.categoryLabel ?? '',
      formatMoney(row.amount, { locale: 'es-PA' }),
    ]),
    generatedNote,
  });
}

function incomeToPdf(
  statement: IncomeStatement,
  household: string,
  generatedNote: string,
): Uint8Array {
  const rows = [
    ...statement.incomeLines.map((line) => [
      'income',
      line.label,
      formatMoney(line.amount, { locale: 'es-PA' }),
    ]),
    ...statement.expenseLines.map((line) => [
      'expense',
      line.label,
      formatMoney(line.amount, { locale: 'es-PA' }),
    ]),
  ];

  return toPdf({
    title: household,
    subtitle: `${statement.period.start} — ${statement.period.end}`,
    columns: [
      { header: 'Section', width: 0.2 },
      { header: 'Label', width: 0.5 },
      { header: 'Amount', width: 0.3, align: 'right', numeric: true },
    ],
    rows,
    footer: `Net: ${formatMoney(statement.net, { locale: 'es-PA' })}`,
    generatedNote,
  });
}

/** The same headers as `download`, for a body that is bytes rather than text. */
function downloadBytes(body: Uint8Array, filename: string, contentType: string): Response {
  return new Response(new Blob([body as BlobPart]), {
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store, private',
    },
  });
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
