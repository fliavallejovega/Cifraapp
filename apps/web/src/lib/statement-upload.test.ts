import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  importStatement: vi.fn(),
  beginStatementUpload: vi.fn(),
  uploadStatementPart: vi.fn(),
  finishStatementUpload: vi.fn(),
}));

vi.mock('../server/import-actions', () => actions);

import { uploadStatement } from './statement-upload';
import { MAX_STATEMENT_BYTES, MAX_UPLOAD_PARTS, UPLOAD_CHUNK_BYTES } from './upload-limits';

/**
 * The 4 MB door.
 *
 * A bank PDF over four megabytes used to fail after the whole upload, with an
 * error that said nothing about size. These pin the two routes a file can take
 * and the guard that stops a duplicate before it travels.
 */

function fileOf(bytes: number, name = 'estado.pdf', type = 'application/pdf'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
});

describe('uploadStatement', () => {
  it('sends a file that fits in one request whole, through the usual action', async () => {
    actions.importStatement.mockResolvedValue({ jobId: 'job-1' });

    const result = await uploadStatement(fileOf(1_000), { accountId: 'acc', locale: 'es' });

    expect(result).toEqual({ jobId: 'job-1' });
    expect(actions.importStatement).toHaveBeenCalledOnce();
    expect(actions.beginStatementUpload).not.toHaveBeenCalled();
  });

  it('types a file the phone handed over without a type', async () => {
    actions.importStatement.mockResolvedValue({ jobId: 'job-1' });

    await uploadStatement(fileOf(1_000, 'estado.pdf', ''), { accountId: 'acc', locale: 'es' });

    const form = actions.importStatement.mock.calls[0]?.[1] as FormData;
    expect((form.get('file') as File).type).toBe('application/pdf');
  });

  it('sends a heavier file in pieces and asks the server to join them', async () => {
    actions.beginStatementUpload.mockResolvedValue({ uploadId: 'up-1' });
    actions.uploadStatementPart.mockResolvedValue({});
    actions.finishStatementUpload.mockResolvedValue({ jobId: 'job-2' });

    const size = UPLOAD_CHUNK_BYTES * 2 + 10;
    const result = await uploadStatement(fileOf(size), { accountId: 'acc', locale: 'en' });

    expect(result).toEqual({ jobId: 'job-2' });
    expect(actions.uploadStatementPart).toHaveBeenCalledTimes(3);
    const sizes = actions.uploadStatementPart.mock.calls.map(
      ([form]) => ((form as FormData).get('part') as Blob).size,
    );
    expect(sizes).toEqual([UPLOAD_CHUNK_BYTES, UPLOAD_CHUNK_BYTES, 10]);
    expect(actions.finishStatementUpload).toHaveBeenCalledWith(
      expect.objectContaining({ uploadId: 'up-1', parts: 3, accountId: 'acc', locale: 'en' }),
    );
    const begun = actions.beginStatementUpload.mock.calls[0]?.[0] as { contentHash: string };
    expect(begun.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stops before sending anything when the server already has the file', async () => {
    actions.beginStatementUpload.mockResolvedValue({ error: 'alreadyImported' });

    const result = await uploadStatement(fileOf(UPLOAD_CHUNK_BYTES + 1), {
      accountId: 'acc',
      locale: 'es',
    });

    expect(result).toEqual({ error: 'alreadyImported' });
    expect(actions.uploadStatementPart).not.toHaveBeenCalled();
  });

  it('retries a piece once when storage blinks', async () => {
    actions.beginStatementUpload.mockResolvedValue({ uploadId: 'up-1' });
    actions.uploadStatementPart
      .mockResolvedValueOnce({ error: 'storageUnavailable' })
      .mockResolvedValue({});
    actions.finishStatementUpload.mockResolvedValue({ jobId: 'job-3' });

    const result = await uploadStatement(fileOf(UPLOAD_CHUNK_BYTES + 1), {
      accountId: 'acc',
      locale: 'es',
    });

    expect(result).toEqual({ jobId: 'job-3' });
    expect(actions.uploadStatementPart).toHaveBeenCalledTimes(3);
  });

  it('refuses a file over 15 MB without a single request', async () => {
    const result = await uploadStatement(fileOf(MAX_STATEMENT_BYTES + 1), {
      accountId: 'acc',
      locale: 'es',
    });

    expect(result).toEqual({ error: 'tooLarge' });
    expect(Object.values(actions).every((action) => action.mock.calls.length === 0)).toBe(true);
  });

  it('fits the largest allowed file in the parts the server accepts', () => {
    expect(Math.ceil(MAX_STATEMENT_BYTES / UPLOAD_CHUNK_BYTES)).toBeLessThanOrEqual(
      MAX_UPLOAD_PARTS,
    );
  });
});
