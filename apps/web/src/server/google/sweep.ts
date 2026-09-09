import 'server-only';

import { getAdminDb } from '@app/database';
import {
  accounts,
  googleMessages,
  households,
  importRows,
  imports,
} from '@app/database/schema';
import { alertToCandidate, parseBankAlert } from '@app/transaction-engine';
import { type CurrencyCode } from '@app/domain';
import { getServerEnv } from '@app/validation/env';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { activeConnections, withAccessToken, type StoredConnection } from './connection';
import { alertQuery, BANK_DOMAINS, listAlertIds, readAlert } from './gmail';

/**
 * El barrido del buzón: de aviso del banco a fila en la cola de revisión.
 *
 * ## Propone, nunca decide
 *
 * Cada aviso entra como una fila de importación con veredicto de revisión, igual
 * que una línea de un PDF. No crea movimientos. La razón no es prudencia
 * genérica: un aviso y la línea del estado de cuenta del mes siguiente describen
 * la misma compra, y meterla dos veces le sube a alguien el gasto del mes sin
 * que haya gastado nada. La huella que lleva la fila es exactamente la que
 * producirá el PDF, así que el motor de duplicados las reconoce como una — y ese
 * reconocimiento es trabajo suyo, no de este archivo.
 *
 * ## Idempotente
 *
 * `google_messages` guarda cada identificador ya visto. Un barrido que se corre
 * dos veces —porque el cron reintentó, porque alguien pulsó el botón— no produce
 * nada la segunda vez. Es la única defensa real: el cursor de Gmail se puede
 * repetir legítimamente cuando una sincronización falla a la mitad.
 *
 * ## De qué cuenta salió
 *
 * De los últimos cuatro dígitos, casados contra las cuentas del hogar. Sin
 * coincidencia no se inventa una: la fila queda sin cuenta y la cola de revisión
 * la pide, que es una pregunta de un clic. Adivinar la cuenta pondría el gasto
 * en la tarjeta equivocada, y eso no se nota hasta la conciliación.
 */

export interface SweepResult {
  readonly connections: number;
  readonly read: number;
  readonly imported: number;
  readonly skipped: number;
  readonly failed: number;
}

/** Cuántos correos procesa un barrido. Un buzón grande se lee en varios. */
const MAX_PER_SWEEP = 100;

export async function sweepMailboxes(): Promise<SweepResult> {
  const connections = await activeConnections('mail');

  let read = 0;
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const connection of connections) {
    const outcome = await sweepOne(connection);
    read += outcome.read;
    imported += outcome.imported;
    skipped += outcome.skipped;
    failed += outcome.failed;
  }

  return { connections: connections.length, read, imported, skipped, failed };
}

interface OneResult {
  read: number;
  imported: number;
  skipped: number;
  failed: number;
}

