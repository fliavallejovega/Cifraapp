import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import { households, profiles } from './identity.js';

/**
 * Background work, mirroring `20260907240000_jobs.sql`.
 *
 * A queue in Postgres, claimed with `for update skip locked`. The alternative —
 * a broker — would introduce a second source of truth about whether a job ran,
 * and «did my statement import» is not a question that may have two answers.
 */

export const jobStatus = pgEnum('job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const jobs = appSchema.table(
  'jobs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Text, not an enum: a new kind should be a deploy, not a migration. */
    kind: text('kind').notNull(),
    status: jobStatus('status').notNull().default('queued'),
    payload: jsonb('payload').notNull().default({}),
    /** Whole percent. The difference between «working» and «stuck». */
    progress: smallint('progress').notNull().default(0),
    progressNote: text('progress_note'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    result: jsonb('result'),
    /** Shown to the household verbatim, so it is written for them. */
    errorMessage: text('error_message'),
    /** Backoff by moving this forward, never by sleeping in a worker. */
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('jobs_runnable_idx').on(table.runAfter, table.createdAt),
    index('jobs_household_idx').on(table.householdId, table.createdAt),
  ],
);

export const jobRelations = relations(jobs, ({ one }) => ({
  household: one(households, { fields: [jobs.householdId], references: [households.id] }),
}));

export type JobStatus = (typeof jobStatus.enumValues)[number];
