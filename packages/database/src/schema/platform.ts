import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  integer,
  numeric,
  pgSchema,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

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

/**
 * Lo que los emisores de Panamá publicaron sobre sus tarjetas.
 *
 * Espeja `20260909400000_card_benefit_catalogue.sql`. Dato de **referencia**,
 * como las monedas: dice lo que un banco publicó, nunca lo que alguien tiene.
 * Por eso vive en `platform`, se lee sin seguridad de fila y se escribe sólo
 * por migración.
 *
 * Lo que separa esto de una lista inventada es la procedencia. Cada fila lleva
 * dónde se leyó, **cuándo**, hasta cuándo la fuente dijo que valía —nulo cuando
 * no lo dijo— y cuándo conviene reconfirmar. El catálogo sugiere; el contrato
 * del titular manda, y ninguna fila entra a la cartera de nadie sin que una
 * persona la adopte.
 */
export const cardBenefitCatalogue = platformSchema.table(
  'card_benefit_catalogue',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    /** Nulo significa «a todas»: un beneficio de la red aplica lo emita quien lo emita. */
    issuerKey: text('issuer_key'),
    network: text('network'),
    tier: text('tier'),
    /** El nombre comercial, cuando la fuente lo da. Es lo que permite comparar. */
    cardProduct: text('card_product'),
    sourceId: uuid('source_id'),
    /** El programa con nombre propio: Estrellas, ConnectMiles, Regálate. */
    program: text('program'),
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    value: text('value'),
    sourceName: text('source_name').notNull(),
    sourceUrl: text('source_url').notNull(),
    /** Cuándo se leyó. Lo que la pantalla enseña más grande. */
    capturedOn: date('captured_on').notNull(),
    /** Sólo cuando la fuente dio una fecha. Inventarla sería el problema. */
    validUntil: date('valid_until'),
    /** Sugerencia de este producto, no término del emisor. */
    reviewBy: date('review_by'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('card_benefit_catalogue_lookup_idx').on(table.issuerKey, table.network, table.tier)],
);

/**
 * Las páginas de las que salió el catálogo, releídas cada mes.
 *
 * Espeja `20260910100000_catalogue_sources_and_refresh.sql`. El barrido compara
 * una huella del contenido y marca lo que se movió; nunca reinterpreta una
 * página por su cuenta, porque hacer eso sin supervisión es como se mete una
 * cifra inventada en un producto financiero.
 */
export const catalogueSources = platformSchema.table('catalogue_sources', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  name: text('name').notNull(),
  url: text('url').notNull().unique(),
  issuerKey: text('issuer_key'),
  /** `regulator` es ACODECO: oficial, transversal y republicada con calendario. */
  kind: text('kind').notNull(),
  contentHash: text('content_hash'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }),
  lastStatus: text('last_status'),
  lastError: text('last_error'),
  needsReview: boolean('needs_review').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Un barrido. Sin esto, «se actualiza cada mes» no lo puede comprobar nadie. */
export const catalogueRefreshRuns = platformSchema.table('catalogue_refresh_runs', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  sourcesChecked: integer('sources_checked').notNull().default(0),
  sourcesChanged: integer('sources_changed').notNull().default(0),
  sourcesFailed: integer('sources_failed').notNull().default(0),
  notes: text('notes'),
});

/**
 * Las ofertas del mes: comercio, descuento, días, tope y vigencia.
 *
 * Espeja `20260910130000_card_promotions.sql`. Cubre débito y crédito, y todos
 * los emisores —incluidos aquellos donde el hogar no tiene cuenta—, porque
 * saber que el banco de al lado da 50% donde el tuyo no da nada es cómo alguien
 * decide abrir una cuenta ahí.
 *
 * `status` separa lo que una persona confirmó de lo que leyó el barrido. Una
 * promoción leída por una máquina es una pista muy buena y no es un hecho.
 */
export const cardPromotions = platformSchema.table('card_promotions', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  issuerKey: text('issuer_key').notNull(),
  issuerName: text('issuer_name').notNull(),
  networks: text('networks').array().notNull().default(sql`'{}'`),
  cardTypes: text('card_types').array().notNull().default(sql`'{}'`),
  tiers: text('tiers').array().notNull().default(sql`'{}'`),
  merchantName: text('merchant_name').notNull(),
  merchantNote: text('merchant_note'),
  category: text('category'),
  headline: text('headline').notNull(),
  detail: text('detail'),
  maxDiscount: numeric('max_discount', { precision: 19, scale: 4, mode: 'string' }),
  maxSpend: numeric('max_spend', { precision: 19, scale: 4, mode: 'string' }),
  /** ISO: 1 es lunes. Vacío es todos los días. */
  weekdays: smallint('weekdays').array().notNull().default(sql`'{}'`),
  validFrom: date('valid_from'),
  validUntil: date('valid_until'),
  channel: text('channel'),
  sourceName: text('source_name').notNull(),
  sourceUrl: text('source_url').notNull(),
  sourceId: uuid('source_id'),
  capturedOn: date('captured_on').notNull(),
  status: text('status').notNull().default('unverified'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
