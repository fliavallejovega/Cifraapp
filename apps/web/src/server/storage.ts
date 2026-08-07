import 'server-only';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Private document storage on Cloudflare R2.
 *
 * Nothing here is ever public. A bank statement in a public bucket is a data
 * breach that needs no attacker — a search engine will do. Reads go through a
 * signed URL with a short expiry, and the key is namespaced by household so an
 * enumeration attempt against the bucket cannot walk from one tenant to
 * another (spec §46, §122).
 */

const SIGNED_URL_TTL_SECONDS = 300;

/** Prefixes, per the storage architecture. Documents are the private ones. */
export type StoragePrefix = 'documents' | 'receipts' | 'reports' | 'exports' | 'marketing';

interface StorageConfig {
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

let cached: { client: S3Client; bucket: string } | undefined;

function config(): StorageConfig {
  /* eslint-disable no-restricted-properties -- R2 credentials are read here for
     the same reason database credentials are read in @app/validation/env: one
     module, one place, nothing scattered. */
  const endpoint = process.env['R2_ENDPOINT'];
  const bucket = process.env['R2_BUCKET'];
  const accessKeyId = process.env['R2_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['R2_SECRET_ACCESS_KEY'];
  /* eslint-enable no-restricted-properties */

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Document storage is not configured. Set R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.',
    );
  }

  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

function storage(): { client: S3Client; bucket: string } {
  if (cached) return cached;

  const { endpoint, bucket, accessKeyId, secretAccessKey } = config();

  cached = {
    // R2 is S3-compatible but has no regions; `auto` is what it expects.
    client: new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
  };

  return cached;
}

/**
 * Builds an object key.
 *
 * The household comes first so that a bucket listing is partitioned by tenant,
 * and the document id — a UUID v7 — supplies both uniqueness and time ordering.
 * The original filename is never part of the key: users name files after
 * themselves, and a key is not a place for a person's name.
 */
export function buildStorageKey(
  prefix: StoragePrefix,
  householdId: string,
  documentId: string,
  extension: string,
): string {
  const safeExtension = extension
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
    .slice(0, 8);
  return `${prefix}/${householdId}/${documentId}${safeExtension ? `.${safeExtension}` : ''}`;
}

export async function putDocument(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const { client, bucket } = storage();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Belt and braces: even if a bucket policy were loosened by accident,
      // this asks intermediaries not to keep a copy.
      CacheControl: 'private, no-store',
    }),
  );
}

/**
 * A short-lived URL for one object.
 *
 * Five minutes because the only legitimate use is a user clicking through to a
 * document they are already looking at. A long expiry turns a URL that leaks
 * into a lasting hole (spec §46).
 */
export async function getDocumentUrl(key: string): Promise<string> {
  const { client, bucket } = storage();

  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: SIGNED_URL_TTL_SECONDS,
  });
}

export async function deleteDocument(key: string): Promise<void> {
  const { client, bucket } = storage();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export function isStorageConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}
