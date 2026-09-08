/**
 * Writing a PDF, without a PDF library.
 *
 * A statement a household forwards to a landlord, a bank or an accountant has
 * to be a PDF. CSV is for machines and a screenshot is not a document.
 *
 * This produces the narrow thing a financial statement actually needs: a titled
 * page, a ruled table, right-aligned figures in a monospaced face, and a footer
 * saying what produced it and when. No images, no embedded fonts, no vector
 * graphics — Helvetica and Courier are the two of the fourteen standard faces
 * every reader has had since 1993, so nothing has to be embedded.
 *
 * Pagination is real: a year of movements is several hundred rows, and a
 * one-page PDF that silently stops at row forty would be worse than no export.
 */

export interface PdfColumn {
  readonly header: string;
  /** Fraction of the usable width, 0–1. They should sum to 1. */
  readonly width: number;
  readonly align?: 'left' | 'right';
  /** Figures are set in a monospaced face so columns of them line up. */
  readonly numeric?: boolean;
}

export interface PdfTableSpec {
  readonly title: string;
  readonly subtitle?: string;
  readonly columns: readonly PdfColumn[];
  readonly rows: readonly (readonly string[])[];
  /** A closing line: totals, or the note about what this is. */
  readonly footer?: string;
  readonly generatedNote: string;
}

/** US Letter, in points. What a Panamanian printer and a US bank both expect. */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;

const TITLE_SIZE = 16;
const SUBTITLE_SIZE = 9.5;
const HEADER_SIZE = 8;
const ROW_SIZE = 9;
const ROW_HEIGHT = 16;

const USABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;

export function toPdf(spec: PdfTableSpec): Uint8Array {
  const pages = paginate(spec);
  const contents = pages.map((rows, index) => pageContent(spec, rows, index + 1, pages.length));

  return assemble(contents);
}

/** How many rows fit under the heading on the first page, and after it. */
function paginate(spec: PdfTableSpec): (readonly (readonly string[])[])[] {
  const firstPageTop = PAGE_HEIGHT - MARGIN - TITLE_SIZE - (spec.subtitle ? 18 : 0) - 34;
  const laterPageTop = PAGE_HEIGHT - MARGIN - 24;
  const bottom = MARGIN + 40;

  const firstCapacity = Math.max(1, Math.floor((firstPageTop - bottom) / ROW_HEIGHT));
  const laterCapacity = Math.max(1, Math.floor((laterPageTop - bottom) / ROW_HEIGHT));

  if (spec.rows.length === 0) return [[]];

  const pages: (readonly (readonly string[])[])[] = [];
  let cursor = 0;

  while (cursor < spec.rows.length) {
    const capacity = pages.length === 0 ? firstCapacity : laterCapacity;
    pages.push(spec.rows.slice(cursor, cursor + capacity));
    cursor += capacity;
  }

  return pages;
}

function pageContent(
  spec: PdfTableSpec,
  rows: readonly (readonly string[])[],
  pageNumber: number,
  pageCount: number,
): string {
  const parts: string[] = [];
  let y = PAGE_HEIGHT - MARGIN;

  if (pageNumber === 1) {
    parts.push(text(MARGIN, y - TITLE_SIZE, spec.title, TITLE_SIZE, 'F1'));
    y -= TITLE_SIZE + 8;

    if (spec.subtitle) {
      parts.push(text(MARGIN, y - SUBTITLE_SIZE, spec.subtitle, SUBTITLE_SIZE, 'F2'));
      y -= SUBTITLE_SIZE + 10;
    }
  } else {
    parts.push(
      text(MARGIN, y - SUBTITLE_SIZE, `${spec.title} (${String(pageNumber)})`, SUBTITLE_SIZE, 'F2'),
    );
    y -= SUBTITLE_SIZE + 10;
  }

  // Column heads, then the rule under them.
  const offsets = columnOffsets(spec.columns);

  spec.columns.forEach((column, index) => {
    const x = offsets[index] ?? MARGIN;
    const width = (spec.columns[index]?.width ?? 0) * USABLE_WIDTH;
    parts.push(
      column.align === 'right'
        ? rightText(x + width, y - HEADER_SIZE, column.header.toUpperCase(), HEADER_SIZE, 'F1')
        : text(x, y - HEADER_SIZE, column.header.toUpperCase(), HEADER_SIZE, 'F1'),
    );
  });

  y -= HEADER_SIZE + 6;
  parts.push(rule(MARGIN, y, PAGE_WIDTH - MARGIN));
  y -= 12;

  for (const row of rows) {
    spec.columns.forEach((column, index) => {
      const value = row[index] ?? '';
      const x = offsets[index] ?? MARGIN;
      const width = column.width * USABLE_WIDTH;
      const font = column.numeric ? 'F3' : 'F2';
      const clipped = clip(value, width, ROW_SIZE, Boolean(column.numeric));

      parts.push(
        column.align === 'right'
          ? rightText(x + width, y, clipped, ROW_SIZE, font)
          : text(x, y, clipped, ROW_SIZE, font),
      );
    });

    y -= ROW_HEIGHT;
  }

  if (pageNumber === pageCount && spec.footer) {
    y -= 6;
    parts.push(rule(MARGIN, y + 10, PAGE_WIDTH - MARGIN));
    parts.push(text(MARGIN, y - 4, spec.footer, ROW_SIZE, 'F1'));
  }

  parts.push(
    text(
      MARGIN,
      MARGIN - 12,
      `${spec.generatedNote} · ${String(pageNumber)}/${String(pageCount)}`,
      7.5,
      'F2',
    ),
  );

  return parts.join('\n');
}

