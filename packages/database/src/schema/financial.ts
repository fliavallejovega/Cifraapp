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
  uuid,
} from 'drizzle-orm/pg-core';

import { appSchema, categoryKind } from './app.js';
import { households, profiles } from './identity.js';
import { currencies } from './platform.js';

/**
 * The financial model, mirroring `20260806140000_financial_model.sql`.
 *
 * Two conventions run through all of it and are not negotiable:
 *
 *   - Money is `numeric(19,4)`, surfaced to TypeScript as a string. Drizzle
 *     would happily hand back a JS number, which is the float this whole system
 *     exists to avoid — so every monetary column is `mode: 'string'` and is
 *     parsed through `Money.fromDecimalString` at the boundary (ADR-005).
 *   - Financial dates are `date`, surfaced as a string. A `Date` here would
 *     reintroduce the timezone drift that moves a transaction between months
 *     (ADR-006).
 */

const money = (name: string) => numeric(name, { precision: 19, scale: 4, mode: 'string' });

export const accountType = pgEnum('account_type', [
  'checking',
  'savings',
  'credit_card',
  'loan',
  'mortgage',
  'investment',
  'cash',
  'digital_wallet',
  'business',
  'tax_reserve',
  'other_asset',
  'other_liability',
]);

export const accountStatus = pgEnum('account_status', ['active', 'closed', 'archived']);

export const financialScope = pgEnum('financial_scope', [
  'personal',
  'partner',
  'household',
  'business',
]);

export const transactionStatus = pgEnum('transaction_status', [
  'pending',
  'posted',
  'excluded',
  'transfer',
  'duplicate',
  'needs_review',
  'reconciled',
]);

export const transactionDirection = pgEnum('transaction_direction', ['inflow', 'outflow']);

export const provenance = pgEnum('provenance', [
  'system',
  'user',
  'ai',
  'accountant',
  'imported',
  'bank',
  'rule',
  'tax_rule',
]);

export const taxClassification = pgEnum('tax_classification', [
  'personal',
  'business',
  'mixed',
  'non_deductible',
  'potentially_deductible',
  'requires_review',
]);

export const debtStrategy = pgEnum('debt_strategy', ['avalanche', 'snowball', 'custom', 'hybrid']);
export const goalStatus = pgEnum('goal_status', ['active', 'reached', 'paused', 'abandoned']);
export const budgetPeriod = pgEnum('budget_period', ['weekly', 'monthly', 'annual', 'sinking']);

