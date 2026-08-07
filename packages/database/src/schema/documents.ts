import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  smallint,
  text,
  timestamp,
  uuid,
  char,
} from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import { accounts, transactions } from './financial.js';
import { households, profiles } from './identity.js';

/**
 * Documents and imports, mirroring `20260807040000_documents.sql`.
 *
 * The bytes live in R2; these tables hold the key, the hash and the provenance.
 * Every transaction that came from a file must be traceable back to it — that
 * link is how a person decides whether to trust a figure they did not type.
 */

export const documentKind = pgEnum('document_kind', [
  'bank_statement',
  'card_statement',
  'receipt',
  'invoice',
  'tax_document',
  'loan_statement',
  'contract',
  'other',
]);

export const importStatus = pgEnum('import_status', [
  'uploaded',
  'parsing',
  'review',
  'importing',
  'completed',
  'failed',
  'discarded',
]);

export const documents = appSchema.table(
  'documents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by').references(() => profiles.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    kind: documentKind('kind').notNull().default('bank_statement'),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    /** The R2 object key. Private always; reads go through a signed URL. */
    storageKey: text('storage_key').notNull().unique(),
    /** SHA-256 of the bytes. Catches a re-upload before anything is parsed. */
    contentHash: text('content_hash').notNull(),
    statementPeriodStart: date('statement_period_start'),
    statementPeriodEnd: date('statement_period_end'),
    taxYear: smallint('tax_year'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('documents_household_idx').on(table.householdId, table.createdAt)],
);

export const imports = appSchema.table(
  'imports',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    startedBy: uuid('started_by').references(() => profiles.id, { onDelete: 'set null' }),
    status: importStatus('status').notNull().default('uploaded'),
    format: text('format'),
    rowsFound: integer('rows_found').notNull().default(0),
    rowsNew: integer('rows_new').notNull().default(0),
    rowsDuplicate: integer('rows_duplicate').notNull().default(0),
    rowsReview: integer('rows_review').notNull().default(0),
    rowsRejected: integer('rows_rejected').notNull().default(0),
    /** Makes a retried import a no-op rather than a second copy. */
    idempotencyKey: text('idempotency_key').unique(),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [index('imports_household_idx').on(table.householdId, table.startedAt)],
);

export const importRows = appSchema.table(
  'import_rows',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    importId: uuid('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    lineNumber: integer('line_number'),
    transactionDate: date('transaction_date'),
    amount: numeric('amount', { precision: 19, scale: 4, mode: 'string' }),
    currency: char('currency', { length: 3 }),
    descriptionOriginal: text('description_original'),
    descriptionNormalized: text('description_normalized'),
    externalReference: text('external_reference'),
    fingerprint: text('fingerprint'),
    verdict: text('verdict').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3, mode: 'string' }),
    matchedTransactionId: uuid('matched_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    /** Which rules fired, so a decision can be justified after the fact. */
    matchedSignals: jsonb('matched_signals').notNull().default([]),
    rejectionReason: text('rejection_reason'),
    createdTransactionId: uuid('created_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    raw: text('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('import_rows_import_idx').on(table.importId, table.verdict)],
);

export const importRelations = relations(imports, ({ one, many }) => ({
  document: one(documents, { fields: [imports.documentId], references: [documents.id] }),
  rows: many(importRows),
}));
