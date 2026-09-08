import type { CurrencyCode } from '@app/domain';

import { StatementParseError, type ParsedStatement } from '../types.js';

import { parseTable } from './table.js';
import { readZipEntries, readZipFile, ZipError } from './zip.js';

/**
 * Spreadsheet statements.
 *
 * Several Panamanian banks export nothing but Excel, which made «download your
 * statement and import it» false for their customers. An `.xlsx` is a ZIP of
 * XML: the sheet holds cell references and values, and every string is either
 * inline or an index into a shared table.
 *
 * The awkward part is dates. Excel stores them as a day count since 1900 with a
 * format applied, so a cell reading `01/09/2026` is the number 46266 wearing a
 * costume. Reading the number and ignoring the costume would file every
 * transaction in 2026-derived nonsense, so the style table is read and any cell
 * whose format is a date is converted back to a calendar date.
 */

/** Excel's epoch, with the 1900 leap-year bug it has never fixed. */
const EXCEL_EPOCH_OFFSET_DAYS = 25_569;
const MILLIS_PER_DAY = 86_400_000;

/** The built-in number formats Excel defines as dates. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

export interface XlsxParseOptions {
  readonly accountId: string;
  readonly currency: CurrencyCode;
  readonly dayFirst?: boolean;
}

/** Reads the first worksheet as a grid of strings. */
export function readXlsxSheet(bytes: Uint8Array): string[][] {
  let entries;
  try {
    entries = readZipEntries(bytes);
  } catch (error: unknown) {
    throw new StatementParseError(
      'xlsx',
      error instanceof ZipError ? error.message : 'The spreadsheet could not be opened.',
    );
  }

  const sheetName = firstSheetName(entries.map((entry) => entry.name));
  if (!sheetName) {
    throw new StatementParseError('xlsx', 'The spreadsheet contains no worksheet.');
  }

  const sheetXml = readZipFile(bytes, sheetName);
  if (sheetXml === null) {
    throw new StatementParseError('xlsx', 'The worksheet could not be read.');
  }

  const sharedStrings = parseSharedStrings(readZipFile(bytes, 'xl/sharedStrings.xml'));
  const dateStyles = parseDateStyles(readZipFile(bytes, 'xl/styles.xml'));

  return parseSheetXml(sheetXml, sharedStrings, dateStyles);
}

export function parseXlsxStatement(bytes: Uint8Array, options: XlsxParseOptions): ParsedStatement {
  const rows = readXlsxSheet(bytes);
  return parseTable(rows, 'xlsx', options);
}

/**
 * The lowest-numbered sheet, which is the one a bank export puts the statement
 * on. Reading `workbook.xml` for the true order would be more correct and would
 * matter only for a file no bank produces.
 */
function firstSheetName(names: readonly string[]): string | null {
  const sheets = names
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => sheetNumber(a) - sheetNumber(b));
  return sheets[0] ?? null;
}

function sheetNumber(name: string): number {
  return Number(/sheet(\d+)\.xml$/.exec(name)?.[1] ?? '0');
}

function parseSharedStrings(xml: string | null): readonly string[] {
  if (xml === null) return [];

  const strings: string[] = [];
  // Each `<si>` is one shared string, possibly split across several `<t>` runs
  // when parts of it are formatted differently. The runs concatenate.
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const inner = match[1] ?? '';
    const parts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((run) =>
      decodeXmlText(run[1] ?? ''),
    );
    strings.push(parts.join(''));
  }

  return strings;
}

/**
 * Which style indexes mean «this cell is a date».
 *
 * `cellXfs` maps a cell's style index to a number format id; ids below 164 are
 * Excel's built-ins and the rest are declared in `numFmts`. A custom format is
 * a date when its pattern contains a year, month or day token outside quotes.
 */
function parseDateStyles(xml: string | null): ReadonlySet<number> {
  const dateStyles = new Set<number>();
  if (xml === null) return dateStyles;

  const customDateFormats = new Set<number>();
  for (const match of xml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    const id = Number(match[1]);
    const code = (match[2] ?? '').replace(/"[^"]*"/g, '');
    if (/[ymd]/i.test(code)) customDateFormats.add(id);
  }

  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  let index = 0;
  for (const match of cellXfs.matchAll(/<xf\b[^>]*\/?>/g)) {
    const id = Number(/numFmtId="(\d+)"/.exec(match[0] ?? '')?.[1] ?? '0');
    if (BUILTIN_DATE_FORMATS.has(id) || customDateFormats.has(id)) dateStyles.add(index);
    index += 1;
  }

  return dateStyles;
}

function parseSheetXml(
  xml: string,
  sharedStrings: readonly string[],
  dateStyles: ReadonlySet<number>,
): string[][] {
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];

    for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1] ?? '';
      const inner = cellMatch[2] ?? '';

      // The reference names the column, and columns are skipped rather than
      // emitted when a row has no value in them. Without this, a gap shifts
      // every later cell one column left and the amount lands under «date».
      const reference = /r="([A-Z]+)\d+"/.exec(attributes)?.[1];
      if (reference) {
        const column = columnIndex(reference);
        while (cells.length < column) cells.push('');
      }

      cells.push(cellValue(attributes, inner, sharedStrings, dateStyles));
    }

    rows.push(cells);
  }

  return rows;
}

function cellValue(
  attributes: string,
  inner: string,
  sharedStrings: readonly string[],
  dateStyles: ReadonlySet<number>,
): string {
  const type = /t="([^"]+)"/.exec(attributes)?.[1] ?? 'n';

  if (type === 'inlineStr') {
    const parts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((run) =>
      decodeXmlText(run[1] ?? ''),
    );
    return parts.join('');
  }

  const raw = decodeXmlText(/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
  if (raw === '') return '';

  if (type === 's') {
    return sharedStrings[Number(raw)] ?? '';
  }

  if (type === 'str' || type === 'e') return raw;

  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';

  const style = Number(/s="(\d+)"/.exec(attributes)?.[1] ?? '-1');
  if (dateStyles.has(style)) {
    const serial = Number(raw);
    if (Number.isFinite(serial)) return serialToIsoDate(serial);
  }

  return raw;
}

/**
 * Excel's day count back to a calendar date.
 *
 * Returned as ISO, not as a locale format, because the table parser reads ISO
 * without having to guess an order — the one case where the day/month ambiguity
 * cannot bite.
 */
function serialToIsoDate(serial: number): string {
  const days = Math.floor(serial);
  const millis = (days - EXCEL_EPOCH_OFFSET_DAYS) * MILLIS_PER_DAY;
  return new Date(millis).toISOString().slice(0, 10);
}

/** `A` is 0, `AA` is 26. Spreadsheet columns are base-26 with no zero. */
function columnIndex(reference: string): number {
  let index = 0;
  for (const character of reference) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index - 1;
}

function decodeXmlText(value: string): string {
  return (
    value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
      // Last, so an escaped ampersand does not re-enter the other rules.
      .replace(/&amp;/g, '&')
  );
}
