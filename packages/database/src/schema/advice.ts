import { relations, sql } from 'drizzle-orm';
import { date, index, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { aiInvocations } from './ai.js';
import { appSchema } from './app.js';
import { households, profiles } from './identity.js';

/**
 * Conversation and acknowledgement, mirroring `20260907250000_advice.sql`.
 *
 * A message carries the grounding it was answered from. That is what makes an
 * answer read months later auditable: «you had $2,740 available» is otherwise a
 * claim nobody can check against anything.
 *
 * Alerts have no table, deliberately. They are derived from the ledger on every
 * read; only the fact that somebody acknowledged one is worth storing.
 */

export const chatThreads = appSchema.table(
  'chat_threads',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Taken from the first question, so nothing has to be named up front. */
    title: text('title').notNull(),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('chat_threads_household_idx').on(table.householdId, table.updatedAt)],
);

export const chatMessages = appSchema.table(
  'chat_messages',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    body: text('body').notNull(),
    /** The figures the answer was allowed to use, as handed to the model. */
    grounding: jsonb('grounding').notNull().default({}),
    invocationId: uuid('invocation_id').references(() => aiInvocations.id, {
      onDelete: 'set null',
    }),
    /** Figures the guardrail could not tie back to the grounding. */
    ungrounded: text('ungrounded').array().notNull().default([]),
    authorId: uuid('author_id').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('chat_messages_thread_idx').on(table.threadId, table.createdAt)],
);

export const alertDismissals = appSchema.table(
  'alert_dismissals',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Stable across recomputations, so dismissing once is enough. */
    alertKey: text('alert_key').notNull(),
    dismissedBy: uuid('dismissed_by').references(() => profiles.id, { onDelete: 'set null' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Dismissal is for this month, not forever. */
    expiresOn: date('expires_on').notNull(),
  },
  (table) => [
    unique('alert_dismissals_household_id_alert_key_key').on(table.householdId, table.alertKey),
    index('alert_dismissals_household_idx').on(table.householdId, table.expiresOn),
  ],
);

export const chatThreadRelations = relations(chatThreads, ({ many }) => ({
  messages: many(chatMessages),
}));

export const chatMessageRelations = relations(chatMessages, ({ one }) => ({
  thread: one(chatThreads, { fields: [chatMessages.threadId], references: [chatThreads.id] }),
}));
