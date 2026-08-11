import { relations, sql } from 'drizzle-orm';
import { index, pgEnum, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import { transactions } from './financial.js';
import { households, profiles } from './identity.js';

/**
 * The accountant portal's tables, mirroring `20260811170000_accountant.sql`.
 *
 * A grant is explicit, scoped and revocable. What it reaches is enumerated table
 * by table in the migration rather than derived from a widened membership check,
 * so the set of things an accountant can see is a list somebody can read.
 */

export const accountantScope = pgEnum('accountant_scope', ['read', 'comment', 'classify']);

export const accountantGrants = appSchema.table(
  'accountant_grants',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountantId: uuid('accountant_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    scope: accountantScope('scope').notNull().default('read'),

    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => profiles.id),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),

    /** An access that lapses on its own beats one that relies on remembering. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => profiles.id, { onDelete: 'set null' }),
    /** Optional. A household revoking access owes nobody a reason. */
    revokeNote: text('revoke_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('accountant_grants_unique_active').on(table.householdId, table.accountantId),
    index('accountant_grants_accountant_idx').on(table.accountantId),
  ],
);

export const accountantNotes = appSchema.table(
  'accountant_notes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    /** A note about one transaction belongs on it, not in a list of remarks. */
    transactionId: uuid('transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),

    body: text('body').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('accountant_notes_household_idx').on(table.householdId, table.createdAt)],
);

export const accountantRequests = appSchema.table(
  'accountant_requests',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountantId: uuid('accountant_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    kind: text('kind').notNull(),
    message: text('message').notNull(),

    status: text('status').notNull().default('open'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    answeredBy: uuid('answered_by').references(() => profiles.id, { onDelete: 'set null' }),
    response: text('response'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('accountant_requests_open_idx').on(table.householdId)],
);

export const accountantGrantRelations = relations(accountantGrants, ({ one }) => ({
  household: one(households, {
    fields: [accountantGrants.householdId],
    references: [households.id],
  }),
  accountant: one(profiles, {
    fields: [accountantGrants.accountantId],
    references: [profiles.id],
  }),
}));
