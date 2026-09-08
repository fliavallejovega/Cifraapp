import type { CurrencyCode } from '@app/domain';

import { StatementParseError, type ParsedStatement } from '../types.js';

import { parseTable } from './table.js';

/**
 * CSV statement parsing.
 *
 * Everything about *what a column means* now lives in `table.ts`, shared with
 * the spreadsheet and PDF readers. What is left here is the part that is
 * genuinely about CSV: finding the delimiter, and RFC 4180 field splitting,
 * where a quoted field may contain the delimiter and an escaped quote.
 */

export interface CsvParseOptions {
  readonly accountId: string;
  readonly currency: CurrencyCode;
  /**
   * Day-first (`dd/mm/yyyy`) is the Panamanian convention and the default. Pass
   * `false` for exports from US-configured systems.
   */
  readonly dayFirst?: boolean;
}

/** RFC 4180 splitting: quoted fields may contain commas and escaped quotes. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? '';

    if (inQuotes) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === delimiter) {
      fields.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }

  fields.push(current.trim());
  return fields;
}

function detectDelimiter(headerLine: string): string {
  const counts = [',', ';', '\t'].map((candidate) => ({
    candidate,
    count: splitCsvLine(headerLine, candidate).length,
  }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0]?.candidate ?? ',';
}

export function parseCsvStatement(contents: string, options: CsvParseOptions): ParsedStatement {
  const lines = contents.split(/\r?\n/).filter((line) => line.trim() !== '');

  if (lines.length < 2) {
    throw new StatementParseError('csv', 'The file has no rows beneath its header.');
  }

  const delimiter = detectDelimiter(lines[0] ?? '');
  const rows = lines.map((line) => splitCsvLine(line, delimiter));

  return parseTable(rows, 'csv', options);
}

export { parseAmountText, parseStatementDate } from './table.js';
