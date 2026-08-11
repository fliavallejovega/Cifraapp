import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  numeric,
  pgEnum,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { currencies, platformSchema } from './platform.js';

/**
 * The internal ledger, mirroring `20260811140000_ledger.sql`.
 *
 * No `balance` column exists here and none should be added. Balances are summed
 * from lines; a running total that everything increments cannot be audited and
 * drifts silently.
 *
 * The debits-equal-credits rule is a deferred constraint trigger in the
 * database. `@app/ledger` checks the same thing earlier so a developer gets a
 * useful message, but the database is what makes it true.
 */

const money = (name: string) => numeric(name, { precision: 19, scale: 4, mode: 'string' });

export const ledgerAccountType = pgEnum('ledger_account_type', [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
]);

export const entrySide = pgEnum('entry_side', ['debit', 'credit']);

export const ledgerAccounts = platformSchema.table('ledger_accounts', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  accountType: ledgerAccountType('account_type').notNull(),

  /** Which side increases this account. A contra account inverts it. */
  normalBalance: entrySide('normal_balance').notNull(),
  isContra: boolean('is_contra').notNull().default(false),

  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const journalEntries = platformSchema.table(
  'journal_entries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),

    occurredOn: date('occurred_on').notNull(),
    description: text('description').notNull(),

    sourceKind: text('source_kind').notNull(),
    sourceRef: text('source_ref'),

    currency: char('currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),

    /** Corrections are new entries that reverse an old one, never edits. */
    reversesEntryId: uuid('reverses_entry_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
  },
  (table) => [
    unique('journal_entries_source_ref_unique').on(table.sourceKind, table.sourceRef),
    index('journal_entries_date_idx').on(table.occurredOn),
  ],
);

export const journalLines = platformSchema.table(
  'journal_lines',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),

    accountCode: text('account_code')
      .notNull()
      .references(() => ledgerAccounts.code),
    side: entrySide('side').notNull(),

    /** Always positive. The side carries the direction, exactly once. */
    amount: money('amount').notNull(),

    memo: text('memo'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('journal_lines_entry_idx').on(table.entryId),
    index('journal_lines_account_idx').on(table.accountCode),
  ],
);

export const journalEntryRelations = relations(journalEntries, ({ many }) => ({
  lines: many(journalLines),
}));

export const journalLineRelations = relations(journalLines, ({ one }) => ({
  entry: one(journalEntries, {
    fields: [journalLines.entryId],
    references: [journalEntries.id],
  }),
  account: one(ledgerAccounts, {
    fields: [journalLines.accountCode],
    references: [ledgerAccounts.code],
  }),
}));
