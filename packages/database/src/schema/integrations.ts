import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import { importRows } from './documents.js';
import { households, profiles } from './identity.js';

/**
 * Lo que conecta el producto con el mundo de fuera: Google y el calendario.
 *
 * Espeja `20260909320000_google_connection.sql` y
 * `20260909330000_calendar_feed.sql`. Las tres tablas viven juntas porque
 * comparten la propiedad que más importa de todas ellas: **guardan un secreto
 * que abre algo ajeno al producto**. Un refresh token abre un buzón; un token de
 * calendario abre una lista de compromisos desde cualquier parte de internet sin
 * iniciar sesión. Que estén en un archivo y no repartidas es lo que hace que
 * quien revise cómo se custodian los lea todos de una vez.
 */

export const googleConnections = appSchema.table(
  'google_connections',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** De quién es el buzón. Un hogar tiene dos correos, no uno. */
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    googleEmail: text('google_email').notNull(),
    /** Cifrado con la llave del despliegue. Nunca en claro, ni en un registro. */
    refreshToken: text('refresh_token').notNull(),
    /** Lo que Google concedió, que no siempre es lo que se pidió. */
    scopes: text('scopes').array().notNull().default(sql`'{}'`),
    /** El calendario que el producto creó ahí. Nunca el principal de nadie. */
    calendarId: text('calendar_id'),
    /** El cursor incremental de Gmail. Sin él cada barrido relee el buzón. */
    gmailHistoryId: text('gmail_history_id'),
    gmailLastSyncedAt: timestamp('gmail_last_synced_at', { withTimezone: true }),
    calendarLastSyncedAt: timestamp('calendar_last_synced_at', { withTimezone: true }),
    status: text('status').notNull().default('active'),
    failedReason: text('failed_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('google_connections_household_idx').on(table.householdId)],
);

/**
 * Cada correo que ya se leyó, y qué produjo.
 *
 * Idempotencia: sin esto, un barrido que se corre dos veces mete el gasto dos
 * veces. El cuerpo no se guarda — el contenido de un aviso bancario es
 * exactamente el dato que conviene custodiar lo menos posible.
 */
export const googleMessages = appSchema.table(
  'google_messages',
  {
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => googleConnections.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    verdict: text('verdict').notNull(),
    importRowId: uuid('import_row_id').references(() => importRows.id, { onDelete: 'set null' }),
    reason: text('reason'),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId, table.messageId] }),
    index('google_messages_household_idx').on(table.householdId, table.seenAt),
  ],
);

/**
 * La dirección secreta por la que se suscribe el calendario de compromisos.
 *
 * Apple Calendar y Google Calendar no saben iniciar sesión: leen una URL desde
 * sus servidores. El secreto viaja en la dirección, y por eso se guarda
 * hasheado, se puede revocar, y no alcanza nada más que los compromisos.
 */
export const calendarFeeds = appSchema.table(
  'calendar_feeds',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    /** SHA-256 del token. El valor en claro se enseña una vez, al crearlo. */
    tokenHash: text('token_hash').notNull().unique(),
    /** Los primeros caracteres, para poder decir cuál de dos enlaces es cuál. */
    tokenHint: text('token_hint').notNull(),
    label: text('label'),
    /** Cuántos días publica. Dos años de compromisos no los mira nadie. */
    horizonDays: smallint('horizon_days').notNull().default(120),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    readCount: integer('read_count').notNull().default(0),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('calendar_feeds_household_idx').on(table.householdId)],
);