async function sweepOne(connection: StoredConnection): Promise<OneResult> {
  const db = getAdminDb(getServerEnv().DIRECT_URL);
  const empty: OneResult = { read: 0, imported: 0, skipped: 0, failed: 0 };

  const [household] = await db
    .select({ currency: households.baseCurrency, timeZone: households.timeZone })
    .from(households)
    .where(eq(households.id, connection.householdId))
    .limit(1);

  if (!household) return empty;

  const currency = (household.currency.trim() || 'USD') as CurrencyCode;

  const accountRows = await db
    .select({ id: accounts.id, maskedNumber: accounts.maskedNumber })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, connection.householdId),
        eq(accounts.status, 'active'),
        isNull(accounts.deletedAt),
      ),
    );

  const byLastFour = new Map<string, string>();
  for (const account of accountRows) {
    const digits = account.maskedNumber?.replace(/\D/g, '') ?? '';
    if (digits.length >= 4) byLastFour.set(digits.slice(-4), account.id);
  }

  const result = await withAccessToken(connection, async (accessToken) => {
    const { ids } = await listAlertIds(accessToken, {
      query: alertQuery(BANK_DOMAINS),
    });

    const wanted = ids.slice(0, MAX_PER_SWEEP);
    if (wanted.length === 0) return empty;

    const seen = await db
      .select({ messageId: googleMessages.messageId })
      .from(googleMessages)
      .where(
        and(
          eq(googleMessages.connectionId, connection.id),
          inArray(googleMessages.messageId, wanted),
        ),
      );

    const already = new Set(seen.map((row) => row.messageId));
    const fresh = wanted.filter((id) => !already.has(id));
    if (fresh.length === 0) return { ...empty, skipped: wanted.length };

    // Una importación por barrido, no una por correo. Diez avisos leídos el
    // mismo día son una tanda que se revisa junta, y diez importaciones de una
    // fila convierten la pantalla de importaciones en ruido.
    const [run] = await db
      .insert(imports)
      .values({
        householdId: connection.householdId,
        documentId: null,
        source: 'email',
        status: 'review',
        format: 'email',
        idempotencyKey: `gmail:${connection.id}:${new Date().toISOString().slice(0, 16)}`,
      })
      .onConflictDoNothing()
      .returning({ id: imports.id });

    if (!run) return { ...empty, skipped: wanted.length };

    let read = 0;
    let importedCount = 0;
    let failedCount = 0;
    let skippedCount = already.size;

    for (const messageId of fresh) {
      read += 1;

      let alert;
      try {
        alert = await readAlert(accessToken, messageId, household.timeZone);
      } catch {
        failedCount += 1;
        await note(connection, messageId, 'unreadable', 'fetch_failed');
        continue;
      }

      if (!alert) {
        skippedCount += 1;
        await note(connection, messageId, 'not_a_movement', 'no_body_or_sender');
        continue;
      }

      const parsed = parseBankAlert(alert, { currency });
      if (!parsed) {
        skippedCount += 1;
        await note(connection, messageId, 'not_a_movement', 'no_movement_in_text');
        continue;
      }

      const accountId = parsed.accountHint ? (byLastFour.get(parsed.accountHint) ?? null) : null;
      // Sin cuenta resuelta la huella se calcula igual, sobre una etiqueta
      // estable, para que dos lecturas del mismo aviso sigan coincidiendo. La
      // cola de revisión pide la cuenta y la fila se recalcula al confirmarla.
      const candidate = alertToCandidate(parsed, accountId ?? `unassigned:${connection.householdId}`);

      const [row] = await db
        .insert(importRows)
        .values({
          importId: run.id,
          householdId: connection.householdId,
          transactionDate: candidate.transactionDate,
          amount: candidate.amount.toDecimalString(),
          currency,
          descriptionOriginal: candidate.descriptionOriginal,
          descriptionNormalized: candidate.descriptionNormalized,
          externalReference: candidate.externalReference ?? null,
          fingerprint: candidate.fingerprint,
          verdict: 'review',
          confidence: parsed.confidence.toFixed(3),
          matchedSignals: [...parsed.signals, ...(accountId ? [`account:${accountId}`] : [])],
          // El cuerpo del correo no se guarda. Lo que se conserva es la línea
          // que se leyó de él, que es lo que hace falta para justificar la fila.
          raw: `${parsed.descriptionOriginal} · ${candidate.amount.toDecimalString()} ${currency}`,
        })
        .returning({ id: importRows.id });

      importedCount += 1;
      await note(connection, messageId, 'imported', null, row?.id ?? null);
    }

    await db
      .update(imports)
      .set({ rowsFound: read, rowsReview: importedCount })
      .where(eq(imports.id, run.id));

    return { read, imported: importedCount, skipped: skippedCount, failed: failedCount };
  });

  return result.ok ? result.value : { ...empty, failed: 1 };
}

/** Deja constancia de qué se decidió con un correo, sin guardar el correo. */
async function note(
  connection: StoredConnection,
  messageId: string,
  verdict: 'imported' | 'not_a_movement' | 'unreadable' | 'duplicate',
  reason: string | null,
  importRowId: string | null = null,
): Promise<void> {
  await getAdminDb(getServerEnv().DIRECT_URL)
    .insert(googleMessages)
    .values({
      connectionId: connection.id,
      messageId,
      householdId: connection.householdId,
      verdict,
      reason,
      importRowId,
    })
    .onConflictDoNothing();
}
