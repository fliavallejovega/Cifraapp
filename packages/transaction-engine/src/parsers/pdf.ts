import { Money, type CurrencyCode } from '@app/domain';

import { computeFingerprint } from '../fingerprint.js';
import { normalizeDescription } from '../normalize.js';
import {
  StatementParseError,
  type CandidateTransaction,
  type ParsedStatement,
  type RejectedRow,
} from '../types.js';

import { parseAmountText, parseStatementDate } from './table.js';
import { inflateZlib } from './zip.js';

/**
 * PDF statements — the file a person actually downloads from their bank.
 *
 * This reads the text layer, which is what a bank's own PDF generator produces.
 * It is not OCR and does not pretend to be: a scan or a photograph has no text
 * layer, and this refuses it by name rather than returning zero rows and
 * letting a household conclude their statement was empty.
 *
 * The extraction is deliberately positional. Text-showing operators carry no
 * notion of a line, so every fragment is recorded with the coordinates the text
 * matrix put it at, then grouped into lines by vertical position and ordered by
 * horizontal position. Anything else produces a statement where the amount from
 * row four is attached to the description from row seven.
 *
 * Lines are then read one at a time rather than as columns: a bank statement
 * line is a date, some words, and one or two figures at the end, and that shape
 * survives layouts that a column detector does not.
 */

/** Fragments closer than this vertically are the same line. */
const LINE_TOLERANCE = 3;

/** A horizontal gap wider than this is a column boundary, not a space. */
const COLUMN_GAP = 6;

export interface PdfParseOptions {
  readonly accountId: string;
  readonly currency: CurrencyCode;
  readonly dayFirst?: boolean;
}

interface Fragment {
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

/**
 * Every text line in the document, in reading order.
 *
 * Exported because it is the honest unit to test against and because the
 * bank-template layer reads the same lines to recognise an institution.
 */
export function extractPdfLines(bytes: Uint8Array): readonly string[] {
  const streams = extractContentStreams(bytes);
  if (streams.length === 0) {
    throw new StatementParseError(
      'pdf',
      'This PDF has no text layer. It is a scan or a photograph, and needs to be read by OCR.',
    );
  }

  const lines: string[] = [];

  for (const stream of streams) {
    const fragments = readTextFragments(stream);
    if (fragments.length === 0) continue;

    // Top of the page first. PDF's y axis grows upward, so descending y is
    // reading order.
    const sorted = [...fragments].sort((a, b) => b.y - a.y || a.x - b.x);

    let current: Fragment[] = [];
    let currentY: number | null = null;

    const flush = () => {
      if (current.length === 0) return;
      lines.push(joinLine(current));
      current = [];
    };

    for (const fragment of sorted) {
      if (currentY === null || Math.abs(fragment.y - currentY) <= LINE_TOLERANCE) {
        current.push(fragment);
        currentY = currentY ?? fragment.y;
      } else {
        flush();
        current = [fragment];
        currentY = fragment.y;
      }
    }

    flush();
  }

  return lines;
}

export function parsePdfStatement(bytes: Uint8Array, options: PdfParseOptions): ParsedStatement {
  const dayFirst = options.dayFirst ?? true;
  const lines = extractPdfLines(bytes);

  const transactions: CandidateTransaction[] = [];
  const rejected: RejectedRow[] = [];

  /**
   * The running balance from the previous transaction line.
   *
   * When a statement prints a balance column, the direction of a movement is
   * not a guess: the balance went up or it went down. This is the single most
   * reliable signal in a bank PDF and it costs nothing to keep.
   */
  let previousBalance: Money | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim();
    if (line === '') continue;

    const leadingDate = /^(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})\b/.exec(line);
    if (!leadingDate) continue;

    const transactionDate = parseStatementDate(leadingDate[1] ?? '', dayFirst);
    if (!transactionDate) continue;

    const rest = line.slice(leadingDate[0].length).trim();
    const figures = trailingFigures(rest);

    if (figures.length === 0) {
      // A dated line with no figure is a section header or a note. Only lines
      // that look like transactions and still cannot be read are reported.
      continue;
    }

    const descriptionOriginal = rest.slice(0, figures[0]?.at ?? rest.length).trim();
    if (descriptionOriginal === '') {
      rejected.push({ line: index + 1, raw: line, reason: 'The row has no description.' });
      continue;
    }

    let amount: Money;
    let balance: Money | null = null;

    try {
      if (figures.length >= 2) {
        // The last figure is the running balance; the one before it is the
        // movement. A statement with three figures prints debit and credit in
        // separate columns, and only one of them is ever non-zero.
        const balanceText = figures[figures.length - 1]?.value ?? '0';
        balance = Money.fromDecimalString(balanceText, options.currency);

        const candidates = figures
          .slice(0, -1)
          .map((figure) => Money.fromDecimalString(figure.value, options.currency))
          .filter((value) => !value.isZero());

        const movement = candidates[candidates.length - 1];
        if (!movement) {
          rejected.push({ line: index + 1, raw: line, reason: 'The row has no amount.' });
          continue;
        }
        amount = movement;
      } else {
        amount = Money.fromDecimalString(figures[0]?.value ?? '0', options.currency);
      }
    } catch {
      rejected.push({ line: index + 1, raw: line, reason: 'The amount is not a valid decimal.' });
      continue;
    }

