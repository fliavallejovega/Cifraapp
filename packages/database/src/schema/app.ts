import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Customer financial data. Every table added here from Phase 2 onward is
 * tenant-scoped and protected by row-level security; the category templates
 * below are the one exception, being global reference data.
 */
export const appSchema = pgSchema('app');

/**
 * A category's kind decides whether it counts as spending at all. Transfers and
 * income are not expenses — conflating them reports a credit card payment as
 * money spent and double-counts every movement between a user's own accounts
 * (spec §11).
 */
export const categoryKind = pgEnum('category_kind', [
  'income',
  'expense',
  'transfer',
  'investment',
]);

export const categoryTemplates = appSchema.table(
  'category_templates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    slug: text('slug').notNull().unique(),
    parentSlug: text('parent_slug'),
    nameEn: text('name_en').notNull(),
    nameEs: text('name_es').notNull(),
    kind: categoryKind('kind').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isSystem: boolean('is_system').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('category_templates_parent_idx').on(table.parentSlug)],
);

export const categoryTemplateRelations = relations(categoryTemplates, ({ one, many }) => ({
  parent: one(categoryTemplates, {
    fields: [categoryTemplates.parentSlug],
    references: [categoryTemplates.slug],
    relationName: 'category_hierarchy',
  }),
  children: many(categoryTemplates, { relationName: 'category_hierarchy' }),
}));
