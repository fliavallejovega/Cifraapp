import { relations, sql } from 'drizzle-orm';
import {
  char,
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
import { debts, goals, obligations, transactions } from './financial.js';
import { households, profiles } from './identity.js';
import { currencies } from './platform.js';

/**
 * Allocation plans, mirroring `20260807080000_allocation.sql`.
 *
 * Plans are stored, not recomputed. The plan a household saw and acted on is the
 * plan that must still be there afterwards; recomputing it from today's balances
 * would show them something they never agreed to.
 */

export const claimKind = pgEnum('claim_kind', [
  'overdue_essential',
  'upcoming_essential',
  'debt_minimum',
  'tax_reserve',
  'emergency_fund',
  'high_interest_debt',
  'investment',
  'goal',
  'discretionary',
]);

export const planOutcome = pgEnum('plan_outcome', [
  'proposed',
  'viewed',
  'accepted',
  'modified',
  'dismissed',
]);

const money = (name: string) => numeric(name, { precision: 19, scale: 4, mode: 'string' });

export const allocationPlans = appSchema.table(
  'allocation_plans',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),

    /** Null when the household is asking "what if $2,000 arrived". */
    transactionId: uuid('transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    incomingAmount: money('incoming_amount').notNull(),
    currency: char('currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),

    /** The ladder that produced this plan. It is configurable, so it is stored. */
    priorityOrder: claimKind('priority_order').array().notNull(),

    allocatedAmount: money('allocated_amount').notNull().default('0'),
    unallocatedAmount: money('unallocated_amount').notNull().default('0'),
    shortfallAmount: money('shortfall_amount').notNull().default('0'),

    outcome: planOutcome('outcome').notNull().default('proposed'),
    viewedAt: timestamp('viewed_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => profiles.id, { onDelete: 'set null' }),

    generatedFor: date('generated_for').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('allocation_plans_household_idx').on(table.householdId, table.createdAt)],
);

export const allocationLines = appSchema.table(
  'allocation_lines',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    planId: uuid('plan_id')
      .notNull()
      .references(() => allocationPlans.id, { onDelete: 'cascade' }),

    kind: claimKind('kind').notNull(),
    label: text('label').notNull(),
    /** `debt:mastercard`, `goal:travel` — a reference a person would recognize. */
    target: text('target').notNull(),

    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    debtId: uuid('debt_id').references(() => debts.id, { onDelete: 'set null' }),
    obligationId: uuid('obligation_id').references(() => obligations.id, { onDelete: 'set null' }),

    requestedAmount: money('requested_amount').notNull(),
    allocatedAmount: money('allocated_amount').notNull(),
    position: integer('position').notNull(),

    /** Shown verbatim. Every line of a plan can be interrogated. */
    explanation: text('explanation').notNull(),
    appliedRuleIds: uuid('applied_rule_ids').array().notNull().default([]),

    /** What the household changed it to. Null means they left it alone. */
    acceptedAmount: money('accepted_amount'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('allocation_lines_plan_idx').on(table.planId, table.position)],
);

export const allocationPlanRelations = relations(allocationPlans, ({ many, one }) => ({
  lines: many(allocationLines),
  transaction: one(transactions, {
    fields: [allocationPlans.transactionId],
    references: [transactions.id],
  }),
}));

export const allocationLineRelations = relations(allocationLines, ({ one }) => ({
  plan: one(allocationPlans, {
    fields: [allocationLines.planId],
    references: [allocationPlans.id],
  }),
}));
