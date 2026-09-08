import type { CurrencyCode } from '@app/domain';

import { StatementParseError, type ParsedStatement, type StatementFormat } from '../types.js';

import { parseCsvStatement } from './csv.js';
import { parseOfxStatement } from './ofx.js';
import { parsePdfStatement } from './pdf.js';
import { parseXlsxStatement } from './xlsx.js';

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
    case 'pdf':
      // Both are binary. Reaching here means a caller decoded the bytes to a
      // string first, which destroys them — `parseDocument` is the entry point.
      throw new StatementParseError(
        format,
        'This format has to be read from the file itself, not from decoded text.',
      );

    case null:
      throw new StatementParseError(
        'csv',
        'The file format could not be recognised. Supported formats are CSV, OFX, PDF and XLSX.',
      );
  }
}

/**
 * The entry point for a file as it was uploaded.
 *
 * `parseStatement` takes text and is right for CSV and OFX. A PDF and a
 * spreadsheet are binary, and decoding them to a string before dispatch turns
 * a compressed stream into replacement characters — so detection happens on the
 * bytes, and only the text formats are decoded.
 */
export function parseDocument(bytes: Uint8Array, options: ParseOptions): ParsedStatement {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const format = detectStatementFormat(head, options.fileName);

  if (format === 'pdf') {
    return parsePdfStatement(bytes, {
      accountId: options.accountId,
      currency: options.currency,
      ...(options.dayFirst === undefined ? {} : { dayFirst: options.dayFirst }),
    });
  }

  if (format === 'xlsx') {
    return parseXlsxStatement(bytes, {
      accountId: options.accountId,
      currency: options.currency,
      ...(options.dayFirst === undefined ? {} : { dayFirst: options.dayFirst }),
    });
  }

  return parseStatement(new TextDecoder('utf-8').decode(bytes), options);
}

export { parseCsvStatement, parseAmountText, parseStatementDate, splitCsvLine } from './csv.js';
export { parseOfxStatement, parseOfxDate } from './ofx.js';
export { extractPdfLines, parsePdfStatement, type PdfParseOptions } from './pdf.js';
export { parseXlsxStatement, readXlsxSheet, type XlsxParseOptions } from './xlsx.js';
export { findHeaderRow, normalizeHeader, parseTable, type TableParseOptions } from './table.js';
export { readZipEntries, readZipFile, ZipError, type ZipEntry } from './zip.js';
