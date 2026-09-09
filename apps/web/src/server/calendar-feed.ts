import 'server-only';

import { getAdminDb } from '@app/database';
import { calendarFeeds, households, obligations } from '@app/database/schema';
import {
  buildCommitmentCalendar,
  computeCoverage,
  nextOccurrence,
  type CalendarCommitment,
  type CommitmentCoverageHint,
  type Frequency,
} from '@app/budget-engine';
import { formatMoney, Money, todayIn, type CurrencyCode, type PlainDate } from '@app/domain';
import { getServerEnv } from '@app/validation/env';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { currentOccurrenceUnpaid } from './repositories/commitment-settlement';

/**
 * El calendario de compromisos, servido por una dirección secreta.
 *
 * Apple Calendar y Google Calendar suscriben un `.ics` por URL y ninguno de los
 * dos sabe iniciar sesión: piden la dirección y la leen desde sus servidores,
 * sin cookies y sin cabeceras. Eso deja una sola forma de autenticar la lectura,
 * que es que el secreto viaje en la propia dirección — y obliga a tratarlo con
 * el cuidado de una contraseña, porque una URL con un secreto acaba en un
 * historial, en una captura y en el registro de un proxy.
 *
 * De ahí las tres reglas de este archivo: el token se guarda **hasheado**, se
 * **revoca** sin borrar la fila, y detrás de él no hay **nada más** que los
 * compromisos de un hogar. Ni saldos, ni movimientos, ni sesión.
 *
 * La lectura corre con la conexión de administración porque no hay usuario que
 * la haga: el que pide es el servidor de Apple. El alcance lo pone la consulta,
 * que filtra por el hogar del token y por nada más.
 */

/** Cuántos bytes tiene un token. 32 son 256 bits: no se adivina. */
const TOKEN_BYTES = 32;

export function newFeedToken(): { token: string; hash: string; hint: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashToken(token), hint: token.slice(0, 6) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface FeedCalendar {
  readonly body: string;
  readonly householdName: string;
}

/**
 * Resuelve un token y devuelve el calendario, o nulo.
 *
 * Nulo cubre las tres formas de no tener acceso —token que no existe, revocado,
 * mal formado— sin distinguirlas hacia fuera. Decirle a quien prueba
 * direcciones cuál de las tres acertó es ayudarle a probar.
 */
export async function calendarFor(token: string): Promise<FeedCalendar | null> {
  if (token.length < 16 || token.length > 128) return null;

  const db = getAdminDb(getServerEnv().DIRECT_URL);
  const hash = hashToken(token);

  const [feed] = await db
    .select({
      id: calendarFeeds.id,
      householdId: calendarFeeds.householdId,
      tokenHash: calendarFeeds.tokenHash,
      horizonDays: calendarFeeds.horizonDays,
      revokedAt: calendarFeeds.revokedAt,
    })
    .from(calendarFeeds)
    .where(eq(calendarFeeds.tokenHash, hash))
    .limit(1);

  if (!feed || feed.revokedAt) return null;

  // La búsqueda ya fue por el hash, así que esto no decide el acceso. Está por
  // lo que costaría no estar: si algún día la búsqueda se relaja a un prefijo o
  // a un índice parcial, esta comparación sigue siendo la que manda.
  if (!sameHash(feed.tokenHash, hash)) return null;

  const [household] = await db
    .select({
      name: households.name,
      currency: households.baseCurrency,
      timeZone: households.timeZone,
    })
    .from(households)
    .where(eq(households.id, feed.householdId))
    .limit(1);

  if (!household) return null;

  const currency = (household.currency.trim() || 'USD') as CurrencyCode;
  const today = todayIn(household.timeZone);
  const horizon = addDays(today, feed.horizonDays);

  const rows = await db
    .select({
      id: obligations.id,
      name: obligations.name,
      due: obligations.dueDate,
      amount: obligations.expectedAmount,
      isEssential: obligations.isEssential,
      frequency: obligations.frequency,
      anchorDays: obligations.anchorDays,
      updatedAt: obligations.updatedAt,
    })
    .from(obligations)
    .where(
      and(
        eq(obligations.householdId, feed.householdId),
        isNull(obligations.deletedAt),
        isNull(obligations.settledTransactionId),
        currentOccurrenceUnpaid,
        // Lo que se descuenta de la planilla no es una fecha que nadie tenga que
        // recordar: pasa solo. Ponerlo en el calendario sería enseñarle a la
        // gente a ignorar el calendario.
        eq(obligations.isDeductedAtSource, false),
      ),
    )
    .orderBy(obligations.dueDate);

  const commitments: CalendarCommitment[] = rows.flatMap((row) =>
    occurrencesOf(row.due as PlainDate, row.frequency as Frequency | null, row.anchorDays, today, horizon).map(
      (due, at) => ({
        id: at === 0 ? row.id : `${row.id}-${due.replace(/-/g, '')}`,
        label: row.name,
        due,
        amount: Money.fromDecimalString(row.amount, currency),
        isEssential: row.isEssential,
        // Una revisión que sube cuando la fila cambia, para que el cliente
        // sepa que el evento se movió en vez de quedarse con el viejo.
        revision: Math.floor(row.updatedAt.getTime() / 1000) % 2_147_483_647,
      }),
    ),
  );

  const coverage = computeCoverage({
    currency,
    today,
    cash: Money.zero(currency),
    commitments: commitments.map((one) => ({
      id: one.id,
      label: one.label,
      due: one.due,
      amount: one.amount,
      isEssential: one.isEssential,
    })),
    expected: [],
    horizonDays: feed.horizonDays,
  });

  const verdicts = new Map<string, CommitmentCoverageHint>(
    coverage.commitments.map((one) => [one.id, one.verdict]),
  );

  const body = buildCommitmentCalendar(
    commitments.map((one) => {
      const verdict = verdicts.get(one.id);
      return verdict ? { ...one, coverage: verdict } : one;
    }),
    {
      name: `Cifraapp · ${household.name}`,
      description:
        'Los compromisos que Cifraapp lleva. Se actualiza solo; editarlos aquí no cambia el plan.',
      now: new Date(),
      formatAmount: (value) => formatMoney(value, { locale: 'es-PA' }),
    },
  );

  // Registrar la lectura después de haberla servido con éxito. Un enlace que
  // nadie usa y sigue vivo sólo se ve si esto está.
  await db
    .update(calendarFeeds)
    .set({ lastReadAt: new Date(), readCount: sql`${calendarFeeds.readCount} + 1` })
    .where(eq(calendarFeeds.id, feed.id));

  return { body, householdName: household.name };
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Las fechas en que cae un compromiso entre hoy y el horizonte. */
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
  // Acotado por lo mismo que la pasada de recurrencia: una cadencia que no
  // avanza no puede girar para siempre. Un compromiso diario a 400 días son
  // 400 fechas, y ese es el techo.
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
