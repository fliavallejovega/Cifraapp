import 'server-only';

import { getAdminDb } from '@app/database';
import {
  borderSystems,
  entryRules,
  householdMembers,
  households,
  notificationPreferences,
  profiles,
  trips,
} from '@app/database/schema';
import { addDays, daysBetween, todayIn, type PlainDate } from '@app/domain';
import { getClientEnv, getServerEnv } from '@app/validation/env';
import { and, eq, gte, isNotNull, isNull, lte, notInArray } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { isEnabled } from './flags';
import { dispatch, type Channel, type Recipient } from './notification-service';
import { TRIPS_FLAG } from './repositories/trips';
import type { SweepResult } from './reminders';
import { buildView, readRumboRows } from './rumbo';

/**
 * Rumbo's word on the phone, inside the daily reminders cron.
 *
 * Three things are worth interrupting someone for:
 *
 * 1. **A sale that opens tomorrow or today** for something that sells out (the
 *    Ravennaschlucht market sold 75 000 tickets in under a day).
 * 2. **A purchase due within three days** that is still pending.
 * 3. **An entry rule that changed** — a new rule, a moved ETIAS date — for a
 *    traveller whose trip is within six months. Checked weekly, on Mondays:
 *    rules change by the month, and a daily notice would teach people to
 *    ignore it.
 *
 * Rules older than 30 days need no job: every read shows them «por verificar».
 */

const KIND = 'rumbo';
const FALLBACK: { channel: Channel; throttleHours: number } = {
  channel: 'email',
  throttleHours: 20,
};
const HORIZON_DAYS = 180;

function isMonday(date: PlainDate): boolean {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
}

export async function runRumboReminders(): Promise<SweepResult> {
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
    const upcoming = await db
      .select({ id: trips.id, name: trips.name, start: trips.startDate })
      .from(trips)
      .where(
        and(
          eq(trips.householdId, home.id),
          isNull(trips.archivedAt),
          isNotNull(trips.rumboPlan),
          notInArray(trips.status, ['completed', 'cancelled']),
          gte(trips.endDate, today),
          lte(trips.startDate, addDays(today, HORIZON_DAYS)),
        ),
      );
    if (upcoming.length === 0) continue;
    count += 1;

    const weekly = isMonday(today);
    const changedRules = weekly
      ? await db
          .select({
            id: entryRules.id,
            zone: entryRules.zone,
            passport: entryRules.passportCountry,
          })
          .from(entryRules)
          .where(gte(entryRules.updatedAt, new Date(Date.parse(today) - 7 * 86_400_000)))
      : [];
    const changedSystems = weekly
      ? await db
          .select({ id: borderSystems.id })
          .from(borderSystems)
          .where(gte(borderSystems.updatedAt, new Date(Date.parse(today) - 7 * 86_400_000)))
      : [];

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

    for (const trip of upcoming) {
      const rows = await db.transaction((tx) => readRumboRows(tx, home.id, trip.id));
      if (!rows) continue;
      const view = buildView(rows, today);

      const notices: {
        subjectKey: string;
        key: string;
        params: Record<string, string>;
        url: string;
      }[] = [];
      for (const todo of view.todos) {
        if (todo.status !== 'pending') continue;
        if (todo.saleOpensOn && todo.kind === 'event_tickets') {
          const until = daysBetween(today, todo.saleOpensOn);
          if (until === 0 || until === 1) {
            notices.push({
              subjectKey: `rumbo:sale:${trip.id}:${todo.key}:${String(until)}`,
              key: until === 0 ? 'saleToday' : 'saleTomorrow',
              params: {
                trip: trip.name,
                name: todo.params['name'] ?? '',
                time: todo.params['opensAt'] ?? '',
              },
              url: `/trips/${trip.id}/route?tab=entry`,
            });
          }
          continue;
        }
        if (todo.dueOn) {
          const left = daysBetween(today, todo.dueOn);
          if (left >= 0 && left <= 3) {
            notices.push({
              subjectKey: `rumbo:due:${trip.id}:${todo.key}:${today}`,
              key: 'dueSoon',
              params: { trip: trip.name, days: String(left) },
              url: `/trips/${trip.id}/route?tab=entry`,
            });
          }
        }
      }
      const nationalities = new Set(view.travelers.flatMap((t) => t.nationalities));
      const zones = new Set(view.entry.map((v) => v.zone));
      const ruleHit = changedRules.some((r) => nationalities.has(r.passport) && zones.has(r.zone));
      if (ruleHit || (changedSystems.length > 0 && zones.has('schengen'))) {
        notices.push({
          subjectKey: `rumbo:entry:${trip.id}:${today}`,
          key: 'entryChanged',
          params: { trip: trip.name },
          url: `/trips/${trip.id}/route?tab=entry`,
        });
      }
      if (notices.length === 0) continue;

      for (const person of people) {
        const locale = person.locale === 'en' ? 'en' : 'es';
        const t = await getTranslations({ locale, namespace: 'rumbo.notify' });
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
        for (const n of notices) {
          const outcome = await dispatch(
            recipient,
            {
              kind: KIND,
              subjectKey: n.subjectKey,
              title: t(`${n.key}.title`, n.params),
              body: t(`${n.key}.body`, n.params),
              url: n.url,
            },
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
  }
  return { households: count, sent, skipped, failed };
}
