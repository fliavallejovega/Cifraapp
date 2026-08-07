import 'server-only';

import { getDb, withUserContext, type Database } from '@app/database';
import { households, householdMembers, profiles } from '@app/database/schema';
import { getServerEnv } from '@app/validation/env';
import { and, eq, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';

import { getAuthenticatedUser } from './supabase';

/**
 * The bridge between an authenticated Supabase user and the household data they
 * are allowed to see.
 *
 * Every read goes through `withUserContext`, which opens a transaction, sets
 * the caller's JWT claims transaction-locally and switches to the
 * `authenticated` role — so row-level security decides what comes back, not a
 * `where` clause someone remembered to write. The settings are discarded when
 * the transaction ends, so a pooled connection cannot carry one user's identity
 * into another user's request.
 */

export interface Session {
  readonly user: User;
  readonly profile: { id: string; email: string; displayName: string | null; locale: string };
  readonly households: readonly { id: string; name: string; role: string; baseCurrency: string }[];
  readonly activeHouseholdId: string | null;
}

function database(): Database {
  return getDb(getServerEnv().DATABASE_URL);
}

function claimsFor(user: User): Record<string, unknown> {
  return { sub: user.id, role: 'authenticated', email: user.email };
}

/**
 * Reads the caller's profile and households, creating the profile on first
 * sign-in.
 *
 * Supabase owns `auth.users`; the product owns `app.profiles`. Rather than a
 * trigger on `auth.users` — which needs ownership of a schema the platform
 * manages — the row is created here, idempotently, the first time a verified
 * user arrives.
 */
export async function loadSession(): Promise<Session | null> {
  const user = await getAuthenticatedUser();
  if (!user?.email) return null;

  const db = database();

  return withUserContext(db, { userId: user.id, claims: claimsFor(user) }, async (tx) => {
    await tx
      .insert(profiles)
      .values({ id: user.id, email: user.email ?? '', displayName: displayNameOf(user) })
      .onConflictDoNothing({ target: profiles.id });

    const [profile] = await tx
      .select({
        id: profiles.id,
        email: profiles.email,
        displayName: profiles.displayName,
        locale: profiles.locale,
      })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1);

    if (!profile) return null;

    const memberships = await tx
      .select({
        id: households.id,
        name: households.name,
        role: householdMembers.role,
        baseCurrency: households.baseCurrency,
      })
      .from(householdMembers)
      .innerJoin(households, eq(households.id, householdMembers.householdId))
      .where(
        and(
          eq(householdMembers.userId, user.id),
          eq(householdMembers.status, 'active'),
          isNull(households.deletedAt),
        ),
      );

    return {
      user,
      profile,
      households: memberships,
      activeHouseholdId: memberships[0]?.id ?? null,
    };
  });
}

function displayNameOf(user: User): string | null {
  const metadata = user.user_metadata as { display_name?: unknown; full_name?: unknown };
  const candidate = metadata.display_name ?? metadata.full_name;
  return typeof candidate === 'string' && candidate.trim() !== '' ? candidate.trim() : null;
}

/** Requires a session, redirecting to sign-in when there is none. */
export async function requireSession(locale: string): Promise<Session> {
  const session = await loadSession();
  if (!session) redirect(`/${locale}/sign-in`);
  return session;
}

/**
 * Requires a session that has at least one household, sending a new user to
 * onboarding instead of an empty dashboard.
 */
export async function requireHousehold(
  locale: string,
): Promise<Session & { activeHouseholdId: string }> {
  const session = await requireSession(locale);
  if (!session.activeHouseholdId) redirect(`/${locale}/welcome`);
  return { ...session, activeHouseholdId: session.activeHouseholdId };
}

/**
 * Runs a query as the signed-in user, with RLS enforced.
 *
 * The only sanctioned way for application code to read household data. Anything
 * that reaches for the service role instead has taken on the job of tenant
 * scoping by hand, and that job is not one application code should be doing.
 */
export async function queryAsUser<T>(
  session: Session,
  work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return withUserContext(
    database(),
    { userId: session.user.id, claims: claimsFor(session.user) },
    work,
  );
}

/** Creates a household and its owner membership in one transaction. */
export async function createHousehold(
  session: Session,
  name: string,
  currency = 'USD',
  timeZone = 'America/Panama',
): Promise<string> {
  return queryAsUser(session, async (tx) => {
    const rows = await tx.execute<{ create_household: string }>(
      sql`select app.create_household(${name}, ${currency}, ${timeZone}) as create_household`,
    );
    const created = rows[0]?.create_household;
    if (!created) throw new Error('The household could not be created.');
    return created;
  });
}
