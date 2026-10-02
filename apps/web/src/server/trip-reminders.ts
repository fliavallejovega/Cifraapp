import 'server-only';

import { getAdminDb } from '@app/database';
import {
  householdMembers,
  households,
  notificationPreferences,
  profiles,
  tripChecklistItems,
  trips,
} from '@app/database/schema';
import { todayIn } from '@app/domain';
import { getClientEnv, getServerEnv } from '@app/validation/env';
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { isEnabled } from './flags';
import { dispatch, type Channel, type Recipient } from './notification-service';
import { TRIPS_FLAG } from './repositories/trips';
import { tripNoticeFor } from './trip-notice';
import type { SweepResult } from './reminders';

/**
 * The trips' daily word, inside the reminders cron.
 *
 * One notice per trip per day at most — the subject key carries the date and
 * the default throttle is a day — and only for households with Viajes on.
 * The sentence is decided by `tripNoticeFor`; this only finds the trips, the
 * people and their language, and hands each notice to the dispatcher, which
 * respects what each person chose.
 */

const KIND = 'tripDigest';
const FALLBACK: { channel: Channel; throttleHours: number } = {
  channel: 'email',
  throttleHours: 20,
};

export async function runTripReminders(): Promise<SweepResult> {
  const db = getAdminDb(getServerEnv().DIRECT_URL);
  const appUrl = getClientEnv().NEXT_PUBLIC_APP_URL;
  const homes = await db
    .select({ id: households.id, timeZone: households.timeZone })
    .from(households);

  let count = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const home of homes) {
    if (!(await isEnabled(TRIPS_FLAG, { userId: null, householdId: home.id }).catch(() => false)))
      continue;
    const today = todayIn(home.timeZone);
    const active = await db
      .select({
        id: trips.id,
        name: trips.name,
        startDate: trips.startDate,
        endDate: trips.endDate,
        status: trips.status,
      })
      .from(trips)
      .where(
        and(
          eq(trips.householdId, home.id),
          isNull(trips.archivedAt),
          notInArray(trips.status, ['completed', 'cancelled']),
        ),
      );
    if (active.length === 0) continue;
    count += 1;

    const errands = await db
      .select({
        tripId: tripChecklistItems.tripId,
        kind: tripChecklistItems.kind,
        dueOn: tripChecklistItems.dueOn,
      })
      .from(tripChecklistItems)
      .where(
        and(
          inArray(
            tripChecklistItems.tripId,
            active.map((t) => t.id),
          ),
          isNull(tripChecklistItems.doneAt),
        ),
      );

    const notices = active
      .map((trip) => ({
        trip,
        notice: tripNoticeFor({
          today,
          startDate: trip.startDate,
          endDate: trip.endDate,
          status: trip.status,
          errands: errands.filter((e) => e.tripId === trip.id),
        }),
      }))
      .filter((n) => n.notice !== null);
    if (notices.length === 0) continue;

    const people = await db
      .select({
        userId: profiles.id,
        email: profiles.email,
        displayName: profiles.displayName,
        locale: profiles.locale,
      })
      .from(householdMembers)
      .innerJoin(profiles, eq(profiles.id, householdMembers.userId))
      .where(and(eq(householdMembers.householdId, home.id), eq(householdMembers.status, 'active')));

    for (const person of people) {
      const locale = person.locale === 'en' ? 'en' : 'es';
      const t = await getTranslations({ locale, namespace: 'trips.notify' });
      const tl = await getTranslations({ locale, namespace: 'trips.checklist' });
      const [preference] = await db
        .select({
          channel: notificationPreferences.channel,
          throttleHours: notificationPreferences.throttleHours,
          isEnabled: notificationPreferences.isEnabled,
        })
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.householdId, home.id),
            eq(notificationPreferences.userId, person.userId),
            eq(notificationPreferences.kind, KIND),
          ),
        )
        .limit(1);
      const recipient: Recipient = {
        userId: person.userId,
        householdId: home.id,
        email: person.email,
        displayName: person.displayName,
        locale,
      };

      for (const { trip, notice } of notices) {
        if (!notice) continue;
        const copy =
          notice.kind === 'errands'
            ? {
                title: t('errandsTitle', { trip: trip.name, count: notice.errands.length }),
                body: notice.errands
                  .map((kind) => `· ${tl(kind as 'notify_bank', { provider: '' })}`)
                  .join('\n'),
                url: `/trips/${trip.id}`,
              }
            : notice.kind === 'tomorrow'
              ? {
                  title: t('tomorrowTitle', { trip: trip.name }),
                  body: t('tomorrowBody'),
                  url: `/trips/${trip.id}`,
                }
              : notice.kind === 'during'
                ? {
                    title: t('duringTitle', {
                      trip: trip.name,
                      day: notice.day,
                      days: notice.days,
                    }),
                    body: t('duringBody'),
                    url: `/trips/${trip.id}/today`,
                  }
                : {
                    title: t('afterTitle', { trip: trip.name }),
                    body: t('afterBody'),
                    url: `/trips/${trip.id}/report`,
                  };
        const outcome = await dispatch(
          recipient,
          { kind: KIND, subjectKey: `trip:${trip.id}:${today}`, ...copy },
          preference
            ? {
                channel: preference.channel as Channel,
                throttleHours: preference.throttleHours,
                isEnabled: preference.isEnabled,
              }
            : { ...FALLBACK, isEnabled: true },
          appUrl,
        );
        sent += outcome.sent;
        skipped += outcome.skipped;
        failed += outcome.failed;
      }
    }
  }

  return { households: count, sent, skipped, failed };
}
