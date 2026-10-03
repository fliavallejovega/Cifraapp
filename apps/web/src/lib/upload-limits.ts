/**
 * Upload sizes, shared by the browser and the server.
 *
 * A request to a server action stops at 4 MB (Vercel caps it at 4.5), so a
 * bank PDF heavier than that used to bounce at the door. It now travels in
 * pieces under that cap, each stored as it arrives, and the server joins them
 * once the last one is in. The pieces are smaller than the cap on purpose: the
 * form encoding around each one costs a few kilobytes.
 */

/** Size of one piece. A file at or under it travels whole, in one request. */
export const UPLOAD_CHUNK_BYTES = 3_500_000;

/** Anything larger is a document nobody exports from a bank. */
export const MAX_STATEMENT_BYTES = 15 * 1024 * 1024;

/** 15 MB in 3.5 MB pieces. */
export const MAX_UPLOAD_PARTS = Math.ceil(MAX_STATEMENT_BYTES / UPLOAD_CHUNK_BYTES);
