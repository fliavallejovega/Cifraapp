import 'server-only';

import {
  accountantGrants,
  accountantNotes,
  accountantRequests,
  accountingPeriods,
  households,
  transactions,
} from '@app/database/schema';
import { and, count, eq, isNull, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * The accountant's own view.
 *
 * Every query here runs through `queryAsUser`, so what comes back is decided by
 * the grant policies in the database rather than by a filter written here. If a
 * grant is revoked mid-session the next read returns nothing — there is no
 * cached list of clients, and no code path that would keep serving one.
 *
 * The client list is deliberately thin. An accountant sees a household's
 * financial picture; they do not see who else lives in it, what it pays for the
 * product, or what it asked an assistant. That is enforced by the absence of a
 * policy on those tables, not by this file remembering not to ask.
 */

export interface ClientSummary {
  readonly householdId: string;
  readonly name: string;
  readonly scope: 'read' | 'comment' | 'classify';
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
  /** Transactions the household has not categorized. The accountant's first job. */
  readonly uncategorized: number;
  readonly openRequests: number;
  readonly lastClosedPeriod: string | null;
}

export async function listClients(session: Session): Promise<readonly ClientSummary[]> {
  return queryAsUser(session, async (tx) => {
    const grants = await tx
      .select({
        householdId: accountantGrants.householdId,
        scope: accountantGrants.scope,
        grantedAt: accountantGrants.grantedAt,
        expiresAt: accountantGrants.expiresAt,
        name: households.name,
      })
      .from(accountantGrants)
      .innerJoin(households, eq(households.id, accountantGrants.householdId))
      .where(
        and(
          eq(accountantGrants.accountantId, session.profile.id),
          isNull(accountantGrants.revokedAt),
        ),
      );

    return Promise.all(
      grants.map(async (grant) => {
        const [uncategorized] = await tx
          .select({ value: count() })
          .from(transactions)
          .where(
            and(
              eq(transactions.householdId, grant.householdId),
              isNull(transactions.categoryId),
              isNull(transactions.deletedAt),
            ),
          );

        const [open] = await tx
          .select({ value: count() })
          .from(accountantRequests)
          .where(
            and(
              eq(accountantRequests.householdId, grant.householdId),
              eq(accountantRequests.status, 'open'),
            ),
          );

        const [closed] = await tx
          .select({ periodEnd: accountingPeriods.periodEnd })
          .from(accountingPeriods)
          .where(
            and(
              eq(accountingPeriods.householdId, grant.householdId),
              eq(accountingPeriods.status, 'closed'),
            ),
          )
          .orderBy(sql`${accountingPeriods.periodEnd} desc`)
          .limit(1);

        return {
          householdId: grant.householdId,
          name: grant.name,
          scope: grant.scope,
          grantedAt: grant.grantedAt,
          expiresAt: grant.expiresAt,
          uncategorized: uncategorized?.value ?? 0,
          openRequests: open?.value ?? 0,
          lastClosedPeriod: closed?.periodEnd ?? null,
        };
      }),
    );
  });
}

export interface ClientDetail extends ClientSummary {
  readonly notes: readonly { id: string; body: string; createdAt: Date }[];
}

/**
 * One client, or null.
 *
 * Null covers both "no such household" and "no grant on it", and the two are
 * deliberately indistinguishable from outside. Telling an accountant that a
 * household exists but they cannot see it is an enumeration oracle.
 */
export async function loadClient(
  session: Session,
  householdId: string,
): Promise<ClientDetail | null> {
  const clients = await listClients(session);
  const summary = clients.find((client) => client.householdId === householdId);
  if (!summary) return null;

  const notes = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: accountantNotes.id,
        body: accountantNotes.body,
        createdAt: accountantNotes.createdAt,
      })
      .from(accountantNotes)
      .where(eq(accountantNotes.householdId, householdId))
      .orderBy(sql`${accountantNotes.createdAt} desc`)
      .limit(50),
  );

  return { ...summary, notes };
}
