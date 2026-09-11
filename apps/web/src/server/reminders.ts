import 'server-only';

import { getAdminDb } from '@app/database';
import {
  households,
  householdMembers,
  notificationPreferences,
  obligations,
  profiles,
} from '@app/database/schema';
import { formatMoney, Money, todayIn, type CurrencyCode, type PlainDate } from '@app/domain';
import { getClientEnv, getServerEnv } from '@app/validation/env';
import { and, eq, isNull } from 'drizzle-orm';

import { dispatch, type Channel, type Notice, type Recipient } from './notification-service';

/**
 * El barrido diario que decide qué tiene sentido decir hoy.
 *
 * Cuatro recordatorios, y los cuatro comparten una regla: **solo se avisa de lo
 * que la casa puede hacer algo al respecto hoy**. Un pago que vence en dos
 * semanas no es un aviso, es ruido que enseña a ignorar los avisos; y un aviso
 * que llega el día después de la fecha es una acusación, no una ayuda.
 *
 * ## Por qué corre una vez al día y no cada hora
 *
 * Porque el plan lo permite y porque nada de lo que dice mejora con precisión
 * de minutos. «Hoy vencen estos cuatro pagos» sirve igual a las seis de la
 * mañana que a las once; lo que no sirve es llegar mañana.
 *
 * ## Lo que no hace
 *
 * No cobra, no mueve dinero y no marca nada como pagado. Son recordatorios
 * voluntarios: dicen lo que hay y la casa decide. Un producto que pagara solo
 * tendría que estar seguro de cosas de las que este no puede estar seguro.
 */

export interface SweepResult {
  readonly households: number;
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
}

/** Los días del mes en que se pide subir los estados de cuenta. */
const STATEMENT_DAYS = [1, 16] as const;

interface PreferenceRow {
  kind: string;
  channel: string;
  throttleHours: number;
  isEnabled: boolean;
}

/**
 * Lo que la persona eligió, o el default del tipo.
 *
 * Sin fila no es «apagado»: es «nadie ha dicho nada todavía», y un producto que
 * lee la ausencia como un no nunca manda el primer aviso — que es justo el que
 * le enseña a alguien que los avisos existen y que se pueden apagar.
 */
function preferenceFor(
  rows: readonly PreferenceRow[],
  kind: string,
  fallback: { channel: Channel; throttleHours: number },
): { channel: Channel; throttleHours: number; isEnabled: boolean } {
  const row = rows.find((one) => one.kind === kind);
  if (!row) return { ...fallback, isEnabled: true };
  return {
    channel: row.channel as Channel,
    throttleHours: row.throttleHours,
    isEnabled: row.isEnabled,
  };
}

export async function runDailyReminders(): Promise<SweepResult> {
  const db = getAdminDb(getServerEnv().DIRECT_URL);
  const appUrl = getClientEnv().NEXT_PUBLIC_APP_URL;

  const homes = await db
    .select({
      id: households.id,
      currency: households.baseCurrency,
      timeZone: households.timeZone,
    })
    .from(households);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const home of homes) {
    // La fecha del hogar y no la del servidor. Un aviso de «vence hoy» que se
    // calcula en UTC llega un día tarde a media América cada noche.
    const today = todayIn(home.timeZone);
    const currency = (home.currency.trim() || 'USD') as CurrencyCode;
    const money = (value: Money) => formatMoney(value, { locale: 'es-PA' });

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

    if (people.length === 0) continue;

    const notices = await noticesFor(db, home.id, today, currency, money);
    if (notices.length === 0) continue;

    for (const person of people) {
      const preferences = await db
        .select({
          kind: notificationPreferences.kind,
          channel: notificationPreferences.channel,
          throttleHours: notificationPreferences.throttleHours,
          isEnabled: notificationPreferences.isEnabled,
        })
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.householdId, home.id),
            eq(notificationPreferences.userId, person.userId),
          ),
        );

      const recipient: Recipient = {
        userId: person.userId,
        householdId: home.id,
        email: person.email,
        displayName: person.displayName,
        locale: person.locale === 'en' ? 'en' : 'es',
      };

      for (const { notice, fallback } of notices) {
        const outcome = await dispatch(
          recipient,
          notice,
          preferenceFor(preferences, notice.kind, fallback),
          appUrl,
        );
        sent += outcome.sent;
        skipped += outcome.skipped;
        failed += outcome.failed;
      }
    }
  }

  return { households: homes.length, sent, skipped, failed };
}

