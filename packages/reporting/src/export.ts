import type { IncomeStatement, NetWorthStatement, TransactionRow } from './types.js';

/**
 * Exports.
 *
 * Two formats here, both text, both exact. CSV because it opens in whatever the
 * household's accountant uses, and JSON because it round-trips without a parser
 * guessing at types.
 *
 * Amounts are written as their decimal string — `1234.5600` — never as a
 * localized or formatted figure. A spreadsheet that receives `$1,234.56` in a
 * numeric column either refuses it or, worse, silently reads it as text and
 * sums it to zero. Formatting is for screens.
 */

export interface CsvColumn<T> {
  readonly header: string;
  readonly value: (row: T) => string;
}

/**
 * RFC 4180, and the details that matter.
 *
 * CRLF line endings and quoting on comma, quote, or any newline — a merchant
 * name containing a comma is the single most common way a hand-rolled CSV
 * corrupts a file, and every column here can contain one.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((column) => escapeCsv(column.header)).join(',')];

  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsv(column.value(row))).join(','));
  }

  return `${lines.join('\r\n')}\r\n`;
}

function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export const TRANSACTION_COLUMNS: readonly CsvColumn<TransactionRow>[] = [
  { header: 'date', value: (row) => row.date },
  { header: 'description', value: (row) => row.merchant ?? '' },
  { header: 'category', value: (row) => row.categoryLabel ?? '' },
  { header: 'amount', value: (row) => row.amount.toDecimalString() },
  { header: 'currency', value: (row) => row.amount.currency },
  { header: 'is_transfer', value: (row) => (row.isTransfer ? 'true' : 'false') },
  { header: 'transaction_id', value: (row) => row.id },
];

export function transactionsToCsv(rows: readonly TransactionRow[]): string {
  return toCsv(rows, TRANSACTION_COLUMNS);
}

/**
 * A statement as JSON.
 *
 * Money serializes through its own `toJSON`, which writes the amount and the
 * currency together. An amount without its currency is a number waiting to be
 * added to a different one.
 */
export function statementToJson(
  statement: IncomeStatement | NetWorthStatement,
  meta: { householdName: string; generatedAt: string },
): string {
  return JSON.stringify({ meta, statement }, null, 2);
}

export function incomeStatementToCsv(statement: IncomeStatement): string {
  const rows = [
    ...statement.incomeLines.map((line) => ({ section: 'income', line })),
    ...statement.expenseLines.map((line) => ({ section: 'expense', line })),
  ];

  return toCsv(rows, [
    { header: 'section', value: (row) => row.section },
    { header: 'category', value: (row) => row.line.label },
    { header: 'amount', value: (row) => row.line.amount.toDecimalString() },
    { header: 'transactions', value: (row) => String(row.line.count) },
  ]);
}
