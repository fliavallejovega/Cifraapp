'use server';

import {
  accountantGrants,
  householdInvitations,
  householdMembers,
  profiles,
} from '@app/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

import { requestAppOrigin } from './app-origin';
import { revalidateScreen } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Letting somebody else in.
 *
 * Three rules run through all of it:
 *
 *   - Only an owner or a partner hands out access. A viewer who could invite
 *     an owner has escalated themselves, and the check is here rather than only
 *     in the interface.
 *   - The invitation token is hashed before it is stored. A database dump must
 *     not hand anybody a working invitation link, and the only moment the plain
 *     token exists is the one where it is returned to the person who created it.
 *   - Revoking is immediate and is never a delete. «Access was revoked on the
 *     14th» and «this never happened» are different answers, and the second one
 *     is not available to a financial system.
 */

/** A week. Long enough to forward an email, short enough to matter. */
const INVITATION_DAYS = 7;

const ROLES = ['partner', 'member', 'viewer'] as const;
const SCOPES = ['read', 'comment', 'classify'] as const;

const inviteInput = z.object({
  email: z.email().max(200),
  role: z.enum(ROLES),
});

async function requireOwner(householdId: string, session: Awaited<ReturnType<typeof loadSession>>) {
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

export interface InviteResult extends RecordActionResult {
  /** The link, returned once and never stored in plain form. */
  readonly link?: string;
}

export async function inviteMember(
  _previous: InviteResult,
  formData: FormData,
): Promise<InviteResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;
  if (!(await requireOwner(householdId, session))) return { error: 'notAllowed' };

  const parsed = inviteInput.safeParse({
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
    const [existing] = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, email))
      .limit(1);

    if (existing) {
      const [member] = await tx
        .select({ id: householdMembers.id, status: householdMembers.status })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, householdId),
            eq(householdMembers.userId, existing.id),
          ),
        )
        .limit(1);

      if (member?.status === 'active') return 'alreadyMember' as const;
    }

    await tx.insert(householdInvitations).values({
      householdId,
      email,
      role: parsed.data.role,
      tokenHash,
      invitedBy: session.user.id,
      expiresAt,
    });

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateScreen(formData, 'access');

  // Returned once. The product has no mail transport wired up in most
  // deployments, and a link the person can copy is honest about that — where a
  // silent «invitation sent» would be a lie.
  return { ok: true, link: `${await requestAppOrigin()}/invitations/${token}` };
}

export async function revokeInvitation(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;
  if (!(await requireOwner(householdId, session))) return { error: 'notAllowed' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  await queryAsUser(session, (tx) =>
    tx
      .delete(householdInvitations)
      .where(
        and(
          eq(householdInvitations.id, id.data),
          eq(householdInvitations.householdId, householdId),
          isNull(householdInvitations.acceptedAt),
        ),
      ),
  );

  revalidateScreen(formData, 'access');
  return { ok: true };
}

export async function setMemberRole(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;
  if (!(await requireOwner(householdId, session))) return { error: 'notAllowed' };

  const id = z.uuid().safeParse(formData.get('id'));
  const role = z.enum(ROLES).safeParse(formData.get('role'));
  if (!id.success || !role.success) return { error: 'notFound' };

  const outcome = await queryAsUser(session, async (tx) => {
    const [member] = await tx
      .select({ userId: householdMembers.userId, role: householdMembers.role })
      .from(householdMembers)
      .where(and(eq(householdMembers.id, id.data), eq(householdMembers.householdId, householdId)))
      .limit(1);

    if (!member) return 'notFound' as const;

    // The last owner cannot demote themselves out of the household. A household
    // nobody owns cannot invite, cannot revoke, and cannot be recovered.
    if (member.role === 'owner') return 'cannotChangeOwner' as const;

    await tx
      .update(householdMembers)
      .set({ role: role.data, updatedAt: new Date() })
      .where(eq(householdMembers.id, id.data));

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateScreen(formData, 'access');
  return { ok: true };
}

export async function revokeMember(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;
  if (!(await requireOwner(householdId, session))) return { error: 'notAllowed' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const outcome = await queryAsUser(session, async (tx) => {
    const [member] = await tx
      .select({ userId: householdMembers.userId, role: householdMembers.role })
      .from(householdMembers)
      .where(and(eq(householdMembers.id, id.data), eq(householdMembers.householdId, householdId)))
      .limit(1);

    if (!member) return 'notFound' as const;
    if (member.role === 'owner') return 'cannotRemoveOwner' as const;
    if (member.userId === session.user.id) return 'cannotRemoveSelf' as const;

    await tx
      .update(householdMembers)
      .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(householdMembers.id, id.data));

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateScreen(formData, 'access');
  return { ok: true };
}

const grantInput = z.object({
  email: z.email().max(200),
  scope: z.enum(SCOPES),
  expiresInDays: z.coerce.number().int().min(0).max(3650),
});

/**
 * Granting an accountant access.
 *
 * The accountant has to already have an account: a grant points at a profile,
 * and inventing one from an email address would create a login nobody asked
 * for. The screen says so and offers the invitation flow instead.
 *
 * An expiry is offered because an access that lapses on its own beats one that
 * relies on somebody remembering. Zero days means no expiry, and the form says
 * that out loud rather than leaving a blank field to be interpreted.
 */
export async function grantAccountant(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;
  if (!(await requireOwner(householdId, session))) return { error: 'notAllowed' };

  const parsed = grantInput.safeParse({
    email: formData.get('email'),
    scope: formData.get('scope') ?? 'read',
    expiresInDays: formData.get('expiresInDays') ?? '0',
  });

  if (!parsed.success) return { error: 'emailInvalid' };

  const email = parsed.data.email.trim().toLowerCase();

  const outcome = await queryAsUser(session, async (tx) => {
    const [accountant] = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, email))
      .limit(1);

    if (!accountant) return 'accountantNotFound' as const;
    if (accountant.id === session.user.id) return 'cannotGrantSelf' as const;

    const expiresAt =
      parsed.data.expiresInDays > 0
        ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

    await tx
      .insert(accountantGrants)
      .values({
        householdId,
        accountantId: accountant.id,
        scope: parsed.data.scope,
        grantedBy: session.user.id,
        ...(expiresAt ? { expiresAt } : {}),
      })
      .onConflictDoUpdate({
        target: [accountantGrants.householdId, accountantGrants.accountantId],
        set: {
          scope: parsed.data.scope,
          grantedBy: session.user.id,
          grantedAt: new Date(),
          expiresAt,
          // Re-granting clears a previous revocation rather than leaving a row
          // that is both granted and revoked.
          revokedAt: null,
          revokedBy: null,
          revokeNote: null,
        },
      });

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateScreen(formData, 'access', 'access/accountants');
  return { ok: true };
}

export async function revokeAccountant(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;
  if (!(await requireOwner(householdId, session))) return { error: 'notAllowed' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const [revoked] = await queryAsUser(session, (tx) =>
    tx
      .update(accountantGrants)
      .set({ revokedAt: new Date(), revokedBy: session.user.id })
      .where(
        and(
          eq(accountantGrants.id, id.data),
          eq(accountantGrants.householdId, householdId),
          isNull(accountantGrants.revokedAt),
        ),
      )
      .returning({ id: accountantGrants.id }),
  );

  if (!revoked) return { error: 'notFound' };

  revalidateScreen(formData, 'access', 'access/accountants');
  return { ok: true };
}
