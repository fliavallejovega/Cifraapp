import { relations } from 'drizzle-orm';
import { boolean, char, integer, pgSchema, smallint, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The SaaS company's own schema. Subscriptions, invoices and the double-entry
 * ledger land here in Phases 14 and 15. Customer money never does (spec §86).
 */
export const platformSchema = pgSchema('platform');

export const schemaVersion = platformSchema.table('schema_version', {
  id: boolean('id').primaryKey().default(true),
  version: integer('version').notNull(),
  description: text('description').notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});

export const currencies = platformSchema.table('currencies', {
  code: char('code', { length: 3 }).primaryKey(),
  nameEn: text('name_en').notNull(),
  nameEs: text('name_es').notNull(),
  symbol: text('symbol').notNull(),
  minorUnits: smallint('minor_units').notNull().default(2),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const taxJurisdictions = platformSchema.table('tax_jurisdictions', {
  code: char('code', { length: 2 }).primaryKey(),
  nameEn: text('name_en').notNull(),
  nameEs: text('name_es').notNull(),
  authorityName: text('authority_name').notNull(),
  authorityUrl: text('authority_url'),
  defaultCurrency: char('default_currency', { length: 3 })
    .notNull()
    .references(() => currencies.code),
  /**
   * True only when reviewed, versioned rules exist for the jurisdiction. A row
   * here is a placeholder, not a promise of tax coverage (spec §45).
   */
  isSupported: boolean('is_supported').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const taxJurisdictionRelations = relations(taxJurisdictions, ({ one }) => ({
  currency: one(currencies, {
    fields: [taxJurisdictions.defaultCurrency],
    references: [currencies.code],
  }),
}));