    if (amount.isZero()) {
      rejected.push({ line: index + 1, raw: line, reason: 'The row has no amount.' });
      continue;
    }

    const direction = directionOf(amount, balance, previousBalance, descriptionOriginal);
    if (balance) previousBalance = balance;

    const signed = direction === 'outflow' ? amount.abs().negate() : amount.abs();
    const { normalized } = normalizeDescription(descriptionOriginal);

    transactions.push({
      transactionDate,
      amount: signed,
      direction,
      descriptionOriginal,
      descriptionNormalized: normalized,
      fingerprint: computeFingerprint({
        accountId: options.accountId,
        transactionDate,
        amount: signed,
        descriptionNormalized: normalized,
      }),
    });
  }

  if (transactions.length === 0 && rejected.length === 0) {
    throw new StatementParseError(
      'pdf',
      'No transaction lines were found. The PDF may be a summary rather than a statement.',
    );
  }

  return { format: 'pdf', currency: options.currency, transactions, rejected };
}

/**
 * Which way the money went.
 *
 * In order of how much the statement actually told us: the running balance if
 * there is one, then an explicit sign, then the words. Guessing from words
 * alone is last because «PAGO RECIBIDO» and «PAGO REALIZADO» differ by one
 * word and by the whole sign of the figure.
 */
function directionOf(
  amount: Money,
  balance: Money | null,
  previousBalance: Money | null,
  description: string,
): 'inflow' | 'outflow' {
  if (balance && previousBalance) {
    return balance.greaterThanOrEqual(previousBalance) ? 'inflow' : 'outflow';
  }

  if (amount.isNegative()) return 'outflow';

  if (
    /\b(abono|deposito|depósito|credito|crédito|pago recibido|transferencia recibida|deposit|credit|refund|reembolso)\b/i.test(
      description,
    )
  ) {
    return 'inflow';
  }

  // A statement line is overwhelmingly a charge. Defaulting the other way would
  // report a household as earning its own spending.
  return 'outflow';
}

interface TrailingFigure {
  readonly value: string;
  readonly at: number;
}

/** The money-shaped tokens at the end of a line, in the order they appear. */
function trailingFigures(line: string): readonly TrailingFigure[] {
  const figures: TrailingFigure[] = [];
  const pattern = /(-?\(?[\d][\d,.]*\)?-?)(?:\s|$)/g;

  for (const match of line.matchAll(pattern)) {
    const raw = match[1] ?? '';
    // A figure has to look like money: at least one separator with two decimals,
    // or the whole token is digits. A reference number «0012345678» would
    // otherwise be read as twelve million dollars.
    if (!/[.,]\d{2}\)?-?$/.test(raw)) continue;

    const value = parseAmountText(raw);
    if (value === null) continue;

    figures.push({ value, at: match.index });
  }

  return figures;
}

/**
 * Content streams, inflated.
 *
 * Objects are found by scanning for `stream` … `endstream` rather than by
 * walking the cross-reference table, because a statement's xref is often an
 * incremental chain and following it correctly buys nothing here: every stream
 * is tried, and the ones that are not text simply yield no fragments.
 */
function extractContentStreams(bytes: Uint8Array): readonly string[] {
  const latin1 = new TextDecoder('latin1');
  const source = latin1.decode(bytes);

  if (!source.startsWith('%PDF')) {
    throw new StatementParseError('pdf', 'The file is not a PDF.');
  }

  if (/\/Encrypt\b/.test(source)) {
    throw new StatementParseError(
      'pdf',
      'This PDF is password-protected. Remove the password and try again.',
    );
  }

  const streams: string[] = [];
  const pattern = /stream\r?\n?/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const start = match.index + match[0].length;
    const end = source.indexOf('endstream', start);
    if (end === -1) break;

    // The dictionary immediately before the stream says how it was encoded.
    const header = source.slice(Math.max(0, match.index - 400), match.index);
    const raw = bytes.subarray(start, trimEol(source, end));

    if (header.includes('/FlateDecode')) {
      try {
        streams.push(latin1.decode(inflateZlib(raw)));
      } catch {
        // A stream that will not inflate is an image or a font, not text.
        continue;
      }
    } else if (!/\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode|\/JBIG2Decode/.test(header)) {
      streams.push(latin1.decode(raw));
    }

    pattern.lastIndex = end;
  }

  return streams.filter((stream) => /\bBT\b/.test(stream));
}

