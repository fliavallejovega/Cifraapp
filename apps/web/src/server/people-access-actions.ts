'use server';

import { householdInvitations, householdMembers, householdPeople } from '@app/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

import { requestAppOrigin } from './app-origin';
import { revalidateScreen } from './revalidate';
import { loadSession, queryAsUser } from './session';
import { createRequestClient } from './supabase';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Managing a household's access from the list of its people.
 *
 * The product had two lists that never met. «Personas» holds everyone the money
 * has to cover, and «Accesos» holds the accounts that sign in, and nothing
 * connected Blei the person to blei@… the account. So the first question a
 * household asks of that list — does Blei have a way in? — had no answer on
 * either screen.
 *
 * What can be done from here is bounded by what an auth server will let one
 * person do to another's account, and that boundary is drawn honestly rather
 * than papered over:
 *
 *   - An invitation can be issued for a named person, so accepting it links
 *     the account to them.
 *   - A password can be *reset*, never read or set: the product sends the
 *     recovery mail to their address, and only they can complete it.
 *   - Whether they finished the second step can be read, and that is all.
 *     Enrolling an authenticator is done from their own device, on their own
 *     session, and a household member who could turn it on for somebody else
 *     could turn it off for them too.
 *   - Recovery codes cannot be reissued, because Supabase does not have them:
 *     it models the second step as enrolled factors, with no backup codes to
 *     regenerate. The screen says so instead of offering a button that would
 *     have to lie. The way back in for somebody who lost their authenticator is
 *     an owner removing the factor, which is `disableTwoFactor` on their own
 *     session, or support on ours.
 */

const INVITATION_DAYS = 14;
const ROLES = ['owner', 'partner', 'member', 'viewer'] as const;

/** Only an owner or a partner may change who can reach the household's money. */
async function requireOwner(
  householdId: string,
  session: Awaited<ReturnType<typeof loadSession>>,
): Promise<boolean> {
  if (!session) return false;

  const [row] = await queryAsUser(session, (tx) =>
    tx
      .select({ role: householdMembers.role })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.userId, session.user.id),
          eq(householdMembers.status, 'active'),
        ),
      )
      .limit(1),
  );

  return row?.role === 'owner' || row?.role === 'partner';
}

export interface PersonAccessResult extends RecordActionResult {
  /** The invitation link, returned once and never stored in readable form. */
  readonly link?: string;
  /** Which person the result belongs to, so one row can report its own outcome. */
  readonly personId?: string;
}

const inviteInput = z.object({
  personId: z.uuid(),
  email: z.email().max(200),
  role: z.enum(ROLES),
});

/**
 * Invites a named person to open an account on this household.
 *
 * The link comes back once rather than being announced as sent, because most
 * deployments of this product have no mail transport of their own. Saying
 * «invitación enviada» when nothing left the building is the kind of small lie
 * that costs a household a week of waiting.
 */
export async function invitePersonToAccount(
  _previous: PersonAccessResult,
  formData: FormData,
): Promise<PersonAccessResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;
  if (!(await requireOwner(householdId, session))) return { error: 'notAllowed' };

  const parsed = inviteInput.safeParse({
    personId: formData.get('personId'),
    email: formData.get('email'),
    role: formData.get('role') ?? 'member',
  });
  if (!parsed.success) return { error: 'emailInvalid' };

  const email = parsed.data.email.trim().toLowerCase();

  // 32 bytes from the OS. A guessable invitation is an unauthenticated path
  // into somebody's finances.
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);

  const outcome = await queryAsUser(session, async (tx) => {
    const [person] = await tx
      .select({ id: householdPeople.id, memberId: householdPeople.memberId })
      .from(householdPeople)
      .where(
        and(
          eq(householdPeople.id, parsed.data.personId),
          eq(householdPeople.householdId, householdId),
          isNull(householdPeople.deletedAt),
        ),
      )
      .limit(1);

    if (!person) return 'notFound' as const;
    if (person.memberId) return 'alreadyMember' as const;

    // Any earlier open invitation for this person is spent. Two live links for
    // one seat means the second acceptance finds the seat taken and fails for a
    // reason nobody can see.
    await tx
      .update(householdInvitations)
      .set({ expiresAt: new Date(0) })
      .where(
        and(
          eq(householdInvitations.householdId, householdId),
          eq(householdInvitations.personId, person.id),
          isNull(householdInvitations.acceptedAt),
        ),
      );

    await tx.insert(householdInvitations).values({
      householdId,
      email,
      role: parsed.data.role,
      tokenHash,
      invitedBy: session.user.id,
      personId: person.id,
      expiresAt,
    });

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateScreen(formData, 'people', 'access');
  return {
    ok: true,
    personId: parsed.data.personId,
    link: `${await requestAppOrigin()}/invitations/${token}`,
  };
}

/**
 * Sends the password-recovery mail to somebody's own address.
 *
 * Deliberately not an admin password change. Setting another person's password
 * would hand whoever runs the household a working key to their account, and a
 * shared-finances product is exactly where that is most tempting and most
 * wrong. This puts the recovery in their inbox and nowhere else.
 */
export async function sendPasswordReset(
  _previous: PersonAccessResult,
  formData: FormData,
): Promise<PersonAccessResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;
  if (!(await requireOwner(householdId, session))) return { error: 'notAllowed' };

  const personId = z.uuid().safeParse(formData.get('personId'));
  const email = z.email().max(200).safeParse(formData.get('email'));
  if (!personId.success || !email.success) return { error: 'notFound' };

  // The address is re-read from the household's own rows rather than trusted
  // from the form: a posted address would let a member aim a recovery mail at
  // an inbox they control.
  const [row] = await queryAsUser(session, (tx) =>
    tx
      .select({ memberId: householdPeople.memberId })
      .from(householdPeople)
      .where(
        and(
          eq(householdPeople.id, personId.data),
          eq(householdPeople.householdId, householdId),
          isNull(householdPeople.deletedAt),
        ),
      )
      .limit(1),
  );

  if (!row?.memberId) return { error: 'noAccount' };

  const supabase = await createRequestClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data.trim().toLowerCase(), {
    redirectTo: `${await requestAppOrigin()}/auth/callback?next=/reset-password`,
  });

  if (error) return { error: 'mailFailed', personId: personId.data };

  return { ok: true, personId: personId.data };
}

