import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import { transactions } from './financial.js';
import { households, profiles } from './identity.js';
import { currencies, platformSchema, taxJurisdictions } from './platform.js';

/**
 * The tax engine's tables, mirroring `20260811110000_tax.sql`.
 *
 * A rule is data with a source and a version, not a constant in code. A
 * calculation records the rule set that produced it, because the figure a
 * household saw in March must still be explainable after the rules have moved.
 */

const money = (name: string) => numeric(name, { precision: 19, scale: 4, mode: 'string' });

export const ruleSetStatus = pgEnum('rule_set_status', [
  'draft',
  'in_review',
  'approved',
  'published',
  'superseded',
]);

export const taxpayerStatus = pgEnum('taxpayer_status', [
  'salaried',
  'independent_professional',
  'freelancer',
  'merchant',
  'mixed_income',
  'personal_business',
]);

export const accountingMethod = pgEnum('accounting_method', ['cash', 'accrual']);

export const expenseClassification = pgEnum('expense_classification', [
  'PERSONAL',
  'BUSINESS',
  'MIXED',
  'NON_DEDUCTIBLE',
  'POTENTIALLY_DEDUCTIBLE',
  'REQUIRES_REVIEW',
]);

export const taxRuleSets = platformSchema.table(
  'tax_rule_sets',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    jurisdiction: char('jurisdiction', { length: 2 })
      .notNull()
      .references(() => taxJurisdictions.code),
    fiscalYear: integer('fiscal_year').notNull(),
    version: integer('version').notNull(),

    status: ruleSetStatus('status').notNull().default('draft'),

    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),

    currency: char('currency', { length: 3 })
      .notNull()
      .references(() => currencies.code),

    /** Publication requires both. The database refuses a published set without them. */
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('tax_rule_sets_unique_version').on(table.jurisdiction, table.fiscalYear, table.version),
    index('tax_rule_sets_lookup_idx').on(table.jurisdiction, table.effectiveFrom, table.version),
  ],
);

export const taxRules = platformSchema.table(
  'tax_rules',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    ruleSetId: uuid('rule_set_id')
      .notNull()
      .references(() => taxRuleSets.id, { onDelete: 'cascade' }),

    taxType: text('tax_type').notNull(),
    /** `income.brackets`. The engine looks rules up by this. */
    ruleKey: text('rule_key').notNull(),
    kind: text('kind').notNull(),

    /** The rule's shape in the engine's vocabulary. Validated on read. */
    payload: jsonb('payload').notNull(),

    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    sourceReference: text('source_reference').notNull(),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('tax_rules_unique_key').on(table.ruleSetId, table.ruleKey)],
);

export const taxProfiles = appSchema.table('tax_profiles', {
  householdId: uuid('household_id')
    .primaryKey()
    .references(() => households.id, { onDelete: 'cascade' }),
  jurisdiction: char('jurisdiction', { length: 2 })
    .notNull()
    .default('PA')
    .references(() => taxJurisdictions.code),

  taxpayerStatus: taxpayerStatus('taxpayer_status').notNull(),
  ruc: text('ruc'),
  activity: text('activity'),

  accountingMethod: accountingMethod('accounting_method').notNull().default('cash'),
  itbmsRegistered: boolean('itbms_registered').notNull().default(false),

  /** `MM-DD`. Assuming a calendar year for a household that has another costs a filing. */
  fiscalYearStart: text('fiscal_year_start').notNull().default('01-01'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const taxEstimates = appSchema.table(
  'tax_estimates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),

    /** Which rules produced this. Without it the figure is unexplainable later. */
    ruleSetId: uuid('rule_set_id')
      .notNull()
      .references(() => taxRuleSets.id),

    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),

    grossIncome: money('gross_income').notNull().default('0'),
    deductions: money('deductions').notNull().default('0'),
    taxableIncome: money('taxable_income').notNull().default('0'),
    estimatedTax: money('estimated_tax').notNull().default('0'),

    reserveTarget: money('reserve_target').notNull().default('0'),
    reservedToDate: money('reserved_to_date').notNull().default('0'),

    currency: char('currency', { length: 3 })
      .notNull()
      .default('PAB')
      .references(() => currencies.code),

    /** True only from a finalized return. Otherwise it is an estimate, and says so. */
    isFinal: boolean('is_final').notNull().default(false),

    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('tax_estimates_household_idx').on(table.householdId, table.periodStart)],
);

export const expenseClassifications = appSchema.table(
  'expense_classifications',
  {
    transactionId: uuid('transaction_id')
      .primaryKey()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),

    classification: expenseClassification('classification').notNull(),
    businessPercentage: smallint('business_percentage').notNull().default(0),

    reasonKey: text('reason_key'),
    /** True until a person confirms it. Nothing true is used on a return. */
    needsReview: boolean('needs_review').notNull().default(true),

    decidedBy: uuid('decided_by').references(() => profiles.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('expense_classifications_review_idx').on(table.householdId)],
);

export const taxRuleSetRelations = relations(taxRuleSets, ({ many }) => ({
  rules: many(taxRules),
}));

export const taxRuleRelations = relations(taxRules, ({ one }) => ({
  ruleSet: one(taxRuleSets, {
    fields: [taxRules.ruleSetId],
    references: [taxRuleSets.id],
  }),
}));
