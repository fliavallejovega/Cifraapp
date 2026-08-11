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
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import { households } from './identity.js';
import { currencies, platformSchema } from './platform.js';

/**
 * Billing's tables, mirroring `20260811130000_billing.sql`.
 *
 * Pricing and limits are rows so that changing them is not a deployment, and the
 * processor's event id carries a unique constraint so that a redelivered webhook
 * is a no-op rather than a second charge.
 */

const money = (name: string) => numeric(name, { precision: 19, scale: 4, mode: 'string' });

export const billingInterval = pgEnum('billing_interval', ['month', 'year']);

export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'grace',
  'canceled',
  'expired',
]);

export const plans = platformSchema.table('plans', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),

  priceAmount: money('price_amount').notNull(),
  currency: char('currency', { length: 3 })
    .notNull()
    .default('USD')
    .references(() => currencies.code),
  billingInterval: billingInterval('billing_interval').notNull().default('month'),

  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const planEntitlements = platformSchema.table(
  'plan_entitlements',
  {
    planCode: text('plan_code')
      .notNull()
      .references(() => plans.code, { onDelete: 'cascade' }),
    entitlementKey: text('entitlement_key').notNull(),
    /** Null is unlimited. Zero is "not included" — a different thing entirely. */
    limitValue: integer('limit_value'),
  },
  (table) => [primaryKey({ columns: [table.planCode, table.entitlementKey] })],
);

export const subscriptions = platformSchema.table(
  'subscriptions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    planCode: text('plan_code')
      .notNull()
      .references(() => plans.code),

    status: subscriptionStatus('status').notNull().default('trialing'),

    /** The processor's identifiers, confined to these columns. */
    provider: text('provider'),
    providerCustomerRef: text('provider_customer_ref'),
    providerSubscriptionRef: text('provider_subscription_ref'),

    currentPeriodStart: date('current_period_start').notNull(),
    currentPeriodEnd: date('current_period_end').notNull(),
    trialEndsOn: date('trial_ends_on'),

    cancelAt: date('cancel_at'),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    /** A failed payment starts a window, not an eviction. */
    graceEndsOn: date('grace_ends_on'),

    /** Per-household exceptions, in both directions. */
    entitlementOverrides: jsonb('entitlement_overrides').notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('subscriptions_one_active_per_household').on(table.householdId),
    index('subscriptions_provider_ref_idx').on(table.provider, table.providerSubscriptionRef),
  ],
);

export const billingEvents = platformSchema.table(
  'billing_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    provider: text('provider').notNull(),
    /** The idempotency key. Two deliveries race here rather than in application code. */
    eventId: text('event_id').notNull(),

    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),

    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    outcome: text('outcome'),
  },
  (table) => [unique('billing_events_unique').on(table.provider, table.eventId)],
);

export const invoices = platformSchema.table(
  'invoices',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),

    provider: text('provider'),
    providerInvoiceRef: text('provider_invoice_ref'),

    amount: money('amount').notNull(),
    currency: char('currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),
    status: text('status').notNull(),

    issuedOn: date('issued_on').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('invoices_provider_ref_unique').on(table.provider, table.providerInvoiceRef)],
);

export const usageCounters = appSchema.table(
  'usage_counters',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    entitlementKey: text('entitlement_key').notNull(),
    periodStart: date('period_start').notNull(),

    used: integer('used').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.entitlementKey, table.periodStart] }),
  ],
);

export const planRelations = relations(plans, ({ many }) => ({
  entitlements: many(planEntitlements),
  subscriptions: many(subscriptions),
}));

export const subscriptionRelations = relations(subscriptions, ({ one, many }) => ({
  plan: one(plans, { fields: [subscriptions.planCode], references: [plans.code] }),
  household: one(households, {
    fields: [subscriptions.householdId],
    references: [households.id],
  }),
  invoices: many(invoices),
}));