/**
 * Matches an account that already signs in to a person on the list.
 *
 * For every household that had members before this screen existed: their
 * accounts are real and nobody ever said whose they were.
 */
export async function linkPersonToMember(
  _previous: PersonAccessResult,
  formData: FormData,
): Promise<PersonAccessResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;
  if (!(await requireOwner(householdId, session))) return { error: 'notAllowed' };

  const personId = z.uuid().safeParse(formData.get('personId'));
  const memberId = z.union([z.uuid(), z.literal('')]).safeParse(formData.get('memberId'));
  if (!personId.success || !memberId.success) return { error: 'notFound' };

  const outcome = await queryAsUser(session, async (tx) => {
    // Unlinking is always allowed; it says «we no longer claim this account is
    // theirs», which destroys nothing.
    if (memberId.data === '') {
      await tx
        .update(householdPeople)
        .set({ memberId: null, updatedAt: new Date() })
        .where(
          and(eq(householdPeople.id, personId.data), eq(householdPeople.householdId, householdId)),
        );
      return 'ok' as const;
    }

    const [member] = await tx
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.id, memberId.data),
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.status, 'active'),
        ),
      )
      .limit(1);

    if (!member) return 'notFound' as const;

    await tx
      .update(householdPeople)
      .set({ memberId: member.id, updatedAt: new Date() })
      .where(
        and(eq(householdPeople.id, personId.data), eq(householdPeople.householdId, householdId)),
      );

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateScreen(formData, 'people', 'access');
  return { ok: true, personId: personId.data };
}

/**
 * Takes somebody's way in away, and leaves them on the list.
 *
 * Revoking access is not the same as removing a person: a partner who should no
 * longer reach the money is still somebody the money has to cover. The
 * membership is revoked rather than deleted, so the household keeps the record
 * of who could see what and until when.
 */
export async function revokePersonAccess(
  _previous: PersonAccessResult,
  formData: FormData,
): Promise<PersonAccessResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;
  if (!(await requireOwner(householdId, session))) return { error: 'notAllowed' };

  const personId = z.uuid().safeParse(formData.get('personId'));
  if (!personId.success) return { error: 'notFound' };

  const outcome = await queryAsUser(session, async (tx) => {
    const [person] = await tx
      .select({ memberId: householdPeople.memberId })
      .from(householdPeople)
      .where(
        and(eq(householdPeople.id, personId.data), eq(householdPeople.householdId, householdId)),
      )
      .limit(1);

    if (!person?.memberId) return 'noAccount' as const;

    const [member] = await tx
      .select({ userId: householdMembers.userId, role: householdMembers.role })
      .from(householdMembers)
      .where(eq(householdMembers.id, person.memberId))
      .limit(1);

    // Nobody may lock themselves out of their own household's money.
    if (member?.userId === session.user.id) return 'cannotRevokeSelf' as const;

    await tx
      .update(householdMembers)
      .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(householdMembers.id, person.memberId),
          eq(householdMembers.householdId, householdId),
        ),
      );

    await tx
      .update(householdPeople)
      .set({ memberId: null, updatedAt: new Date() })
      .where(eq(householdPeople.id, personId.data));

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateScreen(formData, 'people', 'access');
  return { ok: true, personId: personId.data };
}
