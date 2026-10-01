import 'server-only';

import { getAdminDb } from '@app/database';
import { computeCoverage, nextOccurrence, type Frequency } from '@app/budget-engine';
import { households, obligations } from '@app/database/schema';
import { Money, todayIn, type CurrencyCode, type PlainDate } from '@app/domain';
import { getServerEnv } from '@app/validation/env';
import { and, eq } from 'drizzle-orm';

import { activeConnections } from './connection';
import { syncCommitments, type CalendarEntry } from './calendar';

/**
 * Publica los compromisos de cada hogar conectado en su Google Calendar.
 *
 * Cuánto horizonte: noventa días. Más adelante los compromisos dejan de ser
 * recordatorios y se vuelven decoración —nadie actúa sobre un pago de dentro de
 * seis meses— y cada evento de más es uno que hay que retirar cuando el plan
 * cambie.
 *
 * Lo que se retira: lo que estaba y ya no está. Se calcula por diferencia contra
 * lo que se publicó la vez anterior... salvo que no se guarda esa lista, y a
 * propósito: mantener un espejo del calendario ajeno es mantener un estado que
 * se desincroniza en silencio. En su lugar se borra por identificador todo lo
 * que el hogar tenía y hoy no toca — `deleteEvent` trata un 404 como éxito, así
 * que borrar algo que no existe es gratis y no necesita saberse de antemano.
 */

const HORIZON_DAYS = 90;

export interface PublishResult {
  readonly connections: number;
  readonly written: number;
  readonly removed: number;
  readonly failed: number;
}

export async function publishCalendars(): Promise<PublishResult> {
  const connections = await activeConnections('calendar');
  const db = getAdminDb(getServerEnv().DIRECT_URL);

  let written = 0;
  let removed = 0;
  let failed = 0;

  for (const connection of connections) {
    const [household] = await db
      .select({ currency: households.baseCurrency, timeZone: households.timeZone })
      .from(households)
      .where(eq(households.id, connection.householdId))
      .limit(1);

    if (!household) continue;

    const currency = (household.currency.trim() || 'USD') as CurrencyCode;
    const today = todayIn(household.timeZone);
    const horizon = addDays(today, HORIZON_DAYS);

    const rows = await db
      .select({
        id: obligations.id,
        name: obligations.name,
        due: obligations.dueDate,
        amount: obligations.expectedAmount,
        isEssential: obligations.isEssential,
        frequency: obligations.frequency,
        anchorDays: obligations.anchorDays,
        settledTransactionId: obligations.settledTransactionId,
        deletedAt: obligations.deletedAt,
      })
      .from(obligations)
      .where(
        and(
          eq(obligations.householdId, connection.householdId),
          eq(obligations.isDeductedAtSource, false),
        ),
      );

    const live = rows.filter((row) => !row.deletedAt && !row.settledTransactionId);

    const entries: CalendarEntry[] = live.flatMap((row) =>
      occurrencesOf(row.due as PlainDate, row.frequency as Frequency | null, row.anchorDays, today, horizon).map(
        (due, at) => ({
          id: at === 0 ? row.id : `${row.id}-${due.replace(/-/g, '')}`,
          label: row.name,
          due,
          amount: Money.fromDecimalString(row.amount, currency),
          coverage: null,
          note: null,
        }),
      ),
    );

    // La cobertura sin efectivo: aquí no se conoce el saldo del hogar sin
    // volver a montar el plan entero, y publicar un veredicto con la mitad de
    // los datos sería peor que no publicar ninguno. Lo que sí se marca es lo
    // vencido, que no depende de ningún saldo.
    const overdue = new Set(
      computeCoverage({
        currency,
        today,
        cash: Money.zero(currency),
        commitments: entries.map((one) => ({
          id: one.id,
          label: one.label,
          due: one.due,
          amount: one.amount,
          isEssential: true,
        })),
        expected: [],
        horizonDays: HORIZON_DAYS,
      })
        .commitments.filter((one) => one.due < today)
        .map((one) => one.id),
    );

    // Lo que hay que retirar: lo saldado y lo borrado. Un 404 al borrar cuenta
    // como borrado, así que no hace falta saber si el evento seguía ahí.
    const settled = rows
      .filter((row) => row.deletedAt ?? row.settledTransactionId)
      .map((row) => row.id);

    const outcome = await syncCommitments(
      connection,
      entries.map((entry) =>
        overdue.has(entry.id) ? { ...entry, coverage: 'uncovered' as const } : entry,
      ),
      settled,
    );

    written += outcome.written;
    removed += outcome.removed;
    if (outcome.reason) failed += 1;
    failed += outcome.failed;
  }

  return { connections: connections.length, written, removed, failed };
}

function occurrencesOf(
  first: PlainDate,
  cadence: Frequency | null,
  anchorDays: readonly number[] | null,
  today: PlainDate,
  horizon: PlainDate,
): PlainDate[] {
  if (!cadence) return first <= horizon ? [first] : [];

  const dates: PlainDate[] = [];
  let date = first;
  for (let step = 0; step < 500 && date <= horizon; step += 1) {
    if (date >= today || dates.length === 0) dates.push(date);
    const next = nextOccurrence(cadence, date, anchorDays ?? undefined);
    if (next <= date) break;
    date = next;
  }
  return dates;
}

function addDays(date: PlainDate, days: number): PlainDate {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10) as PlainDate;
}
