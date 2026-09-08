import { deflateRawSync, deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { StatementParseError } from '../types.js';

import { extractPdfLines, parsePdfStatement } from './pdf.js';
import { parseXlsxStatement, readXlsxSheet } from './xlsx.js';

/**
 * The binary statement readers.
 *
 * Both are tested against real files built here rather than fixtures checked
 * into the repository: a bank statement is a PII fixture and does not belong in
 * git. Building the bytes in the test also states the format's shape out loud,
 * which is the part a future reader will need.
 */

// ---------------------------------------------------------------------------
// A minimal but genuine .xlsx
// ---------------------------------------------------------------------------

function zipOf(files: readonly { name: string; content: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const contentBytes = encoder.encode(file.content);
    const compressed = new Uint8Array(deflateRawSync(contentBytes));

    const local = new Uint8Array(30 + nameBytes.length + compressed.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 8, true);
    localView.setUint32(18, compressed.length, true);
    localView.setUint32(22, contentBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(compressed, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, 8, true);
    centralView.setUint32(20, compressed.length, true);
    centralView.setUint32(24, contentBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const archive = new Uint8Array(total);
  let cursor = 0;
  for (const local of locals) {
    archive.set(local, cursor);
    cursor += local.length;
  }
  for (const central of centrals) {
    archive.set(central, cursor);
    cursor += central.length;
  }
  archive.set(end, cursor);

  return archive;
}

const SHARED_STRINGS = `<?xml version="1.0"?><sst count="6" uniqueCount="6">
  <si><t>Fecha</t></si>
  <si><t>Descripcion</t></si>
  <si><t>Monto</t></si>
  <si><t>SUPER 99 VIA ESPANA</t></si>
  <si><t>PAGO SALARIO</t></si>
  <si><t>FARMACIA ARROCHA</t></si>
</sst>`;

const STYLES = `<?xml version="1.0"?><styleSheet>
  <cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs>
</styleSheet>`;

/** Row 1 is the header; the dates are Excel serials wearing a date format. */
const SHEET = `<?xml version="1.0"?><worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
  <row r="2"><c r="A2" s="1"><v>46266</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>-84.35</v></c></row>
  <row r="3"><c r="A3" s="1"><v>46267</v></c><c r="B3" t="s"><v>4</v></c><c r="C3"><v>2400</v></c></row>
  <row r="4"><c r="A4" s="1"><v>46268</v></c><c r="B4" t="s"><v>5</v></c><c r="C4"><v>-19.9</v></c></row>
</sheetData></worksheet>`;

function statementWorkbook(): Uint8Array {
  return zipOf([
    { name: 'xl/sharedStrings.xml', content: SHARED_STRINGS },
    { name: 'xl/styles.xml', content: STYLES },
    { name: 'xl/worksheets/sheet1.xml', content: SHEET },
  ]);
}

describe('xlsx statements', () => {
  it('reads a sheet into a grid, resolving shared strings', () => {
    const rows = readXlsxSheet(statementWorkbook());

    expect(rows[0]).toEqual(['Fecha', 'Descripcion', 'Monto']);
    expect(rows[1]?.[1]).toBe('SUPER 99 VIA ESPANA');
  });

  it('converts a date-formatted serial back to a calendar date', () => {
    const rows = readXlsxSheet(statementWorkbook());

    // 46266 is 2026-09-01. Read as a bare number it would be nonsense.
    expect(rows[1]?.[0]).toBe('2026-09-01');
  });

  it('parses the sheet into candidate transactions', () => {
    const parsed = parseXlsxStatement(statementWorkbook(), {
      accountId: '11111111-1111-7111-8111-111111111111',
      currency: 'USD',
    });

    expect(parsed.format).toBe('xlsx');
    expect(parsed.transactions).toHaveLength(3);
    expect(parsed.transactions[0]?.amount.toDecimalString()).toBe('-84.3500');
    expect(parsed.transactions[0]?.direction).toBe('outflow');
    expect(parsed.transactions[1]?.direction).toBe('inflow');
  });

  it('refuses a file that is not an archive rather than returning nothing', () => {
    expect(() =>
      parseXlsxStatement(new TextEncoder().encode('Fecha,Monto\n01/09/2026,10.00'), {
        accountId: 'a',
        currency: 'USD',
      }),
    ).toThrow(StatementParseError);
  });
});

// ---------------------------------------------------------------------------
// A minimal but genuine PDF with a text layer
// ---------------------------------------------------------------------------

/**
 * Builds a one-page PDF whose content stream draws the given lines.
 *
 * Each line is placed with its own `Tm`, and the columns within a line with
 * separate `Td` offsets, which is exactly how a bank's generator emits a table
 * and exactly the case the extractor has to survive.
 */
function pdfOf(lines: readonly (readonly string[])[], compress = true): Uint8Array {
  let content = '';
  let y = 700;

  for (const columns of lines) {
    content += `BT /F1 10 Tf 1 0 0 1 60 ${String(y)} Tm\n`;
    let x = 60;
    for (const column of columns) {
      content += `1 0 0 1 ${String(x)} ${String(y)} Tm (${column.replace(/([()\\])/g, '\\$1')}) Tj\n`;
      x += 140;
    }
    content += 'ET\n';
    y -= 16;
  }

  const encoder = new TextEncoder();
  const raw = encoder.encode(content);
  const body = compress ? new Uint8Array(deflateSync(raw)) : raw;
  const filter = compress ? '/Filter /FlateDecode ' : '';

  const header = encoder.encode(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n<< ${filter}/Length ${String(body.length)} >>\nstream\n`,
  );
  const footer = encoder.encode('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');

  const pdf = new Uint8Array(header.length + body.length + footer.length);
  pdf.set(header, 0);
  pdf.set(body, header.length);
  pdf.set(footer, header.length + body.length);
  return pdf;
}

const STATEMENT_LINES = [
  ['ESTADO DE CUENTA', 'BANCO GENERAL'],
  ['Fecha', 'Descripcion', 'Monto', 'Saldo'],
  ['01/09/2026', 'SUPER 99 VIA ESPANA', '84.35', '3,915.65'],
  ['02/09/2026', 'PAGO SALARIO', '2,400.00', '6,315.65'],
  ['03/09/2026', 'FARMACIA ARROCHA', '19.90', '6,295.75'],
];

describe('pdf statements', () => {
  it('recovers the text layer as ordered lines', () => {
    const lines = extractPdfLines(pdfOf(STATEMENT_LINES));

    expect(lines[0]).toContain('ESTADO DE CUENTA');
    expect(lines[2]).toContain('SUPER 99 VIA ESPANA');
    expect(lines[2]).toContain('3,915.65');
  });

  it('reads an uncompressed stream as well as a deflated one', () => {
    const lines = extractPdfLines(pdfOf(STATEMENT_LINES, false));
    expect(lines[2]).toContain('SUPER 99');
  });

  it('takes the direction from the running balance, not from the words', () => {
    const parsed = parsePdfStatement(pdfOf(STATEMENT_LINES), {
      accountId: '11111111-1111-7111-8111-111111111111',
      currency: 'USD',
    });

    expect(parsed.transactions).toHaveLength(3);

    // The first line has no previous balance to compare against, so it falls
    // back to «a statement line is a charge».
    expect(parsed.transactions[0]?.direction).toBe('outflow');
    // The balance rose, so the salary is an inflow whatever the wording says.
    expect(parsed.transactions[1]?.direction).toBe('inflow');
    expect(parsed.transactions[1]?.amount.toDecimalString()).toBe('2400.0000');
    // And it fell again.
    expect(parsed.transactions[2]?.direction).toBe('outflow');
    expect(parsed.transactions[2]?.amount.toDecimalString()).toBe('-19.9000');
  });

  it('ignores dated lines that carry no figure', () => {
    const parsed = parsePdfStatement(
      pdfOf([
        ['Fecha', 'Descripcion', 'Monto', 'Saldo'],
        ['01/09/2026', 'RESUMEN DEL PERIODO'],
        ['01/09/2026', 'SUPER 99', '84.35', '3,915.65'],
      ]),
      { accountId: 'a', currency: 'USD' },
    );

    expect(parsed.transactions).toHaveLength(1);
  });

  it('says a scan needs OCR instead of reporting an empty statement', () => {
    const encoder = new TextEncoder();
    const scan = encoder.encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');

    expect(() => extractPdfLines(scan)).toThrow(/OCR/);
  });

  it('refuses a password-protected document by name', () => {
    const encoder = new TextEncoder();
    const locked = encoder.encode('%PDF-1.4\ntrailer\n<< /Encrypt 9 0 R >>\n%%EOF\n');

    expect(() => extractPdfLines(locked)).toThrow(/password/i);
  });
});
