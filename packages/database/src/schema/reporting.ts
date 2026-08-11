import { relations, sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import { accounts } from './financial.js';
import { households, profiles } from './identity.js';

/**
 * Reporting's tables, mirroring `20260811120000_reporting.sql`.
 *
 * Statements themselves are not here. They are computed from rows on demand,
 * because a stored statement is a copy that silently disagrees with its source
 * the first time a transaction is corrected. These tables hold what a statement
 * cannot recompute.
 */

const money = (name: string) => numeric(name, { precision: 19, scale: 4, mode: 'string' });

export const periodStatus = pgEnum('period_status', ['open', 'closing', 'closed', 'reopened']);

export const accountingPeriods = appSchema.table(
  'accounting_periods',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),

    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),

    status: periodStatus('status').notNull().default('open'),

    /** The checklist as it stood at close. "We closed with four unreviewed transfers." */
    checklist: jsonb('checklist').notNull().default({}),

    closedBy: uuid('closed_by').references(() => profiles.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    reopenedBy: uuid('reopened_by').references(() => profiles.id, { onDelete: 'set null' }),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    /** Required to reopen. Somebody will ask why the quoted figures changed. */
    reopenReason: text('reopen_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('accounting_periods_unique').on(table.householdId, table.periodStart, table.periodEnd),
    index('accounting_periods_household_idx').on(table.householdId, table.periodStart),
  ],
);

export const reconciliations = appSchema.table(
  'reconciliations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),

    statementDate: date('statement_date').notNull(),
    statementBalance: money('statement_balance').notNull(),
    systemBalance: money('system_balance').notNull(),
    /** Recorded, never resolved by adjustment. A check constraint keeps it derived. */
    difference: money('difference').notNull(),

    candidates: jsonb('candidates').notNull().default([]),

    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => profiles.id, { onDelete: 'set null' }),
    resolutionNote: text('resolution_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('reconciliations_account_idx').on(table.accountId, table.statementDate)],
);

export const reportExports = appSchema.table(
  'report_exports',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),

    reportKind: text('report_kind').notNull(),
    format: text('format').notNull(),

    periodStart: date('period_start'),
    periodEnd: date('period_end'),

    /** Set only when the export was kept. Small ones stream and land nowhere. */
    r2Key: text('r2_key'),
    byteSize: integer('byte_size'),

    requestedBy: uuid('requested_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [index('report_exports_household_idx').on(table.householdId, table.createdAt)],
);

export const accountingPeriodRelations = relations(accountingPeriods, ({ one }) => ({
  household: one(households, {
    fields: [accountingPeriods.householdId],
    references: [households.id],
  }),
}));

export const reconciliationRelations = relations(reconciliations, ({ one }) => ({
  account: one(accounts, {
    fields: [reconciliations.accountId],
    references: [accounts.id],
  }),
}));
