import 'server-only';

import {
  accountantGrants,
  householdInvitations,
  householdMembers,
  profiles,
} from '@app/database/schema';
import { and, desc, eq } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * Who can see this household, and on what terms.
 *
 * Three lists that are deliberately not one: a member signs in and shares the
 * household's money; an invitation is a member who has not arrived; an
 * accountant is somebody outside the household with a scoped, revocable,
 * expiring grant. Flattening them into «people with access» would put the
 * partner and the outside professional on the same row, and they are not the
 * same thing at all.
 */

export interface MemberView {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly role: string;
  readonly status: 'active' | 'invited' | 'revoked';
  readonly joinedAt: Date;
  /** True for the person reading the screen: they cannot revoke themselves. */
  readonly isSelf: boolean;
}

export interface InvitationView {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly isExpired: boolean;
}

export interface GrantView {
  readonly id: string;
  readonly accountantId: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly scope: 'read' | 'comment' | 'classify';
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly isActive: boolean;
}

export async function loadMembers(
  session: Session,
  householdId: string,
): Promise<readonly MemberView[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: householdMembers.id,
        userId: householdMembers.userId,
        email: profiles.email,
        displayName: profiles.displayName,
        role: householdMembers.role,
        status: householdMembers.status,
        joinedAt: householdMembers.joinedAt,
      })
      .from(householdMembers)
      .innerJoin(profiles, eq(profiles.id, householdMembers.userId))
      .where(eq(householdMembers.householdId, householdId))
      .orderBy(householdMembers.joinedAt),
  );

  return rows.map((row) => ({
    ...row,
    isSelf: row.userId === session.user.id,
  }));
}

export async function loadInvitations(
  session: Session,
  householdId: string,
  now: Date,
): Promise<readonly InvitationView[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: householdInvitations.id,
        email: householdInvitations.email,
        role: householdInvitations.role,
        expiresAt: householdInvitations.expiresAt,
        acceptedAt: householdInvitations.acceptedAt,
      })
      .from(householdInvitations)
      .where(eq(householdInvitations.householdId, householdId))
      .orderBy(desc(householdInvitations.createdAt))
      .limit(50),
  );

  return rows.map((row) => ({
    ...row,
    isExpired: row.acceptedAt === null && row.expiresAt < now,
  }));
}

export async function loadGrants(
  session: Session,
  householdId: string,
  now: Date,
): Promise<readonly GrantView[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: accountantGrants.id,
        accountantId: accountantGrants.accountantId,
        email: profiles.email,
        displayName: profiles.displayName,
        scope: accountantGrants.scope,
        grantedAt: accountantGrants.grantedAt,
        expiresAt: accountantGrants.expiresAt,
        revokedAt: accountantGrants.revokedAt,
      })
      .from(accountantGrants)
      .innerJoin(profiles, eq(profiles.id, accountantGrants.accountantId))
      .where(eq(accountantGrants.householdId, householdId))
      .orderBy(desc(accountantGrants.grantedAt)),
  );

  return rows.map((row) => ({
    ...row,
    isActive: row.revokedAt === null && (row.expiresAt === null || row.expiresAt > now),
  }));
}

/** Whether the reader may hand out access at all. */
export async function isOwner(session: Session, householdId: string): Promise<boolean> {
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