function columnOffsets(columns: readonly PdfColumn[]): number[] {
  const offsets: number[] = [];
  let x = MARGIN;

  for (const column of columns) {
    offsets.push(x);
    x += column.width * USABLE_WIDTH;
  }

  return offsets;
}

/**
 * Truncates a value to the column it sits in.
 *
 * Widths are approximated from the font's average advance rather than measured
 * — the standard faces' metrics are a table this file has no business
 * carrying, and an overhang of a character or two is invisible where an
 * overlapping column is not.
 */
function clip(value: string, width: number, size: number, numeric: boolean): string {
  const advance = numeric ? size * 0.6 : size * 0.5;
  const maximum = Math.max(1, Math.floor(width / advance) - 1);

  return value.length <= maximum ? value : `${value.slice(0, Math.max(1, maximum - 1))}…`;
}

function text(x: number, y: number, value: string, size: number, font: string): string {
  return `BT /${font} ${size.toFixed(1)} Tf 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm (${escapePdf(value)}) Tj ET`;
}

/**
 * Right-aligned text, positioned by an estimated width.
 *
 * The same approximation as `clip`, and for the same reason: a figure column
 * that is a point or two off its edge reads correctly, and a metrics table does
 * not belong in an exporter.
 */
function rightText(right: number, y: number, value: string, size: number, font: string): string {
  const advance = font === 'F3' ? size * 0.6 : size * 0.5;
  const x = right - value.length * advance;
  return text(Math.max(MARGIN, x), y, value, size, font);
}

function rule(from: number, y: number, to: number): string {
  return `0.5 w 0.75 0.72 0.68 RG ${from.toFixed(1)} ${y.toFixed(1)} m ${to.toFixed(1)} ${y.toFixed(1)} l S 0 0 0 RG`;
}

/**
 * Latin-1, which is what a PDF literal string is without a font encoding.
 *
 * Accented Spanish survives — «ó» and «ñ» are both in Latin-1 — and anything
 * outside it becomes a question mark rather than a byte the reader interprets
 * as a different letter.
 */
function escapePdf(value: string): string {
  let out = '';

  for (const character of value) {
    const code = character.codePointAt(0) ?? 63;

    if (character === '(' || character === ')' || character === '\\') out += `\\${character}`;
    else if (code < 32) out += ' ';
    else if (code <= 255) out += character;
    else out += '?';
  }

  return out;
}

/** The file: a catalogue, a page tree, three fonts, and one stream per page. */
function assemble(contents: readonly string[]): Uint8Array {
  const objects: string[] = [];

  const pageIds = contents.map((_, index) => 5 + index * 2);

  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(
    `<< /Type /Pages /Count ${String(contents.length)} /Kids [${pageIds
      .map((id) => `${String(id)} 0 R`)
      .join(' ')}] >>`,
  );
  objects.push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
  );
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);

  contents.forEach((content, index) => {
    const contentId = (pageIds[index] ?? 0) + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE_WIDTH)} ${String(PAGE_HEIGHT)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 ${String(contents.length * 2 + 5)} 0 R >> >> ` +
        `/Contents ${String(contentId)} 0 R >>`,
    );
    objects.push(`<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`);
  });

  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`);

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = body.length;
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;

  // Latin-1, matching the encoding declared on every font: a multi-byte
  // encoder here would shift every cross-reference offset by the number of
  // accented characters in the document.
  const bytes = new Uint8Array(body.length);
  for (let index = 0; index < body.length; index += 1) {
    bytes[index] = body.charCodeAt(index) & 0xff;
  }

  return bytes;
}
