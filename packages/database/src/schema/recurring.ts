import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import {
  accounts,
  categories,
  financialScope,
  merchants,
  provenance,
  transactionDirection,
} from './financial.js';
import { households, profiles } from './identity.js';
import { currencies } from './platform.js';

/**
 * Recurring series, mirroring `20260807060000_recurring.sql`.
 *
 * A series is the pattern; `app.obligations` holds the individual claims it
 * generates. Keeping them separate is what lets an obligation be settled by a
 * transaction while the pattern that produced it carries on.
 */

export const recurrenceFrequency = pgEnum('recurrence_frequency', [
  'weekly',
  'biweekly',
  'semimonthly',
  'monthly',
  'quarterly',
  'annual',
]);

export const recurringSeries = appSchema.table(
  'recurring_series',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    merchantId: uuid('merchant_id').references(() => merchants.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'set null' }),

    name: text('name').notNull(),
    direction: transactionDirection('direction').notNull().default('outflow'),
    scope: financialScope('scope').notNull().default('household'),

    /** A median, so one unusual month does not move it. */
    expectedAmount: numeric('expected_amount', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),
    currency: char('currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),

    frequency: recurrenceFrequency('frequency').notNull(),
    /** Calendar days a semimonthly series lands on; 31 means month end. */
    anchorDays: smallint('anchor_days').array(),

    lastSeenOn: date('last_seen_on').notNull(),
    nextExpectedDate: date('next_expected_date').notNull(),

    confidence: numeric('confidence', { precision: 4, scale: 3, mode: 'string' }).notNull(),
    amountVariation: numeric('amount_variation', { precision: 6, scale: 4, mode: 'string' })
      .notNull()
      .default('0'),
    occurrenceCount: integer('occurrence_count').notNull(),

    isEssential: boolean('is_essential').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),

    detectedBy: provenance('detected_by').notNull().default('system'),
    confirmedBy: uuid('confirmed_by').references(() => profiles.id, { onDelete: 'set null' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('recurring_series_household_idx').on(table.householdId, table.nextExpectedDate),
    index('recurring_series_merchant_idx').on(table.householdId, table.merchantId),
  ],
);

export const recurringSeriesRelations = relations(recurringSeries, ({ one }) => ({
  merchant: one(merchants, { fields: [recurringSeries.merchantId], references: [merchants.id] }),
  category: one(categories, { fields: [recurringSeries.categoryId], references: [categories.id] }),
  account: one(accounts, { fields: [recurringSeries.accountId], references: [accounts.id] }),
}));
