'use server';

import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { getServerEnv } from '@app/validation/env';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createHousehold as createHouseholdRow } from './session';
import { recordName } from './record-input';
import { localeOf } from './revalidate';
import { ACTIVE_HOUSEHOLD_COOKIE, loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Belonging to more than one household.
 *
 * A person who keeps their own finances and also helps their parents with
 * theirs is not an edge case; it is the second most common shape after «one
 * household, two people». The switch is a cookie rather than a URL segment,
 * because otherwise every product route would have to carry it, and rather than
 * a profile column, because it is a per-device view preference and not a fact
 * about the person.
 *
 * The cookie is never trusted on read: `loadSession` matches it against the
 * memberships the database returned and falls back to the first when it does
 * not match, so a stale or forged value shows a household the person is
 * actually in.
 */

/** A year. Long enough that nobody re-chooses on every visit. */
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * The cookie's settings, in one place.
 *
 * `httpOnly` because nothing in the browser needs to read which household is
 * active — the server decides that on every request. `secure` follows the
 * deployment's own view of where it is running, read through the validated
 * environment rather than from `process.env` directly. Preview deployments are
 * served over HTTPS too, so anything but local development gets the flag.
 */
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: getServerEnv().APP_ENV !== 'development',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };
}

export async function switchHousehold(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  // Checked against the session's own memberships rather than the database:
  // this is exactly the list the person is allowed to switch between.
  if (!session.households.some((household) => household.id === id.data)) {
    return { error: 'notFound' };
  }

  const store = await cookies();
  store.set(ACTIVE_HOUSEHOLD_COOKIE, id.data, cookieOptions());

  const locale = localeOf(formData);
  // Everything on screen belongs to the household that just changed.
  revalidatePath(`/${locale}`, 'layout');

  redirect(`/${locale}/overview`);
}

export async function createAnotherHousehold(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session) return { error: 'signInRequired' };

  const name = recordName.safeParse(formData.get('name'));
  if (!name.success) return { error: 'nameRequired' };

  const created = await createHouseholdRow(session, name.data);

  const store = await cookies();
  store.set(ACTIVE_HOUSEHOLD_COOKIE, created, cookieOptions());

  const locale = localeOf(formData);
  revalidatePath(`/${locale}`, 'layout');

  redirect(`/${locale}/welcome`);
}

/**
 * Accepting an invitation.
 *
 * The token in the link is hashed and compared against the stored hash — the
 * plain token exists only in the link itself, so a database dump hands nobody a
 * working invitation.
 *
 * Three things have to be true, and each failure is reported as itself: the
 * invitation exists, it has not expired, and it has not already been used.
 * «Invalid link» for all three would leave somebody unable to tell a typo from
 * an invitation their partner already accepted.
 */
/** What `app.accept_invitation` answers. Every branch is an ordinary outcome. */
interface AcceptOutcome {
  readonly state: 'ok' | 'invalid' | 'wrongAccount' | 'signInRequired';
  readonly householdId?: string;
}

export async function acceptInvitation(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session) return { error: 'signInRequired' };

  const token = z.string().min(10).max(200).safeParse(formData.get('token'));
  if (!token.success) return { error: 'notFound' };

  const tokenHash = createHash('sha256').update(token.data).digest('hex');

  // One statement, in the database, rather than a read followed by a write
  // here. Joining is the single membership write performed by somebody who is
  // not yet a member, so the row-level policy — which requires an owner —
  // refuses it, and rightly: a policy loose enough to allow it would let
  // anybody add themselves to any household id they could guess. The authority
  // comes from the invitation, and `app.accept_invitation` is where that is
  // checked and acted on together.
  const rows = await queryAsUser(session, (tx) =>
    tx.execute<{ accept_invitation: AcceptOutcome }>(
      sql`select app.accept_invitation(${tokenHash}) as accept_invitation`,
    ),
  );

  const outcome = rows[0]?.accept_invitation ?? { state: 'invalid' as const };

  if (outcome.state !== 'ok' || !outcome.householdId) {
    return { error: outcome.state === 'ok' ? 'notFound' : outcome.state };
  }

  const store = await cookies();
  store.set(ACTIVE_HOUSEHOLD_COOKIE, outcome.householdId, cookieOptions());

  const locale = localeOf(formData);
  revalidatePath(`/${locale}`, 'layout');

  redirect(`/${locale}/overview`);
}
