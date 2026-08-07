import { relations, sql } from 'drizzle-orm';
import {
  index,
  inet,
  jsonb,
  pgEnum,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  char,
} from 'drizzle-orm/pg-core';

import { appSchema } from './app.js';
import { auditSchema } from './audit.js';
import { currencies } from './platform.js';

/**
 * Identity and tenancy.
 *
 * These mirror `20260806130000_identity.sql`. The SQL is authoritative for
 * policies and constraints; this file exists so queries are typed and so a
 * column rename is a compile error rather than a runtime one.
 */

export const householdRole = pgEnum('household_role', [
  'owner',
  'partner',
  'member',
  'viewer',
  'accountant',
  'advisor',
]);

export const organizationKind = pgEnum('organization_kind', [
  'platform',
  'accounting_firm',
  'white_label',
]);

export const memberStatus = pgEnum('member_status', ['active', 'invited', 'revoked']);

export const profiles = appSchema.table('profiles', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  locale: text('locale').notNull().default('es'),
  timeZone: text('time_zone').notNull().default('America/Panama'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = appSchema.table('organizations', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  kind: organizationKind('kind').notNull().default('accounting_firm'),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const households = appSchema.table(
  'households',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    name: text('name').notNull(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    baseCurrency: char('base_currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),
    timeZone: text('time_zone').notNull().default('America/Panama'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('households_organization_idx').on(table.organizationId)],
);

export const householdMembers = appSchema.table(
  'household_members',
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
    role: householdRole('role').notNull().default('member'),
    status: memberStatus('status').notNull().default('active'),
    invitedBy: uuid('invited_by').references(() => profiles.id, { onDelete: 'set null' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('household_members_active_unique')
      .on(table.householdId, table.userId)
      .where(sql`status <> 'revoked'`),
    index('household_members_user_idx').on(table.userId),
  ],
);

export const householdInvitations = appSchema.table(
  'household_invitations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: householdRole('role').notNull().default('member'),
    /** Hashed. A database dump must not hand anyone a working invitation link. */
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by').references(() => profiles.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('household_invitations_household_idx').on(table.householdId)],
);

/**
 * Append only. There is no update or delete policy for this table anywhere in
 * the schema, which is the point — a trail that can be rewritten is not a trail.
 */
export const auditEvents = auditSchema.table(
  'events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    householdId: uuid('household_id'),
    organizationId: uuid('organization_id'),
    metadata: jsonb('metadata').notNull().default({}),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_household_idx').on(table.householdId, table.occurredAt),
    index('audit_events_actor_idx').on(table.actorUserId, table.occurredAt),
  ],
);

export const householdRelations = relations(households, ({ many, one }) => ({
  members: many(householdMembers),
  organization: one(organizations, {
    fields: [households.organizationId],
    references: [organizations.id],
  }),
}));

export const householdMemberRelations = relations(householdMembers, ({ one }) => ({
  household: one(households, {
    fields: [householdMembers.householdId],
    references: [households.id],
  }),
  profile: one(profiles, {
    fields: [householdMembers.userId],
    references: [profiles.id],
  }),
}));

export type HouseholdRole = (typeof householdRole.enumValues)[number];
export type MemberStatus = (typeof memberStatus.enumValues)[number];
