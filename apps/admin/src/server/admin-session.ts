import 'server-only';

import { getAdminDb, type Database } from '@app/database';
import { adminUsers, profiles } from '@app/database/schema';
import { getServerEnv } from '@app/validation/env';
import { and, eq, isNull } from 'drizzle-orm';

import { createRequestClient } from './supabase';

/**
 * Who is allowed in here.
 *
 * Administrative access is a separate fact from being a customer. A valid
 * customer session gets you as far as this function and no further: it then
 * requires a row in `platform.admin_users` that has not been disabled, and the
 * absence of one is not an error state — it is the answer.
 *
 * The database connection is the service role, because every table this
 * application reads is service-role only. That makes authorization this
 * module's responsibility rather than a policy's, which is a real trade and
 * worth naming: the check below is the entire boundary, so nothing in this app
 * may query before calling it.
 */

export type AdminRole =
  'super_admin' | 'finance_admin' | 'support_admin' | 'content_admin' | 'tax_reviewer';

export interface AdminSession {
  readonly profileId: string;
  readonly email: string;
  readonly role: AdminRole;
}

export function adminDb(): Database {
  return getAdminDb(getServerEnv().DIRECT_URL);
}

async function currentUserId(): Promise<string | null> {
  const supabase = await createRequestClient();

  // `getUser()` rather than `getSession()`: the session comes from a cookie the
  // browser controls, and this is the one place where trusting it would be
  // catastrophic.
  const { data, error } = await supabase.auth.getUser();
  return error ? null : (data.user?.id ?? null);
}

/** The administrator for a profile id, or null. Used right after sign-in when cookies are not yet readable. */
export async function loadAdminSessionForProfileId(
  profileId: string,
): Promise<AdminSession | null> {
  const [row] = await adminDb()
    .select({ profileId: adminUsers.profileId, role: adminUsers.role, email: profiles.email })
    .from(adminUsers)
    .innerJoin(profiles, eq(profiles.id, adminUsers.profileId))
    .where(and(eq(adminUsers.profileId, profileId), isNull(adminUsers.disabledAt)))
    .limit(1);

  return row ? { profileId: row.profileId, email: row.email, role: row.role } : null;
}

/** The administrator making this request, or null. Null is an ordinary answer. */
export async function loadAdminSession(): Promise<AdminSession | null> {
  const userId = await currentUserId();
  if (!userId) return null;

  return loadAdminSessionForProfileId(userId);
}

/**
 * Whether a role satisfies a requirement.
 *
 * `super_admin` satisfies everything. Nothing else has a hierarchy: support is
 * not a lesser finance, and a content administrator is not a junior anything.
 * Modelling these as levels is how a support tool ends up able to issue refunds.
 */
export function satisfies(role: AdminRole, required: AdminRole): boolean {
  return role === 'super_admin' || role === required;
}
