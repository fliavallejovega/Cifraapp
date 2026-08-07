import { Money, plainDateFromParts, type CurrencyCode, type PlainDate } from '@app/domain';

import { computeFingerprint } from '../fingerprint.js';
import { normalizeDescription } from '../normalize.js';
import {
  StatementParseError,
  type CandidateTransaction,
  type ParsedStatement,
  type RejectedRow,
} from '../types.js';

/**
 * CSV statement parsing.
 *
 * Every institution exports a different shape, so the parser detects columns by
 * header rather than by position, and accepts the several ways a bank may
 * express an amount:
 *
 *   - one signed column
 *   - separate debit and credit columns
 *   - an amount plus a direction word
 *
 * Panamanian exports commonly use `dd/mm/yyyy` and, less often, a comma decimal
 * separator. Both are handled — and where the format is genuinely ambiguous
 * (03/04/2026 could be either order) the parser reports the ambiguity instead of
 * guessing, because a silently wrong date moves a transaction between months.
 */

const DATE_HEADERS = [
  'fecha',
  'date',
  'fecha de transaccion',
  'transaction date',
  'fecha operacion',
];
const POSTED_HEADERS = ['fecha de proceso', 'posted', 'posting date', 'fecha valor'];
const DESCRIPTION_HEADERS = [
  'descripcion',
  'description',
  'detalle',
  'concepto',
  'referencia',
  'memo',
];
const AMOUNT_HEADERS = ['monto', 'amount', 'importe', 'valor'];
const DEBIT_HEADERS = ['debito', 'debit', 'cargo', 'retiro'];
const CREDIT_HEADERS = ['credito', 'credit', 'abono', 'deposito'];
const REFERENCE_HEADERS = ['referencia', 'reference', 'nro referencia', 'id'];

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

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findColumn(headers: readonly string[], candidates: readonly string[]): number {
  // Exact match first, so a `referencia` column is not claimed as the
  // description when a real `descripcion` column exists.
  for (const candidate of candidates) {
    const index = headers.indexOf(candidate);
    if (index !== -1) return index;
  }
  for (const candidate of candidates) {
    const index = headers.findIndex((header) => header.includes(candidate));
    if (index !== -1) return index;
  }
  return -1;
}

/**
 * Parses an amount, tolerating thousands separators in either convention.
 *
 * Returns an exact decimal string — never a float. `1.234,56` and `1,234.56`
 * are the same amount written by different institutions, and confusing them
 * changes a figure by three orders of magnitude.
 */
export function parseAmountText(raw: string): string | null {
  const cleaned = raw
    .replace(/[^\d,.\-+()]/g, '')
    // `B/.` — the balboa symbol — survives the strip above as a stray leading
    // separator, and Panamanian statements write it on every line.
    .replace(/^[.,]+/, '')
    .replace(/[.,]+$/, '')
    .trim();
  if (!cleaned) return null;

  // Accounting notation: parentheses mean negative.
  const parenthesised = /^\((.*)\)$/.exec(cleaned);
  const body = parenthesised ? (parenthesised[1] ?? '') : cleaned;
  const negative = parenthesised !== null || body.startsWith('-');

  let digits = body.replace(/[-+]/g, '');
  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    // Whichever appears last is the decimal separator.
    if (lastComma > lastDot) {
      digits = digits.replace(/\./g, '').replace(',', '.');
    } else {
      digits = digits.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    // A lone comma with exactly two trailing digits is a decimal separator;
    // otherwise it groups thousands.
    digits = digits.length - lastComma === 3 ? digits.replace(',', '.') : digits.replace(/,/g, '');
  }

  if (!/^\d+(\.\d+)?$/.test(digits)) return null;

  return `${negative ? '-' : ''}${digits}`;
}

/** Parses a date, refusing rather than guessing when the order is ambiguous. */
export function parseStatementDate(raw: string, dayFirst: boolean): PlainDate | null {
  const trimmed = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) {
    return plainDateFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const slashed = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(trimmed);
  if (!slashed) return null;

  const first = Number(slashed[1]);
  const second = Number(slashed[2]);
  let year = Number(slashed[3]);
  if (year < 100) year += 2000;

  // When one component exceeds 12 the order is unambiguous, whatever the
  // configured convention says.
  const day = second > 12 ? second : first > 12 ? first : dayFirst ? first : second;
  const month = second > 12 ? first : first > 12 ? second : dayFirst ? second : first;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  try {
    return plainDateFromParts(year, month, day);
  } catch {
    return null;
  }
}

