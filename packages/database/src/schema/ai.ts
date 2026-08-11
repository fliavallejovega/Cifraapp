import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgEnum,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import { households, profiles } from './identity.js';
import { currencies, platformSchema } from './platform.js';

/**
 * The AI copilot's tables, mirroring `20260811100000_ai.sql`.
 *
 * Nothing here is authoritative about money. These rows record what was asked,
 * which prompt version asked it, what it cost and what was cached — so that the
 * feature can be measured, capped and switched off without guesswork.
 */

export const aiFeature = pgEnum('ai_feature', [
  'merchant_classification',
  'allocation_explanation',
  'anomaly_summary',
  'budget_suggestion',
  'document_interpretation',
  'rule_proposal',
  'scenario_narration',
  'question_answer',
]);

export const aiOutcome = pgEnum('ai_outcome', [
  'ok',
  'cache_hit',
  'not_configured',
  'budget_exhausted',
  'missing_grounding',
  'transport_error',
  'malformed_output',
  'ungrounded_figures',
  'refused',
]);

/**
 * Prices per million tokens, in micro-dollars.
 *
 * Integers rather than `numeric`, because these are counted in millionths and
 * multiplied by token counts: `bigint` all the way through is exact, and the
 * moment a rate becomes a float the cost of a month of calls stops being
 * reproducible.
 */
export const aiModels = platformSchema.table(
  'ai_models',
  {
    provider: text('provider').notNull(),
    modelKey: text('model_key').notNull(),
    displayName: text('display_name').notNull(),

    inputMicrosPerMillion: bigint('input_micros_per_million', { mode: 'bigint' }).notNull(),
    outputMicrosPerMillion: bigint('output_micros_per_million', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),

    contextWindow: integer('context_window'),
    isActive: boolean('is_active').notNull().default(true),

    priceSourceUrl: text('price_source_url'),
    /** Null means nobody has confirmed this rate. Costs from it are indicative. */
    priceCheckedAt: timestamp('price_checked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.modelKey] })],
);

export const aiBudgets = appSchema.table('ai_budgets', {
  householdId: uuid('household_id')
    .primaryKey()
    .references(() => households.id, { onDelete: 'cascade' }),
  /** Zero is uncapped. The application supplies its own ceiling when absent. */
  monthlyCapMicros: bigint('monthly_cap_micros', { mode: 'bigint' }).notNull().default(0n),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const aiInvocations = appSchema.table(
  'ai_invocations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'set null' }),

    feature: aiFeature('feature').notNull(),
    /** `allocation-explanation-v1` — the version is part of the identity. */
    promptId: text('prompt_id').notNull(),
    locale: text('locale').notNull().default('es'),

    provider: text('provider').notNull(),
    model: text('model').notNull(),

    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'bigint' }).notNull().default(0n),

    cacheHit: boolean('cache_hit').notNull().default(false),
    latencyMs: integer('latency_ms').notNull().default(0),

    outcome: aiOutcome('outcome').notNull(),
    /** The engine's words. Never a provider body — those echo household facts. */
    failureDetail: text('failure_detail'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ai_invocations_household_idx').on(table.householdId, table.createdAt)],
);

export const aiCache = appSchema.table(
  'ai_cache',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),

    cacheKey: text('cache_key').notNull(),
    promptId: text('prompt_id').notNull(),
    model: text('model').notNull(),

    output: jsonb('output').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),

    hits: integer('hits').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [unique('ai_cache_unique_per_household').on(table.householdId, table.cacheKey)],
);

export const scenarios = appSchema.table(
  'scenarios',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    kind: text('kind').notNull(),

    /** The scenario engine's own shape. Validated on read, like a stored rule. */
    changes: jsonb('changes').notNull().default([]),
    horizonMonths: integer('horizon_months').notNull().default(60),

    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('scenarios_household_idx').on(table.householdId)],
);

export const aiInvocationRelations = relations(aiInvocations, ({ one }) => ({
  household: one(households, {
    fields: [aiInvocations.householdId],
    references: [households.id],
  }),
}));

export const scenarioRelations = relations(scenarios, ({ one }) => ({
  household: one(households, {
    fields: [scenarios.householdId],
    references: [households.id],
  }),
}));
