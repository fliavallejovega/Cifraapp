import { inflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { toPdf } from './pdf-writer.js';
import { toXlsx } from './xlsx-writer.js';

/**
 * The binary exporters.
 *
 * Both are checked by reading the bytes back rather than by snapshotting them:
 * a snapshot of a ZIP proves the output did not change, and proves nothing
 * about whether Excel can open it.
 */

/** Reads one file out of a ZIP the writer produced. */
function readEntry(archive: Uint8Array, name: string): string {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

  let end = -1;
  for (let offset = archive.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  expect(end).toBeGreaterThanOrEqual(0);

  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);

  for (let index = 0; index < count; index += 1) {
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const compressedSize = view.getUint32(cursor + 20, true);

    const entryName = new TextDecoder().decode(
      archive.subarray(cursor + 46, cursor + 46 + nameLength),
    );

    if (entryName === name) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      return new TextDecoder().decode(
        inflateRawSync(archive.subarray(start, start + compressedSize)),
      );
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`no entry named ${name}`);
}

describe('xlsx export', () => {
  const workbook = toXlsx({
    name: 'Movimientos',
    headers: ['Fecha', 'Detalle', 'Monto'],
    rows: [
      [
        { kind: 'date', value: '2026-09-01' },
        { kind: 'text', value: 'SUPER 99 & CO' },
        { kind: 'number', value: '-84.3500' },
      ],
      [
        { kind: 'date', value: '2026-09-02' },
        { kind: 'text', value: 'PAGO SALARIO' },
        { kind: 'number', value: '2400.0000' },
      ],
    ],
  });

  it('produces an archive with the parts Excel requires', () => {
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]) {
      expect(() => readEntry(workbook, part)).not.toThrow();
    }
  });

  it('writes amounts as numbers, not as text', () => {
    const sheet = readEntry(workbook, 'xl/worksheets/sheet1.xml');

    // No `t="inlineStr"` on the amount cell, and the decimal string verbatim.
    expect(sheet).toContain('<c r="C2"><v>-84.3500</v></c>');
    expect(sheet).toContain('<c r="C3"><v>2400.0000</v></c>');
  });

  it('writes dates as date-formatted serials', () => {
    const sheet = readEntry(workbook, 'xl/worksheets/sheet1.xml');

    // 2026-09-01 is serial 46266, and style 1 is the date format.
    expect(sheet).toContain('<c r="A2" s="1"><v>46266</v></c>');
  });

  it('escapes what would otherwise make the file unopenable', () => {
    const sheet = readEntry(workbook, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('SUPER 99 &amp; CO');
  });

  it('keeps the sheet name inside what Excel accepts', () => {
    const long = toXlsx({
      name: 'A name that is very much longer than thirty-one characters [x]',
      headers: ['a'],
      rows: [],
    });

    const name = /name="([^"]+)"/.exec(readEntry(long, 'xl/workbook.xml'))?.[1] ?? '';
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toContain('[');
  });
});

describe('pdf export', () => {
  const rows = Array.from({ length: 120 }, (_, index) => [
    `2026-09-${String((index % 28) + 1).padStart(2, '0')}`,
    `Movement ${String(index)}`,
    '-84.35',
  ]);

  const pdf = toPdf({
    title: 'Estado de cuenta',
    subtitle: 'Familia Vallejo · septiembre 2026',
    columns: [
      { header: 'Fecha', width: 0.2 },
      { header: 'Detalle', width: 0.55 },
      { header: 'Monto', width: 0.25, align: 'right', numeric: true },
    ],
    rows,
    footer: 'Total: -10,122.00',
    generatedNote: 'Generado por Cifrapp',
  });

  const source = new TextDecoder('latin1').decode(pdf);

  it('is a PDF', () => {
    expect(source.startsWith('%PDF-1.4')).toBe(true);
    expect(source.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('paginates rather than silently dropping rows', () => {
    const pageCount = [...source.matchAll(/\/Type \/Page[^s]/g)].length;
    expect(pageCount).toBeGreaterThan(1);

    // The last row must appear somewhere in the document.
    expect(source).toContain('Movement 119');
  });

  it('declares a cross-reference table whose offsets land on objects', () => {
    const startxref = Number(/startxref\n(\d+)/.exec(source)?.[1] ?? '0');
    expect(source.slice(startxref, startxref + 4)).toBe('xref');

    for (const match of source.matchAll(/^(\d{10}) 00000 n $/gm)) {
      const offset = Number(match[1]);
      expect(source.slice(offset)).toMatch(/^\d+ 0 obj/);
    }
  });

  it('escapes parentheses, which would otherwise end a string early', () => {
    const risky = toPdf({
      title: 'Test',
      columns: [{ header: 'a', width: 1 }],
      rows: [['A merchant (with parens) and a \\ backslash']],
      generatedNote: 'note',
    });

    const text = new TextDecoder('latin1').decode(risky);
    expect(text).toContain('\\(with parens\\)');
    expect(text).toContain('\\\\ backslash');
  });

  it('keeps accented Spanish and drops what Latin-1 cannot carry', () => {
    const accented = toPdf({
      title: 'Año',
      columns: [{ header: 'a', width: 1 }],
      rows: [['Cañita · 日本']],
      generatedNote: 'note',
    });

    const text = new TextDecoder('latin1').decode(accented);
    expect(text).toContain('Cañita');
    expect(text).toContain('??');
  });
});
