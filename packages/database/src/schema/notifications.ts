import { relations, sql } from 'drizzle-orm';
import { boolean, index, primaryKey, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import { households, profiles } from './identity.js';

/**
 * Notifications, mirroring `20260907260000_notifications.sql`.
 *
 * A preference and a delivery are two different questions — what somebody wants
 * to be told, and what we actually sent — and conflating them is the standard
 * mistake. The second is the only defence against «I never got that».
 */

export const notificationPreferences = appSchema.table(
  'notification_preferences',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    channel: text('channel').notNull(),
    /** Whole hours. Zero means as it happens; 24 is a daily digest. */
    throttleHours: smallint('throttle_hours').notNull().default(0),
    isEnabled: boolean('is_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.householdId, table.userId, table.kind] })],
);

export const notificationDeliveries = appSchema.table(
  'notification_deliveries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => profiles.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    channel: text('channel').notNull(),
    /** The alert this was about, so a delivery traces back to its condition. */
    subjectKey: text('subject_key'),
    /** Rendered at send time and kept: the catalogue changes, the past does not. */
    title: text('title').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull().default('queued'),
    reason: text('reason'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notification_deliveries_household_idx').on(table.householdId, table.createdAt),
    index('notification_deliveries_throttle_idx').on(table.userId, table.kind, table.createdAt),
  ],
);

export const notificationPreferenceRelations = relations(notificationPreferences, ({ one }) => ({
  household: one(households, {
    fields: [notificationPreferences.householdId],
    references: [households.id],
  }),
}));

/**
 * A qué navegador mandarle un aviso.
 *
 * Una suscripción push es de un navegador y no de una persona: la misma persona
 * en el teléfono y en la portátil son dos, y una que se borra en uno tiene que
 * seguir viva en el otro. Por eso la llave natural es el `endpoint`.
 *
 * Las dos claves que la acompañan cifran el mensaje de punta a punta: el
 * servicio de push transporta un sobre que no puede abrir, que es exactamente
 * lo que se quiere de un tercero que mueve avisos sobre el dinero de alguien.
 */
export const pushSubscriptions = appSchema.table(
  'push_subscriptions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** La dirección que dio el navegador. Única: dos filas son dos avisos iguales. */
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    /** «Chrome en tu teléfono», para que quitar la correcta no sea adivinar. */
    label: text('label'),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    failedReason: text('failed_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('push_subscriptions_household_idx').on(table.householdId, table.userId)],
);
