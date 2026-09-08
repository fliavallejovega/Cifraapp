import { inflateRawSync, inflateSync } from 'node:zlib';

/**
 * Just enough ZIP to read a spreadsheet.
 *
 * An `.xlsx` is a ZIP archive of XML, and several Panamanian banks export
 * nothing else. Reading it needs three things — the central directory, the
 * local headers, and raw DEFLATE — and Node has the third built in. A library
 * would bring a hundred features this product will never use, plus a supply
 * chain, to save a hundred lines that will not change again.
 *
 * Deliberately narrow: no encryption, no ZIP64, no spanned archives. A file
 * that needs any of those is not a bank statement, and is refused rather than
 * half-read.
 */

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;

export interface ZipEntry {
  readonly name: string;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

/** Reads the central directory: what the archive contains and where. */
export function readZipEntries(bytes: Uint8Array): readonly ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end record sits at the very end, after a comment of up to 64KB. Scanned
  // backwards, because that is where it is and forwards would find a signature
  // that happens to appear inside compressed data.
  let end = -1;
  const earliest = Math.max(0, bytes.byteLength - 0xffff - 22);
  for (let offset = bytes.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) {
      end = offset;
      break;
    }
  }

  if (end === -1) throw new ZipError('The file is not a readable ZIP archive.');

  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);

  const entries: ZipEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.byteLength) throw new ZipError('The archive index is truncated.');
    if (view.getUint32(cursor, true) !== CENTRAL_FILE_HEADER) {
      throw new ZipError('The archive index is malformed.');
    }

    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    const name = new TextDecoder('utf-8').decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Inflates one entry. Returns null when the archive does not contain it. */
export function readZipFile(bytes: Uint8Array, name: string): string | null {
  const entry = readZipEntries(bytes).find((candidate) => candidate.name === name);
  if (!entry) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;

  // The local header repeats the name and extra fields, and its lengths are the
  // authoritative ones — a writer may put different extra data in each place.
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;

  const compressed = bytes.subarray(start, start + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return new TextDecoder('utf-8').decode(compressed);
  }

  if (entry.compressionMethod !== 8) {
    throw new ZipError(`The archive uses an unsupported compression method.`);
  }

  return new TextDecoder('utf-8').decode(inflateRawSync(compressed));
}

/** `inflate` with a zlib header, used by PDF streams rather than by ZIP. */
export function inflateZlib(bytes: Uint8Array): Uint8Array {
  try {
    return new Uint8Array(inflateSync(bytes));
  } catch {
    // Some producers omit the two-byte zlib header. Raw DEFLATE is the same
    // data without it, and trying it is cheaper than refusing the document.
    return new Uint8Array(inflateRawSync(bytes));
  }
}