/**
 * Qué hay que decirle hoy a este hogar.
 *
 * Se arma una vez por hogar y se manda a cada miembro: el hecho es del hogar
 * —vencen estos pagos, toca subir los estados— y quién quiere enterarse es de
 * cada persona. Calcularlo por miembro sería hacer la misma consulta dos veces
 * para obtener el mismo resultado.
 */
async function noticesFor(
  db: ReturnType<typeof getAdminDb>,
  householdId: string,
  today: PlainDate,
  currency: CurrencyCode,
  money: (value: Money) => string,
): Promise<readonly { notice: Notice; fallback: { channel: Channel; throttleHours: number } }[]> {
  const out: { notice: Notice; fallback: { channel: Channel; throttleHours: number } }[] = [];

  // 1. Lo que vence hoy, en un solo aviso.
  //
  // Uno por pago sería cuatro correos una mañana de quincena, y cuatro correos
  // es lo mismo que ninguno: el segundo ya no se abre.
  const dueToday = await db
    .select({ name: obligations.name, amount: obligations.expectedAmount })
    .from(obligations)
    .where(
      and(
        eq(obligations.householdId, householdId),
        eq(obligations.dueDate, today),
        isNull(obligations.deletedAt),
      ),
    );

  if (dueToday.length > 0) {
    const total = Money.sum(
      dueToday.map((row) => Money.fromDecimalString(row.amount, currency)),
      currency,
    );
    const lines = dueToday
      .map((row) => `· ${row.name} — ${money(Money.fromDecimalString(row.amount, currency))}`)
      .join('\n');

    out.push({
      notice: {
        kind: 'commitmentDue',
        // Por día: dos avisos de pagos distintos el mismo día son el mismo
        // aviso, y uno de mañana es otro.
        subjectKey: `due:${today}`,
        title:
          dueToday.length === 1
            ? `Hoy vence ${dueToday[0]?.name ?? 'un pago'}`
            : `Hoy vencen ${String(dueToday.length)} pagos · ${money(total)}`,
        body: `${lines}\n\nEn total, ${money(total)}. No cobramos nada: esto es un recordatorio.`,
        url: '/commitments',
        email: {
          template: 'commitment_due',
          values: {
            es: {
              due:
                dueToday.length === 1
                  ? (dueToday[0]?.name ?? 'un pago')
                  : `${String(dueToday.length)} pagos · ${money(total)}`,
              total: money(total),
              count: String(dueToday.length),
            },
            en: {
              due:
                dueToday.length === 1
                  ? (dueToday[0]?.name ?? 'a payment')
                  : `${String(dueToday.length)} payments · ${money(total)}`,
              total: money(total),
              count: String(dueToday.length),
            },
          },
          rows: dueToday.map((row) => ({
            label: row.name,
            amount: money(Money.fromDecimalString(row.amount, currency)),
          })),
          total: money(total),
        },
      },
      fallback: { channel: 'email', throttleHours: 0 },
    });
  }

  // 2. Los estados de cuenta, dos veces al mes.
  //
  // El 1 y el 16, que parte el mes en dos mitades parejas. Sin movimientos
  // subidos, todo lo que este producto dice sobre el gasto real es una
  // suposición del hogar sobre sí mismo.
  const dayOfMonth = Number(today.slice(8, 10));
  if (STATEMENT_DAYS.includes(dayOfMonth as (typeof STATEMENT_DAYS)[number])) {
    out.push({
      notice: {
        kind: 'statementUpload',
        subjectKey: `statements:${today.slice(0, 7)}:${String(dayOfMonth)}`,
        title: 'Toca subir los estados de cuenta',
        body: 'Con los movimientos al día podemos decirte en qué se fue el dinero de verdad, y no lo que calculamos. Son dos minutos.',
        url: '/imports',
        email: { template: 'statement_upload', values: { es: {}, en: {} } },
      },
      fallback: { channel: 'email', throttleHours: 24 * 10 },
    });
  }

  return out;
}
