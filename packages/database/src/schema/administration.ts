import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  numeric,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import { categories, financialScope, transactions } from './financial.js';
import { householdMembers, households, profiles } from './identity.js';

/**
 * What a household administers about itself, mirroring
 * `20260907230000_household_administration.sql`.
 *
 * A person in the house is not a membership. A membership is an account that
 * signs in; a six-year-old the income has to cover is not one, and the product
 * still has to be able to name them. A split is not a second transaction: the
 * transaction keeps its amount, and the splits say how that amount divides.
 */

export const RELATIONSHIPS = ['self', 'partner', 'child', 'parent', 'sibling', 'other'] as const;

export type Relationship = (typeof RELATIONSHIPS)[number];

export const householdPeople = appSchema.table(
  'household_people',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** The membership this person signs in with, when they have one. */
    memberId: uuid('member_id').references(() => householdMembers.id, { onDelete: 'set null' }),
    displayName: text('display_name').notNull(),
    relationship: text('relationship').notNull().default('other'),
    /** Whether the household income has to cover them. Stated, never inferred. */
    isDependent: boolean('is_dependent').notNull().default(false),
    /** A year. The month and day buy nothing the product uses. */
    birthYear: smallint('birth_year'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('household_people_household_idx').on(table.householdId),
    uniqueIndex('household_people_member_unique').on(table.memberId),
  ],
);

export const transactionSplits = appSchema.table(
  'transaction_splits',
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
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    /** Positive, in the transaction's own direction. A deferred trigger holds
     *  the sum of these to the transaction's amount. */
    amount: numeric('amount', { precision: 19, scale: 4, mode: 'string' }).notNull(),
    scope: financialScope('scope').notNull().default('household'),
    personId: uuid('person_id').references(() => householdPeople.id, { onDelete: 'set null' }),
    note: text('note'),
    position: integer('position').notNull().default(0),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('transaction_splits_transaction_idx').on(table.transactionId, table.position),
    index('transaction_splits_household_idx').on(table.householdId, table.categoryId),
  ],
);

export const householdPeopleRelations = relations(householdPeople, ({ one }) => ({
  household: one(households, {
    fields: [householdPeople.householdId],
    references: [households.id],
  }),
  member: one(householdMembers, {
    fields: [householdPeople.memberId],
    references: [householdMembers.id],
  }),
}));

export const transactionSplitRelations = relations(transactionSplits, ({ one }) => ({
  transaction: one(transactions, {
    fields: [transactionSplits.transactionId],
    references: [transactions.id],
  }),
  category: one(categories, {
    fields: [transactionSplits.categoryId],
    references: [categories.id],
  }),
  person: one(householdPeople, {
    fields: [transactionSplits.personId],
    references: [householdPeople.id],
  }),
}));
