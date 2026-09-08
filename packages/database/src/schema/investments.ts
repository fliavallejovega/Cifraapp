import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  index,
  numeric,
  pgEnum,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import { goals } from './financial.js';
import { households, profiles } from './identity.js';
import { currencies } from './platform.js';

/**
 * Investing, mirroring `20260907270000_investments.sql`.
 *
 * The product models; it does not recommend. A profile records how much risk a
 * household says it carries and what it can put in, and the assumption band its
 * modelling uses — overridable, because an assumption a household cannot argue
 * with is being passed off as knowledge.
 *
 * The watchlist is what they asked to look at, never a list of things the
 * product told them to buy.
 */

export const riskLevel = pgEnum('risk_level', ['cash', 'conservative', 'balanced', 'growth']);

export const investmentProfiles = appSchema.table('investment_profiles', {
  householdId: uuid('household_id')
    .primaryKey()
    .references(() => households.id, { onDelete: 'cascade' }),
  riskLevel: riskLevel('risk_level').notNull().default('balanced'),
  /** Stated, not inferred: what is left over and what somebody will lock away
   *  are different numbers, and only they know the second. */
  monthlyCapacity: numeric('monthly_capacity', { precision: 19, scale: 4, mode: 'string' })
    .notNull()
    .default('0'),
  currency: char('currency', { length: 3 })
    .notNull()
    .default('USD')
    .references(() => currencies.code),
  /** Whole percent a year. Null means «use the product's own band». */
  assumedLow: numeric('assumed_low', { precision: 6, scale: 3, mode: 'string' }),
  assumedExpected: numeric('assumed_expected', { precision: 6, scale: 3, mode: 'string' }),
  assumedHigh: numeric('assumed_high', { precision: 6, scale: 3, mode: 'string' }),
  /** What they care about, in their words. Feeds the explanation, never a pick. */
  interests: text('interests').array().notNull().default([]),
  hasEmergencyFund: boolean('has_emergency_fund').notNull().default(false),
  /** Until this is set, the modelling renders behind the risk disclosure. */
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const investmentWatchlist = appSchema.table(
  'investment_watchlist',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** As the charting provider addresses it. Stored verbatim: it is their
     *  identifier, not ours to normalise. */
    symbol: text('symbol').notNull(),
    /** What the household calls it. The symbol is the machine's name. */
    label: text('label').notNull(),
    note: text('note'),
    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('investment_watchlist_household_id_symbol_key').on(table.householdId, table.symbol),
    index('investment_watchlist_household_idx').on(table.householdId, table.createdAt),
  ],
);

export const investmentProfileRelations = relations(investmentProfiles, ({ one }) => ({
  household: one(households, {
    fields: [investmentProfiles.householdId],
    references: [households.id],
  }),
}));

export const investmentWatchlistRelations = relations(investmentWatchlist, ({ one }) => ({
  goal: one(goals, { fields: [investmentWatchlist.goalId], references: [goals.id] }),
}));

export type RiskLevelValue = (typeof riskLevel.enumValues)[number];
