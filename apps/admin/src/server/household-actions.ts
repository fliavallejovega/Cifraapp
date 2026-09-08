'use server';

import { randomBytes } from 'node:crypto';

import {
  adminActions,
  auditEvents,
  householdMembers,
  households,
  profiles,
} from '@app/database/schema';
import { getClientEnv, getServerEnv } from '@app/validation/env';
import { createClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { adminDb, loadAdminSession, satisfies } from './admin-session';

/**
 * Creating a household from the console.
 *
 * The product creates a household for whoever is signed in; the console
 * creates one *for somebody else*, which is a different operation with a
 * different audit trail. It is written here rather than by calling
 * `app.create_household`, because that function takes its owner from
 * `auth.uid()` and there is no signed-in customer in this request — there is
 * an administrator acting on a customer's behalf, and the record has to say so.
 *
 * When the owner has no account yet, one is created with a temporary password
 * that is shown exactly once and never stored in clear anywhere this
 * application can read. This exists so a family can be set up for a test or a
 * hand-off; a real customer still signs up on their own.
 */

export interface CreateHouseholdResult {
  readonly error?: 'forbidden' | 'invalidName' | 'invalidEmail' | 'authFailed' | 'generic';
  readonly created?: {
    readonly id: string;
    readonly name: string;
    readonly ownerEmail: string;
    /** Present only when the account was created in this same request. */
    readonly temporaryPassword?: string;
  };
}

const CURRENCIES = new Set(['USD', 'PAB']);

export async function createHousehold(
  _previous: CreateHouseholdResult,
  formData: FormData,
): Promise<CreateHouseholdResult> {
  const session = await loadAdminSession();
  if (!session || !satisfies(session.role, 'support_admin')) return { error: 'forbidden' };

  const text = (key: string): string => {
    const value = formData.get(key);
    return typeof value === 'string' ? value.trim() : '';
  };

  const name = text('name');
  const ownerEmail = text('ownerEmail').toLowerCase();
  const currencyInput = (text('currency') || 'USD').toUpperCase();
  const currency = CURRENCIES.has(currencyInput) ? currencyInput : 'USD';
  const timeZone = text('timeZone') || 'America/Panama';

  if (name.length < 2 || name.length > 80) return { error: 'invalidName' };
  if (!ownerEmail.includes('@') || ownerEmail.length > 254) return { error: 'invalidEmail' };

  const db = adminDb();

  // The owner: an existing profile, or an account made for them now.
  let temporaryPassword: string | undefined;
  let [owner] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.email, ownerEmail))
    .limit(1);

  if (!owner) {
    const created = await createAccount(ownerEmail, timeZone);
    if (!created) return { error: 'authFailed' };
    owner = { id: created.id };
    temporaryPassword = created.password;
  }

  const ownerId = owner.id;

  try {
    const householdId = await db.transaction(async (tx) => {
      const [household] = await tx
        .insert(households)
        .values({ name, baseCurrency: currency, timeZone, createdBy: ownerId })
        .returning({ id: households.id });
      if (!household) throw new Error('insert returned no row');

      await tx.insert(householdMembers).values({
        householdId: household.id,
        userId: ownerId,
        role: 'owner',
        status: 'active',
        joinedAt: new Date(),
      });

      // The category tree every household needs. This connection is the service
      // role and has no `auth.uid()`, which migration 28 is what makes
      // acceptable here — before it, the function's membership guard rejected
      // this call and took the whole creation down with it.
      await tx.execute(sql`select app.seed_household_categories(${household.id}::uuid)`);

      // Two trails, on purpose. The household's own audit log says the
      // household was created and by whom; the administrative log says an
      // administrator did it and what they wrote.
      await tx.insert(auditEvents).values({
        actorUserId: session.profileId,
        actorRole: 'admin',
        action: 'household.created',
        entityType: 'household',
        entityId: household.id,
        householdId: household.id,
        metadata: { viaConsole: true, ownerId },
      });
      await tx.insert(adminActions).values({
        actorId: session.profileId,
        actorRole: session.role,
        action: 'household.create',
        targetKind: 'household',
        targetId: household.id,
        after: { name, ownerEmail, currency, timeZone, accountCreated: Boolean(temporaryPassword) },
      });

      return household.id;
    });

    revalidatePath('/households');

    return {
      created: {
        id: householdId,
        name,
        ownerEmail,
        ...(temporaryPassword ? { temporaryPassword } : {}),
      },
    };
  } catch {
    return { error: 'generic' };
  }
}

/**
 * Makes a sign-in for an owner who has none.
 *
 * The service role is required to create a user with a confirmed email; the
 * anonymous client would send a confirmation message to an address that, for a
 * test family, does not exist. The profile row is written here too because the
 * product only writes it on the person's first sign-in, and the membership
 * inserted above references it before that happens.
 */
async function createAccount(
  email: string,
  timeZone: string,
): Promise<{ id: string; password: string } | null> {
  const server = getServerEnv();
  const client = getClientEnv();

  const supabase = createClient(client.NEXT_PUBLIC_SUPABASE_URL, server.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 16 random bytes in base64url: 22 characters, no ambiguous ones removed
  // because it is pasted, not read over the phone.
  const password = randomBytes(16).toString('base64url');

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) return null;

  await adminDb()
    .insert(profiles)
    .values({ id: data.user.id, email, displayName: null, timeZone })
    .onConflictDoNothing({ target: profiles.id });

  return { id: data.user.id, password };
}
