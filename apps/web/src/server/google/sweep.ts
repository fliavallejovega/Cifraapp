import 'server-only';

import { getAdminDb } from '@app/database';
import {
  accounts,
  googleMessages,
  households,
  importRows,
  imports,
  transactions,
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
    .select({
      id: accounts.id,
      maskedNumber: accounts.maskedNumber,
      aliases: accounts.cardAliasDigits,
    })
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
    for (const alias of account.aliases) {
      if (/^\d{4}$/.test(alias) && !byLastFour.has(alias)) byLastFour.set(alias, account.id);
    }
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

    /*
      Una importación por cuenta y por barrido, no una por correo.

      Diez avisos leídos el mismo día son una tanda que se revisa junta. Pero una
      importación pertenece a una cuenta: la que juntaba todos los avisos no
      tenía ninguna, y una importación sin cuenta no se puede guardar — los
      avisos se leían y se quedaban para siempre en ninguna parte. Los que no
      dicen de qué cuenta son van aparte, a esperar a que alguien la diga.
    */
    const minute = new Date().toISOString().slice(0, 16);
    const runs = new Map<
      string,
      { id: string; found: number; created: number; duplicate: number; review: number }
    >();
    const runFor = async (accountId: string | null) => {
      const key = accountId ?? 'unassigned';
      const existing = runs.get(key);
      if (existing) return existing;
      const [run] = await db
        .insert(imports)
        .values({
          householdId: connection.householdId,
          documentId: null,
          accountId,
          source: 'email',
          status: 'review',
          format: 'email',
          idempotencyKey: `gmail:${connection.id}:${minute}:${key}`,
        })
        .onConflictDoNothing()
        .returning({ id: imports.id });
      if (!run) return null;
      const entry = { id: run.id, found: 0, created: 0, duplicate: 0, review: 0 };
      runs.set(key, entry);
      return entry;
    };

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
      // fila se recalcula cuando alguien dice de qué cuenta es.
      const candidate = alertToCandidate(
        parsed,
        accountId ?? `unassigned:${connection.householdId}`,
      );

      const run = await runFor(accountId);
      if (!run) {
        skippedCount += 1;
        continue;
      }

      // Con cuenta, la huella es la misma que producirá el estado de cuenta: si
      // ese movimiento ya está en el libro, el aviso es la misma compra.
      const [match] = accountId
        ? await db
            .select({ id: transactions.id })
            .from(transactions)
            .where(
              and(
                eq(transactions.householdId, connection.householdId),
                eq(transactions.fingerprint, candidate.fingerprint),
                isNull(transactions.deletedAt),
              ),
            )
            .limit(1)
        : [];
      const verdict = accountId === null ? 'review' : match ? 'duplicate' : 'new';

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
          verdict,
          confidence: parsed.confidence.toFixed(3),
          matchedTransactionId: match?.id ?? null,
          matchedSignals: [...parsed.signals, ...(accountId ? [`account:${accountId}`] : [])],
          // El cuerpo del correo no se guarda. Lo que se conserva es la línea
          // que se leyó de él, que es lo que hace falta para justificar la fila.
          raw: `${parsed.descriptionOriginal} · ${candidate.amount.toDecimalString()} ${currency}`,
        })
        .returning({ id: importRows.id });

      run.found += 1;
      if (verdict === 'new') run.created += 1;
      else if (verdict === 'duplicate') run.duplicate += 1;
      else run.review += 1;
      importedCount += 1;
      await note(connection, messageId, 'imported', null, row?.id ?? null);
    }

    for (const run of runs.values()) {
      await db
        .update(imports)
        .set({
          rowsFound: run.found,
          rowsNew: run.created,
          rowsDuplicate: run.duplicate,
          rowsReview: run.review,
        })
        .where(eq(imports.id, run.id));
    }

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
