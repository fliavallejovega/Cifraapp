import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import { profiles } from './identity.js';
import { platformSchema } from './platform.js';

/**
 * The CMS, mirroring `20260811150000_cms.sql`.
 *
 * Marketing content is data. `media_assets.alt` is `notNull` because an asset
 * with no alt text is invisible to a screen reader, and the testimonials table
 * ships empty and cannot be published without a recorded consent.
 */

export const contentStatus = pgEnum('content_status', [
  'draft',
  'scheduled',
  'published',
  'archived',
]);

export const legalKind = pgEnum('legal_kind', ['terms', 'privacy', 'tax_disclaimer', 'cookies']);

export const mediaAssets = platformSchema.table('media_assets', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),

  r2Key: text('r2_key').notNull().unique(),
  url: text('url').notNull(),

  /** Never nullable. Meaningful alt text on everything. */
  alt: text('alt').notNull(),

  width: integer('width'),
  height: integer('height'),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size'),

  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contentAuthors = platformSchema.table('content_authors', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  role: text('role'),
  bio: text('bio'),
  avatarId: uuid('avatar_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contentCategories = platformSchema.table('content_categories', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  slug: text('slug').notNull().unique(),
  nameEs: text('name_es').notNull(),
  nameEn: text('name_en').notNull(),
  descriptionEs: text('description_es'),
  descriptionEn: text('description_en'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const contentPages = platformSchema.table(
  'content_pages',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),

    kind: text('kind').notNull(),
    slug: text('slug').notNull(),
    locale: text('locale').notNull(),

    title: text('title').notNull(),
    /** For a listing. The SEO description is written for a search result instead. */
    excerpt: text('excerpt'),
    body: text('body').notNull().default(''),

    authorId: uuid('author_id').references(() => contentAuthors.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => contentCategories.id, {
      onDelete: 'set null',
    }),
    heroImageId: uuid('hero_image_id').references(() => mediaAssets.id, { onDelete: 'set null' }),

    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    canonicalUrl: text('canonical_url'),
    ogTitle: text('og_title'),
    ogDescription: text('og_description'),
    ogImageId: uuid('og_image_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    structuredData: jsonb('structured_data'),
    noIndex: boolean('no_index').notNull().default(false),

    status: contentStatus('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),

    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('content_pages_unique_slug').on(table.kind, table.slug, table.locale),
    index('content_pages_lookup_idx').on(table.kind, table.locale, table.status, table.publishedAt),
  ],
);

export const faqs = platformSchema.table('faqs', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  pageId: uuid('page_id').references(() => contentPages.id, { onDelete: 'cascade' }),
  locale: text('locale').notNull(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isPublished: boolean('is_published').notNull().default(true),
});

/**
 * Ships empty and stays empty until somebody real says something real.
 *
 * Publication requires a recorded consent — a check constraint enforces it —
 * because an unapproved quote is a support message somebody screenshotted.
 */
export const testimonials = platformSchema.table('testimonials', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  locale: text('locale').notNull(),
  quote: text('quote').notNull(),
  attribution: text('attribution').notNull(),
  role: text('role'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: text('approved_by'),
  isPublished: boolean('is_published').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const redirects = platformSchema.table('redirects', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  fromPath: text('from_path').notNull().unique(),
  toPath: text('to_path').notNull(),
  statusCode: smallint('status_code').notNull().default(301),
  isActive: boolean('is_active').notNull().default(true),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const legalDocuments = platformSchema.table(
  'legal_documents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    kind: legalKind('kind').notNull(),
    locale: text('locale').notNull(),
    version: text('version').notNull(),

    title: text('title').notNull(),
    body: text('body').notNull(),

    effectiveFrom: date('effective_from').notNull(),
    /** Null until counsel has read it. Nothing seeded here has been. */
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('legal_documents_unique_version').on(table.kind, table.locale, table.version)],
);

/** Consent is to a specific text on a specific date, or it is not consent. */
export const legalAcceptances = appSchema.table(
  'legal_acceptances',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    kind: legalKind('kind').notNull(),
    version: text('version').notNull(),
    locale: text('locale').notNull(),

    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
  },
  (table) => [unique('legal_acceptances_once').on(table.profileId, table.kind, table.version)],
);

export const contentPageRelations = relations(contentPages, ({ one, many }) => ({
  author: one(contentAuthors, {
    fields: [contentPages.authorId],
    references: [contentAuthors.id],
  }),
  category: one(contentCategories, {
    fields: [contentPages.categoryId],
    references: [contentCategories.id],
  }),
  heroImage: one(mediaAssets, {
    fields: [contentPages.heroImageId],
    references: [mediaAssets.id],
  }),
  faqs: many(faqs),
}));
