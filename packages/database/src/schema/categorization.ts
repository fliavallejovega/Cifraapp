import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import { categories, merchants, provenance, taxClassification, transactions } from './financial.js';
import { households, profiles } from './identity.js';

/**
 * Categorization and learning, mirroring `20260807050000_categorization.sql`.
 *
 * The rules decide; the log remembers. The log is what makes a wrong automatic
 * classification undoable and a settled habit detectable — both of which the
 * product promises and neither of which is recoverable from the transaction row
 * alone, because that row only ever holds the current answer.
 */

export const matchKind = pgEnum('match_kind', ['equals', 'starts_with', 'contains', 'tokens']);

export const merchantRules = appSchema.table(
  'merchant_rules',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),

    matchKind: matchKind('match_kind').notNull().default('contains'),
    /** Stored already normalized, so Postgres and the engine compare like with like. */
    pattern: text('pattern').notNull(),

    merchantId: uuid('merchant_id').references(() => merchants.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),

    taxClassification: taxClassification('tax_classification'),
    businessPercentage: numeric('business_percentage', { precision: 5, scale: 2, mode: 'string' }),

    source: provenance('source').notNull().default('user'),
    confidence: numeric('confidence', { precision: 4, scale: 3, mode: 'string' })
      .notNull()
      .default('1'),
    priority: integer('priority').notNull().default(100),

    isActive: boolean('is_active').notNull().default(true),
    effectiveFrom: date('effective_from'),
    effectiveTo: date('effective_to'),

    /** How many corrections supported this rule when it was proposed. */
    supportingCorrections: integer('supporting_corrections'),

    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('merchant_rules_lookup_idx').on(table.householdId, table.source, table.priority),
  ],
);

export const classificationLog = appSchema.table(
  'classification_log',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),

    previousCategoryId: uuid('previous_category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    previousSource: provenance('previous_source'),
    source: provenance('source').notNull(),

    confidence: numeric('confidence', { precision: 4, scale: 3, mode: 'string' }),
    appliedRuleId: uuid('applied_rule_id').references(() => merchantRules.id, {
      onDelete: 'set null',
    }),
    actorId: uuid('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('classification_log_transaction_idx').on(table.transactionId, table.createdAt)],
);

export const merchantRuleRelations = relations(merchantRules, ({ one }) => ({
  merchant: one(merchants, { fields: [merchantRules.merchantId], references: [merchants.id] }),
  category: one(categories, { fields: [merchantRules.categoryId], references: [categories.id] }),
}));

export const classificationLogRelations = relations(classificationLog, ({ one }) => ({
  transaction: one(transactions, {
    fields: [classificationLog.transactionId],
    references: [transactions.id],
  }),
  appliedRule: one(merchantRules, {
    fields: [classificationLog.appliedRuleId],
    references: [merchantRules.id],
  }),
}));
