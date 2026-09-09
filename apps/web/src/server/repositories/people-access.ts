import 'server-only';

import {
  householdInvitations,
  householdMembers,
  householdPeople,
  profiles,
} from '@app/database/schema';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { createAdminClient } from '../supabase';
import { queryAsUser, type Session } from '../session';

/**
 * Who in the household can actually sign in, and what shape their access is in.
 *
 * The people screen listed names and nothing else, and a household reading it
 * could not answer the first question anybody asks of such a list: does Blei
 * have a way in? Two separate things were being shown as one. A *person* is
 * somebody the money has to cover — a six-year-old counts. A *membership* is an
 * account that signs in. Most people a household names never get one, and the
 * ones who should were invisible either way.
 *
 * Reading the second step is the part that costs something. Whether somebody
 * has an authenticator enrolled lives on the auth user, not in this database,
 * and there is no way to ask for several at once — so it is one call per member
 * against the admin API, issued together. `null` means the question could not
 * be answered, and it is never rendered as «no»: telling a household that
 * nobody has two-step protection when the truth is that we failed to ask would
 * be the worst possible direction to be wrong in.
 */

export interface PersonAccess {
  readonly personId: string;
  readonly displayName: string;
  readonly relationship: string;
  readonly isDependent: boolean;
  /** The membership they sign in with, when they have one. */
  readonly memberId: string | null;
  readonly userId: string | null;
  readonly email: string | null;
  readonly role: string | null;
  /** Enrolled an authenticator. Null when the auth server could not be asked. */
  readonly twoFactorEnabled: boolean | null;
  readonly lastSignInAt: Date | null;
  /** An invitation sent and not yet accepted. */
  readonly pendingInvitation: { readonly id: string; readonly email: string } | null;
}

/** A member who signs in but whom nobody has matched to a person yet. */
export interface UnlinkedMember {
  readonly memberId: string;
  readonly email: string;
  readonly role: string;
}

export interface PeopleAccessView {
  readonly people: readonly PersonAccess[];
  readonly unlinkedMembers: readonly UnlinkedMember[];
  /**
   * Whether the second step could be read at all. False turns the column into
   * an honest «no pudimos consultarlo» rather than a wrong answer.
   */
  readonly twoFactorReadable: boolean;
}

export async function loadPeopleAccess(
  session: Session,
  householdId: string,
): Promise<PeopleAccessView> {
  const { people, members, invitations } = await queryAsUser(session, async (tx) => {
    const peopleRows = await tx
      .select({
        personId: householdPeople.id,
        displayName: householdPeople.displayName,
        relationship: householdPeople.relationship,
        isDependent: householdPeople.isDependent,
        memberId: householdPeople.memberId,
        userId: householdMembers.userId,
        email: profiles.email,
        role: householdMembers.role,
      })
      .from(householdPeople)
      .leftJoin(householdMembers, eq(householdMembers.id, householdPeople.memberId))
      .leftJoin(profiles, eq(profiles.id, householdMembers.userId))
      .where(and(eq(householdPeople.householdId, householdId), isNull(householdPeople.deletedAt)))
      .orderBy(householdPeople.displayName);

    const memberRows = await tx
      .select({
        memberId: householdMembers.id,
        userId: householdMembers.userId,
        email: profiles.email,
        role: householdMembers.role,
      })
      .from(householdMembers)
      .innerJoin(profiles, eq(profiles.id, householdMembers.userId))
      .where(
        and(eq(householdMembers.householdId, householdId), eq(householdMembers.status, 'active')),
      );

    const invitationRows = await tx
      .select({
        id: householdInvitations.id,
        email: householdInvitations.email,
        personId: householdInvitations.personId,
      })
      .from(householdInvitations)
      .where(
        and(
          eq(householdInvitations.householdId, householdId),
          isNull(householdInvitations.acceptedAt),
          gt(householdInvitations.expiresAt, new Date()),
        ),
      );

    return { people: peopleRows, members: memberRows, invitations: invitationRows };
  });

  const factors = await readTwoFactor(people.map((person) => person.userId));

  const claimed = new Set(people.map((person) => person.memberId).filter(Boolean));
  // Keyed by the person the invitation was issued for. Matching on anything
  // else — the display name against the address, say — would attach Blei's
  // pending invitation to whichever row happened to be spelled the same.
  const byPerson = new Map(
    invitations.flatMap((invitation) =>
      invitation.personId === null ? [] : [[invitation.personId, invitation] as const],
    ),
  );

  return {
    twoFactorReadable: factors !== null,
    people: people.map((person) => ({
      personId: person.personId,
      displayName: person.displayName,
      relationship: person.relationship,
      isDependent: person.isDependent,
      memberId: person.memberId,
      userId: person.userId,
      email: person.email,
      role: person.role,
      twoFactorEnabled: person.userId ? (factors?.get(person.userId) ?? null) : null,
      lastSignInAt: null,
      pendingInvitation:
        person.memberId === null
          ? (() => {
              const invitation = byPerson.get(person.personId);
              return invitation ? { id: invitation.id, email: invitation.email } : null;
            })()
          : null,
    })),
    unlinkedMembers: members
      .filter((member) => !claimed.has(member.memberId))
      .map((member) => ({ memberId: member.memberId, email: member.email, role: member.role })),
  };
}

/**
 * Whether each of these users has an authenticator enrolled.
 *
 * Needs the service key: a person's own session can only ever answer for
 * themselves, and this screen is about the household. Returns null — not an
 * empty map — when the admin client is unavailable or the call fails, so the
 * caller can tell «nobody has it» apart from «we could not find out».
 */
async function readTwoFactor(
  userIds: readonly (string | null)[],
): Promise<Map<string, boolean> | null> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();

  try {
    const admin = createAdminClient();

    const entries = await Promise.all(
      ids.map(async (id): Promise<[string, boolean]> => {
        const { data, error } = await admin.auth.admin.getUserById(id);
        if (error) throw error;
        const enrolled = (data.user?.factors ?? []).some((factor) => factor.status === 'verified');
        return [id, enrolled];
      }),
    );

    return new Map(entries);
  } catch {
    // No service key in this deployment, or the auth server refused. The screen
    // says so rather than guessing.
    return null;
  }
}
