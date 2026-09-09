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
  // Plenty of work is paid by the day — a stall, a driver, piecework — and a
  // product that only understands monthly salaries has nothing to say to those
  // households about the week they are actually living through.
  'daily',
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

    /**
     * What the payslip says before deductions, when the household stated it.
     *
     * `expectedAmount` above always stays what actually arrives, because every
     * plan, period and projection reads it as cash. This one is for
     * reconciling: a household that sees «$1,000» cannot square it with a
     * contract that says $1,400 unless both figures are on the screen.
     */
    grossAmount: numeric('gross_amount', { precision: 19, scale: 4, mode: 'string' }),

    frequency: recurrenceFrequency('frequency').notNull(),
    /** Calendar days a semimonthly series lands on; 31 means month end. */
    anchorDays: smallint('anchor_days').array(),

    /**
     * What arrives on each anchor day, when the two are not the same.
     *
     * A deduction taken once a month lands on one fortnight, not half on each,
     * so a salary of $1,500 gross can arrive as $1,203.50 on the 15th and
     * $1,053.50 on the 30th. Averaging those to $1,128.50 is right about the
     * month and wrong about both halves — and the fortnight view exists for
     * exactly the half that runs short.
     *
     * `expectedAmount` stays the average, because everything that does not
     * reason by period reads it as the month's cash. Null means the same figure
     * every time, which is the ordinary case.
     */
    anchorAmounts: numeric('anchor_amounts', { precision: 19, scale: 4, mode: 'string' }).array(),

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

/**
 * What is taken out of an income before it arrives, as the household reads it
 * off their own payslip.
 *
 * Deliberately not a rate table. Panama's contribution and withholding rates
 * live —or will live— in `platform.tax_rules`, versioned, sourced, and behind a
 * gate that refuses to show a household any figure nobody qualified has
 * reviewed. These rows are the other thing entirely: amounts a person copied
 * from a piece of paper. The product does arithmetic on them and asserts
 * nothing about what the law says they should be.
 */
export const incomeDeductions = appSchema.table(
  'income_deductions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id').notNull(),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => recurringSeries.id, { onDelete: 'cascade' }),
    /** As the payslip words it — «S.S.», «Caja de Seguro Social», «ISR». */
    label: text('label').notNull(),
    amount: numeric('amount', { precision: 19, scale: 4, mode: 'string' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    /** The order they appear on the payslip, so the screen reads like the paper. */
    sortOrder: smallint('sort_order').notNull().default(0),

    /**
     * The days this deduction is actually taken on, when it is not every one.
     *
     * Social security, education tax and income tax come off every payment —
     * they are a percentage of that period's salary and have no other shape.
     * A co-op subscription or a loan instalment comes off once a month, which
     * means one of the two fortnights. Null is «every payment», the ordinary
     * case and what every row stored before this column existed meant.
     */
    appliesToAnchors: smallint('applies_to_anchors').array(),

    /**
     * La regla que produjo esta línea, cuando se calculó en vez de escribirse.
     *
     * Una línea calculada sale de cada pago por construcción —es un porcentaje
     * del sueldo del período— y por eso nunca lleva `appliesToAnchors`: la
     * pregunta «¿en qué quincena?» no tiene respuesta para el seguro social.
     * Nulo es lo que alguien leyó de su propio papel, que es lo que significaba
     * cada fila antes de que esta columna existiera.
     */
    ruleKey: text('rule_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('income_deductions_series_idx').on(table.seriesId, table.sortOrder)],
);