/** `endstream` is preceded by the newline that closed the data, not by data. */
function trimEol(source: string, end: number): number {
  let cursor = end;
  if (source[cursor - 1] === '\n') cursor -= 1;
  if (source[cursor - 1] === '\r') cursor -= 1;
  return cursor;
}

/**
 * Text fragments with the coordinates the text matrix gave them.
 *
 * Only the translation components of `Tm` and the offsets of `Td`/`TD`/`T*` are
 * tracked. A statement's text is not rotated or sheared, and carrying a full
 * matrix product would be precision this cannot use.
 */
function readTextFragments(stream: string): readonly Fragment[] {
  const fragments: Fragment[] = [];

  let x = 0;
  let y = 0;
  let lineX = 0;
  let lineY = 0;
  let leading = 0;

  const operators =
    /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|(-?[\d.]+)\s+(-?[\d.]+)\s+(TD|Td)|(-?[\d.]+)\s+TL|T\*|BT|\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^)\\]|\\.)*)\)\s*(Tj|')|<([0-9A-Fa-f\s]+)>\s*Tj/g;

  for (const match of stream.matchAll(operators)) {
    const whole = match[0];

    if (whole.endsWith('Tm')) {
      x = Number(match[5]);
      y = Number(match[6]);
      lineX = x;
      lineY = y;
      continue;
    }

    if (whole.endsWith('TD') || whole.endsWith('Td')) {
      const dx = Number(match[7]);
      const dy = Number(match[8]);
      lineX += dx;
      lineY += dy;
      x = lineX;
      y = lineY;
      if (match[9] === 'TD') leading = -dy;
      continue;
    }

    if (whole.endsWith('TL')) {
      leading = Number(match[10]);
      continue;
    }

    if (whole === 'T*') {
      lineY -= leading;
      x = lineX;
      y = lineY;
      continue;
    }

    if (whole === 'BT') {
      x = 0;
      y = 0;
      lineX = 0;
      lineY = 0;
      continue;
    }

    if (match[11] !== undefined) {
      // A `TJ` array interleaves strings with kerning numbers. The numbers move
      // the pen and, when large enough, are the space between two words that
      // were never written with one.
      const text = [...match[11].matchAll(/\((?:[^)\\]|\\.)*\)|-?[\d.]+/g)]
        .map((piece) => {
          const token = piece[0];
          if (token.startsWith('(')) return decodePdfString(token.slice(1, -1));
          return Number(token) < -180 ? ' ' : '';
        })
        .join('');
      if (text.trim() !== '') fragments.push({ x, y, text });
      continue;
    }

    if (match[12] !== undefined) {
      const text = decodePdfString(match[12]);
      if (text.trim() !== '') fragments.push({ x, y, text });
      if (match[13] === "'") {
        lineY -= leading;
        x = lineX;
        y = lineY;
      }
      continue;
    }

    if (match[14] !== undefined) {
      const text = decodeHexString(match[14]);
      if (text.trim() !== '') fragments.push({ x, y, text });
    }
  }

  return fragments;
}

/** Fragments on one line, ordered, with column gaps rendered as spaces. */
function joinLine(fragments: readonly Fragment[]): string {
  const ordered = [...fragments].sort((a, b) => a.x - b.x);

  let line = '';
  let previousX: number | null = null;

  for (const fragment of ordered) {
    if (previousX !== null && fragment.x - previousX > COLUMN_GAP && !line.endsWith(' ')) {
      line += ' ';
    }
    line += fragment.text;
    // Widths are not tracked, so the next gap is measured from where this
    // fragment started. It over-inserts a space now and then, which the
    // whitespace collapse below removes.
    previousX = fragment.x;
  }

  return line.replace(/\s+/g, ' ').trim();
}

function decodePdfString(value: string): string {
  return value.replace(/\\(n|r|t|b|f|\(|\)|\\|[0-7]{1,3})/g, (_, escape: string) => {
    switch (escape) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'b':
      case 'f':
        return '';
      case '(':
        return '(';
      case ')':
        return ')';
      case '\\':
        return '\\';
      default:
        return String.fromCharCode(parseInt(escape, 8));
    }
  });
}

/**
 * A hex string, guessed between one-byte and two-byte encodings.
 *
 * A composite font writes UTF-16 code units and a simple font writes bytes.
 * Without reading the font's `ToUnicode` map the only tell is the leading byte
 * of each pair, and Latin text in UTF-16BE starts every pair with a zero.
 */
function decodeHexString(value: string): string {
  const digits = value.replace(/\s+/g, '');
  if (digits.length % 4 === 0 && /^(00[0-9A-Fa-f]{2})+$/.test(digits)) {
    let text = '';
    for (let index = 0; index < digits.length; index += 4) {
      text += String.fromCharCode(parseInt(digits.slice(index, index + 4), 16));
    }
    return text;
  }

  let text = '';
  for (let index = 0; index + 1 < digits.length; index += 2) {
    text += String.fromCharCode(parseInt(digits.slice(index, index + 2), 16));
  }
  return text;
}