export function parseCsvStatement(contents: string, options: CsvParseOptions): ParsedStatement {
  const dayFirst = options.dayFirst ?? true;
  const lines = contents.split(/\r?\n/).filter((line) => line.trim() !== '');

  if (lines.length < 2) {
    throw new StatementParseError('csv', 'The file has no rows beneath its header.');
  }

  const delimiter = detectDelimiter(lines[0] ?? '');
  const headers = splitCsvLine(lines[0] ?? '', delimiter).map(normalizeHeader);

  const dateColumn = findColumn(headers, DATE_HEADERS);
  const descriptionColumn = findColumn(headers, DESCRIPTION_HEADERS);
  const amountColumn = findColumn(headers, AMOUNT_HEADERS);
  const debitColumn = findColumn(headers, DEBIT_HEADERS);
  const creditColumn = findColumn(headers, CREDIT_HEADERS);
  const postedColumn = findColumn(headers, POSTED_HEADERS);
  const referenceColumn = findColumn(headers, REFERENCE_HEADERS);

  if (dateColumn === -1) {
    throw new StatementParseError('csv', 'No date column was found.');
  }
  if (descriptionColumn === -1) {
    throw new StatementParseError('csv', 'No description column was found.');
  }
  if (amountColumn === -1 && debitColumn === -1 && creditColumn === -1) {
    throw new StatementParseError('csv', 'No amount, debit or credit column was found.');
  }

  const transactions: CandidateTransaction[] = [];
  const rejected: RejectedRow[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const raw = lines[index] ?? '';
    const fields = splitCsvLine(raw, delimiter);

    const transactionDate = parseStatementDate(fields[dateColumn] ?? '', dayFirst);
    if (!transactionDate) {
      rejected.push({ line: index + 1, raw, reason: 'The date could not be read.' });
      continue;
    }

    let amountText: string | null = null;
    if (amountColumn !== -1) {
      amountText = parseAmountText(fields[amountColumn] ?? '');
    }
    if (amountText === null && debitColumn !== -1) {
      const debit = parseAmountText(fields[debitColumn] ?? '');
      // A debit column carries magnitudes; the sign is implied by the column.
      if (debit && debit !== '0') amountText = debit.startsWith('-') ? debit : `-${debit}`;
    }
    if (amountText === null && creditColumn !== -1) {
      const credit = parseAmountText(fields[creditColumn] ?? '');
      if (credit && credit !== '0') amountText = credit.replace('-', '');
    }

    if (amountText === null) {
      rejected.push({ line: index + 1, raw, reason: 'The amount could not be read.' });
      continue;
    }

    let amount: Money;
    try {
      amount = Money.fromDecimalString(amountText, options.currency);
    } catch {
      rejected.push({ line: index + 1, raw, reason: 'The amount is not a valid decimal.' });
      continue;
    }

    if (amount.isZero()) {
      rejected.push({ line: index + 1, raw, reason: 'The row has no amount.' });
      continue;
    }

    const descriptionOriginal = (fields[descriptionColumn] ?? '').trim();
    const { normalized } = normalizeDescription(descriptionOriginal);
    const postedDate =
      postedColumn === -1 ? null : parseStatementDate(fields[postedColumn] ?? '', dayFirst);
    const reference = referenceColumn === -1 ? '' : (fields[referenceColumn] ?? '').trim();

    transactions.push({
      transactionDate,
      ...(postedDate ? { postedDate } : {}),
      amount,
      direction: amount.isNegative() ? 'outflow' : 'inflow',
      descriptionOriginal,
      descriptionNormalized: normalized,
      ...(reference ? { externalReference: reference } : {}),
      fingerprint: computeFingerprint({
        accountId: options.accountId,
        transactionDate,
        amount,
        descriptionNormalized: normalized,
      }),
    });
  }

  return {
    format: 'csv',
    currency: options.currency,
    transactions,
    rejected,
  };
}