export const institutions = appSchema.table('institutions', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  name: text('name').notNull(),
  country: char('country', { length: 2 }).notNull().default('PA'),
  parserKey: text('parser_key').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = appSchema.table(
  'accounts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'set null' }),
    institutionId: uuid('institution_id').references(() => institutions.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    /** Last four digits at most. Full account numbers are never stored. */
    maskedNumber: text('masked_number'),
    accountType: accountType('account_type').notNull(),
    scope: financialScope('scope').notNull().default('household'),
    currency: char('currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),
    currentBalance: money('current_balance').notNull().default('0'),
    availableBalance: money('available_balance'),
    creditLimit: money('credit_limit'),
    status: accountStatus('status').notNull().default('active'),
    source: provenance('source').notNull().default('user'),
    lastImportedAt: timestamp('last_imported_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('accounts_household_idx').on(table.householdId)],
);

export const merchants = appSchema.table('merchants', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  /** The category this merchant's transactions have settled into (Phase 6). */
  defaultCategoryId: uuid('default_category_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const merchantAliases = appSchema.table('merchant_aliases', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  merchantId: uuid('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  pattern: text('pattern').notNull(),
  source: provenance('source').notNull().default('system'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const categories = appSchema.table(
  'categories',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    templateSlug: text('template_slug'),
    name: text('name').notNull(),
    kind: categoryKind('kind').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isSystem: boolean('is_system').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('categories_household_idx').on(table.householdId)],
);

export const transactions = appSchema.table(
  'transactions',
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
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'set null' }),

    transactionDate: date('transaction_date').notNull(),
    postedDate: date('posted_date'),

    amount: money('amount').notNull(),
    currency: char('currency', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    direction: transactionDirection('direction').notNull(),

    /** Never destroyed. Normalization has to be reversible. */
    descriptionOriginal: text('description_original').notNull(),
    descriptionNormalized: text('description_normalized').notNull(),

    merchantId: uuid('merchant_id').references(() => merchants.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    categorySource: provenance('category_source'),
    categoryConfidence: numeric('category_confidence', { precision: 4, scale: 3, mode: 'string' }),

    scope: financialScope('scope').notNull().default('household'),
    taxClassification: taxClassification('tax_classification'),
    businessPercentage: numeric('business_percentage', { precision: 5, scale: 2, mode: 'string' }),

    status: transactionStatus('status').notNull().default('posted'),

    source: provenance('source').notNull().default('imported'),
    sourceDocumentId: uuid('source_document_id'),
    sourceImportId: uuid('source_import_id'),
    externalReference: text('external_reference'),
    fingerprint: text('fingerprint').notNull(),
    duplicateGroupId: uuid('duplicate_group_id'),

    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('transactions_household_date_idx').on(table.householdId, table.transactionDate),
    index('transactions_account_date_idx').on(table.accountId, table.transactionDate),
    index('transactions_fingerprint_idx').on(table.householdId, table.fingerprint),
  ],
);

export const transfers = appSchema.table('transfers', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  fromTransactionId: uuid('from_transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'cascade' }),
  toTransactionId: uuid('to_transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'cascade' }),
  amount: money('amount').notNull(),
  currency: char('currency', { length: 3 })
    .notNull()
    .references(() => currencies.code),
  /** The purchases behind this balance were already counted as spending. */
  isCardPayment: boolean('is_card_payment').notNull().default(false),
  confidence: numeric('confidence', { precision: 4, scale: 3, mode: 'string' }).notNull(),
  detectedBy: provenance('detected_by').notNull().default('system'),
  confirmedBy: uuid('confirmed_by').references(() => profiles.id, { onDelete: 'set null' }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const duplicateCandidates = appSchema.table('duplicate_candidates', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  existingTransactionId: uuid('existing_transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'cascade' }),
  incomingTransactionId: uuid('incoming_transaction_id').references(() => transactions.id, {
    onDelete: 'cascade',
  }),
  importId: uuid('import_id'),
  confidence: numeric('confidence', { precision: 4, scale: 3, mode: 'string' }).notNull(),
  /** Which rules fired, so the decision can be explained and audited. */
  matchedSignals: jsonb('matched_signals').notNull().default([]),
  resolution: text('resolution'),
  resolvedBy: uuid('resolved_by').references(() => profiles.id, { onDelete: 'set null' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const obligations = appSchema.table(
  'obligations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    merchantId: uuid('merchant_id').references(() => merchants.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    expectedAmount: money('expected_amount').notNull(),
    currency: char('currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),
    dueDate: date('due_date').notNull(),
    frequency: text('frequency'),
    nextExpectedDate: date('next_expected_date'),
    isEssential: boolean('is_essential').notNull().default(true),
    confidence: numeric('confidence', { precision: 4, scale: 3, mode: 'string' }),
    detectedBy: provenance('detected_by').notNull().default('user'),
    /** The pattern that generated this claim, when one did (Phase 7). */
    seriesId: uuid('series_id'),
    /** Set once a real transaction settles it, so it stops being a claim. */
    settledTransactionId: uuid('settled_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('obligations_household_due_idx').on(table.householdId, table.dueDate)],
);

export const budgets = appSchema.table('budgets', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  period: budgetPeriod('period').notNull().default('monthly'),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on'),
  scope: financialScope('scope').notNull().default('household'),
  rollsOver: boolean('rolls_over').notNull().default(false),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const budgetLines = appSchema.table('budget_lines', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  budgetId: uuid('budget_id')
    .notNull()
    .references(() => budgets.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  plannedAmount: money('planned_amount').notNull(),
  /** Carried in from the period before, when the budget rolls over (Phase 7). */
  rolloverIn: money('rollover_in').notNull().default('0'),
  currency: char('currency', { length: 3 })
    .notNull()
    .default('USD')
    .references(() => currencies.code),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const goals = appSchema.table(
  'goals',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    targetAmount: money('target_amount').notNull(),
    currentAmount: money('current_amount').notNull().default('0'),
    currency: char('currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),
    targetDate: date('target_date'),
    priority: integer('priority').notNull().default(100),
    scope: financialScope('scope').notNull().default('household'),
    status: goalStatus('status').notNull().default('active'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('goals_household_idx').on(table.householdId, table.priority)],
);

export const debts = appSchema.table(
  'debts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    principal: money('principal').notNull(),
    currentBalance: money('current_balance').notNull(),
    currency: char('currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),
    /** A percentage: 24.500 means 24.5%. */
    apr: numeric('apr', { precision: 6, scale: 3, mode: 'string' }).notNull(),
    minimumPayment: money('minimum_payment').notNull().default('0'),
    dueDay: smallint('due_day'),
    statementDay: smallint('statement_day'),
    creditLimit: money('credit_limit'),
    promotionalApr: numeric('promotional_apr', { precision: 6, scale: 3, mode: 'string' }),
    promotionalExpiresOn: date('promotional_expires_on'),
    strategyPriority: integer('strategy_priority'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('debts_household_idx').on(table.householdId)],
);

export const householdSettings = appSchema.table('household_settings', {
  householdId: uuid('household_id')
    .primaryKey()
    .references(() => households.id, { onDelete: 'cascade' }),
  /** The floor the household refuses to go below. The gauge's threshold mark. */
  bufferMinimum: money('buffer_minimum').notNull().default('0'),
  debtStrategy: debtStrategy('debt_strategy').notNull().default('avalanche'),
  taxReserveRate: numeric('tax_reserve_rate', { precision: 5, scale: 2, mode: 'string' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accountRelations = relations(accounts, ({ many, one }) => ({
  transactions: many(transactions),
  household: one(households, {
    fields: [accounts.householdId],
    references: [households.id],
  }),
}));

export const transactionRelations = relations(transactions, ({ one }) => ({
  account: one(accounts, { fields: [transactions.accountId], references: [accounts.id] }),
  merchant: one(merchants, { fields: [transactions.merchantId], references: [merchants.id] }),
  category: one(categories, { fields: [transactions.categoryId], references: [categories.id] }),
}));
