import 'server-only';

import { getAdminDb } from '@app/database';
import { households, tripShares } from '@app/database/schema';
import { todayIn } from '@app/domain';
import { getServerEnv } from '@app/validation/env';
import { and, eq, isNull } from 'drizzle-orm';

import { hashToken, newFeedToken } from './calendar-feed';
import { buildView, readRumboRows, type RumboView } from './rumbo';
import { queryAsUser, type Session } from './session';

/**
 * A trip shared by link, read-only.
 *
 * The token travels in the URL like the commitments calendar's, is stored
 * hashed and revoked without deleting the row. Behind it there is only the
 * itinerary: the screen it feeds shows the route, the days, the requirements
 * and the purchases to make — never an amount the household entered.
 *
 * The read runs with the admin connection because the person reading may not
 * have an account; the scope is the trip the token names and nothing else.
 */

export function newShareToken(): { token: string; hash: string; hint: string } {
  return newFeedToken();
}

export async function sharedTrip(token: string): Promise<RumboView | null> {
  if (token.length < 16 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const db = getAdminDb(getServerEnv().DIRECT_URL);
  const [share] = await db
    .select({ tripId: tripShares.tripId, householdId: tripShares.householdId })
    .from(tripShares)
    .where(and(eq(tripShares.tokenHash, hashToken(token)), isNull(tripShares.revokedAt)))
    .limit(1);
  if (!share) return null;
  const [home] = await db
    .select({ timeZone: households.timeZone })
    .from(households)
    .where(eq(households.id, share.householdId))
    .limit(1);
  const rows = await db.transaction((tx) => readRumboRows(tx, share.householdId, share.tripId));
  if (!rows) return null;
  return buildView(rows, todayIn(home?.timeZone ?? 'America/Panama'));
}

export interface ShareRow {
  readonly id: string;
  readonly hint: string;
  readonly createdAt: string;
}

/** The trip's live links, for the person to recognise and revoke. */
export async function loadTripShares(
  session: Session,
  householdId: string,
  tripId: string,
): Promise<ShareRow[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({ id: tripShares.id, hint: tripShares.hint, createdAt: tripShares.createdAt })
      .from(tripShares)
      .where(
        and(
          eq(tripShares.tripId, tripId),
          eq(tripShares.householdId, householdId),
          isNull(tripShares.revokedAt),
        ),
      ),
  );
  return rows.map((r) => ({
    id: r.id,
    hint: r.hint,
    createdAt: r.createdAt.toISOString().slice(0, 10),
  }));
}
