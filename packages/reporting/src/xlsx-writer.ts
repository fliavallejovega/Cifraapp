import { deflateRawSync } from 'node:zlib';

/**
 * Writing a spreadsheet, without a spreadsheet library.
 *
 * An accountant asks for Excel. CSV opens in Excel and then loses everything a
 * spreadsheet is for: a date column reads as text in one locale and as a date
 * in another, and a decimal with a comma in it silently becomes a string that
 * sums to zero. A real `.xlsx` carries the type of every cell.
 *
 * An `.xlsx` is a ZIP of six small XML files, and Node deflates. A library
 * would bring formulas, charts, styling and a supply chain to save the hundred
 * and fifty lines below, none of which will change again.
 *
 * Numbers are written from their decimal string straight into the XML. They
 * never pass through a JavaScript number on the way, which is the one thing
 * that could put a rounding error into an exported ledger.
 */

export type CellValue =
  | { readonly kind: 'text'; readonly value: string }
  /** A decimal string. Never a JS number — that is the whole point. */
  | { readonly kind: 'number'; readonly value: string }
  /** An ISO calendar date. Written as a date-formatted serial. */
  | { readonly kind: 'date'; readonly value: string };

export interface SheetSpec {
  readonly name: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly CellValue[])[];
}

/** Excel's epoch, with the 1900 leap-year bug it has never fixed. */
const EXCEL_EPOCH_OFFSET_DAYS = 25_569;
const MILLIS_PER_DAY = 86_400_000;

/** Style 1 is the date format; style 2 is bold, for the header row. */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

export function toXlsx(sheet: SheetSpec): Uint8Array {
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName(sheet.name))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  return zip([
    { name: '[Content_Types].xml', content: CONTENT_TYPES },
    { name: '_rels/.rels', content: ROOT_RELS },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: WORKBOOK_RELS },
    { name: 'xl/styles.xml', content: STYLES },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml(sheet) },
  ]);
}

/**
 * Excel refuses a sheet name over 31 characters or containing `[]:*?/\`.
 * Silently, by refusing to open the file at all.
 */
function sheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, ' ').trim();
  return (cleaned === '' ? 'Sheet1' : cleaned).slice(0, 31);
}

function sheetXml(sheet: SheetSpec): string {
  const rows: string[] = [];

  rows.push(
    `<row r="1">${sheet.headers
      .map(
        (header, index) =>
          `<c r="${ref(index, 1)}" t="inlineStr" s="2"><is><t>${escapeXml(header)}</t></is></c>`,
      )
      .join('')}</row>`,
  );

  sheet.rows.forEach((row, rowIndex) => {
    const number = rowIndex + 2;
    const cells = row.map((cell, columnIndex) => cellXml(cell, ref(columnIndex, number))).join('');
    rows.push(`<row r="${String(number)}">${cells}</row>`);
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${rows.join('')}</sheetData>
</worksheet>`;
}

function cellXml(cell: CellValue, reference: string): string {
  if (cell.kind === 'number') {
    // Written verbatim from the decimal string. An unreadable value becomes an
    // empty cell rather than a zero, because a zero is a claim.
    return /^-?\d+(\.\d+)?$/.test(cell.value)
      ? `<c r="${reference}"><v>${cell.value}</v></c>`
      : `<c r="${reference}"/>`;
  }

  if (cell.kind === 'date') {
    const serial = dateSerial(cell.value);
    return serial === null
      ? `<c r="${reference}"/>`
      : `<c r="${reference}" s="1"><v>${String(serial)}</v></c>`;
  }

  return cell.value === ''
    ? `<c r="${reference}"/>`
    : `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(cell.value)}</t></is></c>`;
}

function dateSerial(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const millis = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(millis)) return null;
  return Math.round(millis / MILLIS_PER_DAY) + EXCEL_EPOCH_OFFSET_DAYS;
}

/** `A1`, `AA7`. Spreadsheet columns are base-26 with no zero. */
function ref(columnIndex: number, row: number): string {
  let column = '';
  let index = columnIndex;

  do {
    column = String.fromCharCode(65 + (index % 26)) + column;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);

  return `${column}${String(row)}`;
}

function escapeXml(value: string): string {
  return (
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Control characters are not legal XML, and Excel responds by refusing to
      // open the file at all rather than by complaining about a character. The
      // rule that forbids them in a pattern is right about every other case;
      // stripping them is exactly what has to happen here.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  );
}

/**
 * A ZIP archive: DEFLATE, no data descriptors, no ZIP64, no encryption.
 *
 * A spreadsheet is a handful of small files. The general case is somebody
 * else's problem.
 */
function zip(files: readonly { name: string; content: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const raw = encoder.encode(file.content);
    const compressed = new Uint8Array(deflateRawSync(raw));
    const crc = crc32(raw);

    const local = new Uint8Array(30 + nameBytes.length + compressed.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 8, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, compressed.length, true);
    localView.setUint32(22, raw.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(compressed, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, 8, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, compressed.length, true);
    centralView.setUint32(24, raw.length, true);
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

  const archive = new Uint8Array(offset + centralSize + 22);
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

/**
 * CRC-32, table-free.
 *
 * Excel checks it. A ZIP with the right bytes and a wrong checksum opens
 * nowhere, and the failure gives no clue what is wrong with the file.
 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}
