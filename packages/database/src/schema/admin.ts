import { relations, sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgEnum, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { auditSchema } from './audit.js';
import { households, profiles } from './identity.js';
import { platformSchema } from './platform.js';

/**
 * The admin platform's tables, mirroring `20260811190000_admin.sql`.
 *
 * Every table here is service-role only. The admin application checks
 * `platform.is_admin()` itself before every read, which is a deliberate trade:
 * five roles' worth of policies across the whole schema would be easy to widen
 * by accident, and an application boundary is at least obvious.
 */

export const adminRole = pgEnum('admin_role', [
  'super_admin',
  'finance_admin',
  'support_admin',
  'content_admin',
  'tax_reviewer',
]);

export const flagScope = pgEnum('flag_scope', ['global', 'organization', 'household', 'user']);

export const adminUsers = platformSchema.table('admin_users', {
  profileId: uuid('profile_id')
    .primaryKey()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  role: adminRole('role').notNull(),

  grantedBy: uuid('granted_by').references(() => profiles.id, { onDelete: 'set null' }),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  /** Disabled, never deleted: an administrator who acted must stay resolvable. */
  disabledAt: timestamp('disabled_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const featureFlags = platformSchema.table('feature_flags', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
  /** False for anything unfinished. A flag that defaults on is a release. */
  defaultEnabled: boolean('default_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const featureFlagOverrides = platformSchema.table(
  'feature_flag_overrides',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    flagKey: text('flag_key')
      .notNull()
      .references(() => featureFlags.key, { onDelete: 'cascade' }),

    scope: flagScope('scope').notNull(),
    /** Null only for the global scope. */
    targetId: uuid('target_id'),

    enabled: boolean('enabled').notNull(),
    note: text('note'),

    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('feature_flag_overrides_unique').on(table.flagKey, table.scope, table.targetId),
  ],
);

export const supportTickets = platformSchema.table(
  'support_tickets',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),

    profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'set null' }),

    subject: text('subject').notNull(),
    body: text('body').notNull(),

    /** A reference, not the transaction. Support does not read financial data. */
    transactionRef: text('transaction_ref'),

    status: text('status').notNull().default('open'),
    assignedTo: uuid('assigned_to').references(() => profiles.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [index('support_tickets_open_idx').on(table.createdAt)],
);

/** Append-only, and not readable by the administrators it records. */
export const adminActions = auditSchema.table(
  'admin_actions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => profiles.id),
    actorRole: adminRole('actor_role').notNull(),

    action: text('action').notNull(),
    targetKind: text('target_kind').notNull(),
    targetId: text('target_id'),

    /** The pair is what makes an entry answerable rather than merely present. */
    before: jsonb('before'),
    after: jsonb('after'),

    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('admin_actions_actor_idx').on(table.actorId, table.createdAt)],
);

export const adminUserRelations = relations(adminUsers, ({ one }) => ({
  profile: one(profiles, { fields: [adminUsers.profileId], references: [profiles.id] }),
}));

export const featureFlagRelations = relations(featureFlags, ({ many }) => ({
  overrides: many(featureFlagOverrides),
}));
