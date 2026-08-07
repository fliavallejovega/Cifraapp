import type { CurrencyCode } from '@app/domain';

import { StatementParseError, type ParsedStatement, type StatementFormat } from '../types.js';

import { parseCsvStatement } from './csv.js';
import { parseOfxStatement } from './ofx.js';

/**
 * Format detection and dispatch.
 *
 * Detection reads the content, not the filename. A bank that serves an OFX file
 * named `.qfx`, or a user who renames a download, must still get the right
 * parser — and a file whose extension lies is exactly the case where guessing
 * silently produces garbage rows.
 */

export function detectStatementFormat(contents: string, fileName?: string): StatementFormat | null {
  const head = contents.slice(0, 2048);

  if (/<OFX>/i.test(head) || /OFXHEADER/i.test(head)) {
    return fileName?.toLowerCase().endsWith('.qfx') ? 'qfx' : 'ofx';
  }

  if (head.startsWith('%PDF')) return 'pdf';

  // XLSX is a ZIP archive; the signature is the only reliable tell.
  if (head.startsWith('PK')) return 'xlsx';

  // A CSV needs a delimiter and at least two lines.
  const lines = head.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length >= 2 && /[,;\t]/.test(lines[0] ?? '')) return 'csv';

  return null;
}

export interface ParseOptions {
  readonly accountId: string;
  readonly currency: CurrencyCode;
  readonly fileName?: string;
  readonly dayFirst?: boolean;
}

export function parseStatement(contents: string, options: ParseOptions): ParsedStatement {
  const format = detectStatementFormat(contents, options.fileName);

  switch (format) {
    case 'ofx':
    case 'qfx':
      return parseOfxStatement(contents, {
        accountId: options.accountId,
        currency: options.currency,
      });

    case 'csv':
      return parseCsvStatement(contents, {
        accountId: options.accountId,
        currency: options.currency,
        ...(options.dayFirst === undefined ? {} : { dayFirst: options.dayFirst }),
      });

    case 'xlsx':
      throw new StatementParseError(
        'xlsx',
        'Spreadsheet import is not available yet. Export the statement as CSV and try again.',
      );

    case 'pdf':
      throw new StatementParseError(
        'pdf',
        'PDF statement import is not available yet. Export the statement as CSV or OFX and try again.',
      );

    case null:
      throw new StatementParseError(
        'csv',
        'The file format could not be recognised. Supported formats are CSV and OFX.',
      );
  }
}

export { parseCsvStatement, parseAmountText, parseStatementDate, splitCsvLine } from './csv.js';
export { parseOfxStatement, parseOfxDate } from './ofx.js';
