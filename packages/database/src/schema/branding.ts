import { relations, sql } from 'drizzle-orm';
import { boolean, index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { plans } from './billing.js';
import { mediaAssets } from './cms.js';
import { organizations } from './identity.js';
import { platformSchema } from './platform.js';

/**
 * White-label branding, mirroring `20260811180000_white_label.sql`.
 *
 * A firm controls presentation. It does not control what the product says about
 * money: the copy register, the tax disclaimers and the refusal to call an
 * estimate a bill are not brandable, because a household reading a rebranded
 * screen is entitled to the same honesty as one reading ours.
 */

export const organizationBranding = platformSchema.table(
  'organization_branding',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    displayName: text('display_name').notNull(),

    logoAssetId: uuid('logo_asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    faviconAssetId: uuid('favicon_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),

    /** One color. A whole palette would break the single-signal rule in DESIGN.md. */
    primaryColor: text('primary_color'),

    customDomain: text('custom_domain'),
    /** An unverified domain is never served. */
    domainVerifiedAt: timestamp('domain_verified_at', { withTimezone: true }),

    supportEmail: text('support_email'),
    emailFromName: text('email_from_name'),

    /** Null falls back to the platform's, which beats an empty page. */
    termsUrl: text('terms_url'),
    privacyUrl: text('privacy_url'),

    onboarding: jsonb('onboarding').notNull().default({}),

    defaultPlanCode: text('default_plan_code').references(() => plans.code),

    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('organization_branding_domain_idx').on(table.customDomain)],
);

export const organizationBrandingRelations = relations(organizationBranding, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationBranding.organizationId],
    references: [organizations.id],
  }),
}));
