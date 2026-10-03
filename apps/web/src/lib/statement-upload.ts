import {
  beginStatementUpload,
  finishStatementUpload,
  importStatement,
  uploadStatementPart,
  type ImportActionResult,
} from '../server/import-actions';

import { shrinkImage } from './shrink-image';
import { MAX_STATEMENT_BYTES, UPLOAD_CHUNK_BYTES } from './upload-limits';

/**
 * Sending one statement from the browser, whatever its size.
 *
 * A file that fits in one request goes whole through the same action the form
 * always used. A heavier one asks first — which also catches a statement
 * already uploaded, before fifteen megabytes cross a phone connection — then
 * travels in pieces, and the server joins them.
 *
 * Phone screenshots of a bank app are tall: 2,800 px is the long side of a
 * current iPhone screen, so a screenshot keeps every line and a photo of paper
 * still shrinks.
 */

const SCREENSHOT_SIDE = 2800;

export type UploadStage = 'preparing' | 'sending' | 'queued';

export interface UploadProgress {
  readonly stage: UploadStage;
  /** 0 to 1, over the bytes sent. */
  readonly fraction: number;
}

export async function uploadStatement(
  original: File,
  options: {
    readonly accountId: string;
    readonly locale: string;
    readonly onProgress?: (progress: UploadProgress) => void;
  },
): Promise<ImportActionResult> {
  const report = options.onProgress ?? (() => undefined);
  report({ stage: 'preparing', fraction: 0 });

  const file = await shrinkImage(original, SCREENSHOT_SIDE);
  if (file.size === 0) return { error: 'unsupportedType' };
  if (file.size > MAX_STATEMENT_BYTES) return { error: 'tooLarge' };

  const mimeType = file.type || guessType(file.name);

  if (file.size <= UPLOAD_CHUNK_BYTES) {
    report({ stage: 'sending', fraction: 0 });
    const form = new FormData();
    // Typed explicitly: a phone that hands over a PDF with no type would
    // otherwise reach the server looking like a CSV.
    form.set('file', file.type ? file : new File([file], file.name, { type: mimeType }));
    form.set('accountId', options.accountId);
    form.set('locale', options.locale);
    const result = await importStatement({}, form);
    if (result.jobId) report({ stage: 'queued', fraction: 1 });
    return result;
  }

  const begun = await beginStatementUpload({
    accountId: options.accountId,
    byteSize: file.size,
    mimeType,
    contentHash: await sha256Hex(file),
  });
  if (!begun.uploadId) return { error: begun.error ?? 'generic' };

  const parts = Math.ceil(file.size / UPLOAD_CHUNK_BYTES);
  for (let index = 0; index < parts; index += 1) {
    report({ stage: 'sending', fraction: index / parts });
    const form = new FormData();
    form.set('uploadId', begun.uploadId);
    form.set('index', String(index));
    form.set(
      'part',
      file.slice(index * UPLOAD_CHUNK_BYTES, (index + 1) * UPLOAD_CHUNK_BYTES),
      'part',
    );
    const sent = await sendPart(form);
    if (sent.error) return { error: sent.error };
  }

  report({ stage: 'sending', fraction: 1 });
  const result = await finishStatementUpload({
    uploadId: begun.uploadId,
    parts,
    accountId: options.accountId,
    fileName: file.name,
    mimeType,
    locale: options.locale,
  });
  if (result.jobId) report({ stage: 'queued', fraction: 1 });
  return result;
}

/** One retry: a phone that changes cell tower mid-upload should not lose the file. */
async function sendPart(form: FormData): Promise<{ readonly error?: string }> {
  try {
    const first = await uploadStatementPart(form);
    if (first.error !== 'storageUnavailable') return first;
  } catch {
    // Network dropped; try once more below.
  }
  try {
    return await uploadStatementPart(form);
  } catch {
    return { error: 'storageUnavailable' };
  }
}

/** Hex SHA-256 of the file, or '' where the browser cannot compute one. */
async function sha256Hex(file: Blob): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  } catch {
    return '';
  }
}

/** Some phones hand over a PDF or an OFX with no type at all. */
function guessType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const known: Record<string, string> = {
    pdf: 'application/pdf',
    csv: 'text/csv',
    ofx: 'application/x-ofx',
    qfx: 'application/x-ofx',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  };
  return known[extension] ?? 'application/octet-stream';
}
