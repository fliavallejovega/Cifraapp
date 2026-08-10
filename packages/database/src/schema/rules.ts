import { relations, sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import { provenance } from './financial.js';
import { households, profiles } from './identity.js';

/**
 * The rule engine's tables, mirroring `20260807070000_rules.sql`.
 *
 * `conditions` and `actions` are JSON because a rule is data. The vocabulary
 * they may use lives in `@app/rule-engine`, where widening it requires a code
 * change and a review rather than a row.
 */

export const rules = appSchema.table(
  'rules',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    /** Shown to the household verbatim. A rule nobody can explain cannot be reviewed. */
    explanation: text('explanation').notNull(),

    conditions: jsonb('conditions').notNull(),
    actions: jsonb('actions').notNull(),

    priority: integer('priority').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),
    effectiveFrom: date('effective_from'),
    effectiveTo: date('effective_to'),

    source: provenance('source').notNull().default('user'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('rules_household_idx').on(table.householdId, table.priority)],
);

export const ruleExecutions = appSchema.table(
  'rule_executions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => rules.id, { onDelete: 'cascade' }),

    matched: boolean('matched').notNull(),
    /** Why it did not fire. Null exactly when it did. */
    skipReason: text('skip_reason'),
    /** What the rule asked for, as it asked. Not recomputed on replay. */
    actions: jsonb('actions').notNull().default([]),
    explanation: text('explanation').notNull(),

    contextKind: text('context_kind'),
    contextId: uuid('context_id'),

    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('rule_executions_rule_idx').on(table.ruleId, table.evaluatedAt),
    index('rule_executions_household_idx').on(table.householdId, table.evaluatedAt),
  ],
);

export const ruleRelations = relations(rules, ({ many }) => ({
  executions: many(ruleExecutions),
}));

export const ruleExecutionRelations = relations(ruleExecutions, ({ one }) => ({
  rule: one(rules, { fields: [ruleExecutions.ruleId], references: [rules.id] }),
}));
