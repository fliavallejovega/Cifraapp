'use server';

import { householdSettings, receivables, transactions } from '@app/database/schema';
import { Money, type CurrencyCode } from '@app/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { currencyOf } from './household-context';
import { firstIssueKey, positiveAmount, recordName } from './record-input';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * What the household is owed: recording it, and closing it against real money.
 *
 * Nothing in the product created one of these except the setup questionnaire,
 * which meant an independent professional could state their pipeline once, on
 * day one, and never again. That is precisely backwards — the pipeline is the
 * part that changes weekly.
 *
 * The window is the addition that makes this useful. «Entre el 1 y el 10» is
 * what a freelancer actually knows, and it is enough to build a calendar with.
 * It is not enough to spend against, and nothing here changes that: a
 * receivable never reaches `safeToSpend`, whatever its confidence.
 */

const CONFIDENCES = ['confirmed', 'likely', 'estimated'] as const;

const optionalDate = z.preprocess(
  (value) => (value === '' || value === null || value === undefined ? undefined : value),
  z.iso.date().optional(),
);

const receivableInput = z
  .object({
    name: recordName,
    source: z.string().trim().max(120).optional(),
    amount: positiveAmount,
    expectedFrom: optionalDate,
    expectedTo: optionalDate,
    confidence: z.enum(CONFIDENCES).default('estimated'),
    notes: z.string().trim().max(500).optional(),
  })
  // A window that ends before it starts is a typo, and storing it would put a
  // negative stretch of calendar into the plan.
  .refine(
    (value) => !value.expectedFrom || !value.expectedTo || value.expectedFrom <= value.expectedTo,
    { path: ['expectedTo'], message: 'windowInverted' },
  );

const FIELD_ERRORS = {
  name: 'nameRequired',
  amount: 'amountInvalid',
  expectedFrom: 'dateInvalid',
  expectedTo: 'windowInverted',
} as const;

function parse(formData: FormData) {
  const from = formData.get('expectedFrom');
  const to = formData.get('expectedTo');

  return receivableInput.safeParse({
    name: formData.get('name'),
    source: formData.get('source') ?? undefined,
    amount: formData.get('amount'),
    expectedFrom: from,
    // One date typed and the other blank means an exact day, not half a
    // window. Filling it in here keeps every reader downstream from having to
    // handle a third shape.
    expectedTo: to === '' || to === null ? from : to,
    confidence: formData.get('confidence') ?? 'estimated',
    notes: formData.get('notes') ?? undefined,
  });
}

/**
 * Aparta el impuesto en el mismo movimiento en que se cobra.
 *
 * A un asalariado le retienen. A un independiente no le retiene nadie: cobra el
 * 100% de la factura, la gasta, y descubre en la declaración que una parte de
 * ese dinero nunca fue suyo. El único momento en que apartarlo es indoloro es
 * este, y por eso no es un botón aparte: va pegado al acto de dar por cobrado.
 *
 * ## De dónde sale el porcentaje
 *
 * De `household_settings.tax_reserve_rate`, que la casa fija en Ajustes y que la
 * pantalla de reserva ya enseñaba. Una sola fuente: un segundo porcentaje en el
 * perfil fiscal dejaría la pregunta «¿cuál manda?» sin buena respuesta el día
 * que difieran.
 *
 * **No** sale de las reglas de Panamá cargadas en `platform.tax_rule_sets`: son
 * un borrador que nadie con credenciales revisó, y calcular una reserva con
 * ellas sería presentar una cifra fiscal sin respaldo — exactamente lo que
 * `CLAUDE.md` prohíbe. Sin tasa declarada no se aparta nada, y la pantalla lo
 * dice en vez de fingir que sí.
 *
 * ## Por qué se congela la tasa junto al monto
 *
 * Porque subir la tasa en junio no puede cambiar lo que marzo reservó. Guardar
 * sólo el porcentaje y recalcular hacia atrás reescribiría la historia del
 * hogar cada vez que alguien mueve un ajuste.
 *
 * El producto no mueve dinero entre cuentas de un banco real. Lo que hace esta
 * reserva es dejar de contar ese dinero como disponible —el plan lo deduce— y
 * nombrar la cuenta a la que la casa dijo que lo pasa.
 */
export async function reserveOnReceipt(
  tx: Parameters<Parameters<typeof queryAsUser<unknown>>[1]>[0],
  input: {
    householdId: string;
    receivableId: string;
    amount: string;
    currency: CurrencyCode;
  },
): Promise<{ reserved: Money; rate: string | null }> {
  const zero = Money.zero(input.currency);

  const [settings] = await tx
    .select({ rate: householdSettings.taxReserveRate })
    .from(householdSettings)
    .where(eq(householdSettings.householdId, input.householdId))
    .limit(1);

  const rate = settings?.rate ?? null;
  if (!rate || Number(rate) <= 0) return { reserved: zero, rate: null };

  const gross = Money.fromDecimalString(input.amount, input.currency);
  // El redondeo a favor de la reserva no: `percentage` redondea a la mitad
  // hacia arriba como todo lo demás del sistema, y una reserva un centavo más
  // alta que el cobro la rechaza la base. `Money.min` cierra ese borde.
  const reserved = Money.min(gross.percentage(rate), gross);

  await tx
    .update(receivables)
    .set({ taxReserved: reserved.toDecimalString(), taxReservedRate: rate })
    .where(eq(receivables.id, input.receivableId));

  return { reserved, rate };
}

export async function createReceivable(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;

  const [created] = await queryAsUser(session, (tx) =>
    tx
      .insert(receivables)
      .values({
        householdId,
        name: parsed.data.name,
        source: parsed.data.source ?? null,
        amount: parsed.data.amount,
        currency: currencyOf(session, householdId),
        expectedFrom: parsed.data.expectedFrom ?? null,
        expectedTo: parsed.data.expectedTo ?? null,
        // Kept in step for anything still reading the single date.
        expectedOn:
          parsed.data.expectedFrom && parsed.data.expectedFrom === parsed.data.expectedTo
            ? parsed.data.expectedFrom
            : null,
        confidence: parsed.data.confidence,
        notes: parsed.data.notes ?? null,
      })
      .returning({ id: receivables.id }),
  );

  if (!created) return { error: 'createFailed' };

  revalidateFinancials(formData);
  return { created: created.id };
}

export async function updateReceivable(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(receivables)
      .set({
        name: parsed.data.name,
        source: parsed.data.source ?? null,
        amount: parsed.data.amount,
        expectedFrom: parsed.data.expectedFrom ?? null,
        expectedTo: parsed.data.expectedTo ?? null,
        expectedOn:
          parsed.data.expectedFrom && parsed.data.expectedFrom === parsed.data.expectedTo
            ? parsed.data.expectedFrom
            : null,
        confidence: parsed.data.confidence,
        notes: parsed.data.notes ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(receivables.id, id.data),
          eq(receivables.householdId, householdId),
          isNull(receivables.deletedAt),
        ),
      )
      .returning({ id: receivables.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

export async function removeReceivable(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const [removed] = await queryAsUser(session, (tx) =>
    tx
      .update(receivables)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(receivables.id, id.data),
          eq(receivables.householdId, householdId),
          isNull(receivables.deletedAt),
        ),
      )
      .returning({ id: receivables.id }),
  );

  if (!removed) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * Closing an expectation against the movement that actually paid it.
 *
 * The match is confirmed by a person and never applied by the matcher, and the
 * reason is not caution for its own sake: settling the wrong receivable writes
 * off an invoice nobody paid, and the household stops chasing money it is still
 * owed. The proposal does the looking; the household does the deciding.
 *
 * The date recorded is the movement's, not today's. When it was collected is a
 * fact about the money, and stamping the day somebody got round to confirming
 * it would quietly move every collection forward in the record.
 */
export async function confirmReceivableMatch(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const receivableId = z.uuid().safeParse(formData.get('receivableId'));
  const transactionId = z.uuid().safeParse(formData.get('transactionId'));
  if (!receivableId.success || !transactionId.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    const [movement] = await tx
      .select({ id: transactions.id, date: transactions.transactionDate })
      .from(transactions)
      .where(
        and(
          eq(transactions.id, transactionId.data),
          eq(transactions.householdId, householdId),
          eq(transactions.direction, 'inflow'),
          isNull(transactions.deletedAt),
        ),
      )
      .limit(1);

    if (!movement) return 'notFound' as const;

    // A movement already claimed by another expectation must not be spent
    // twice; the partial unique index refuses it, and this is the readable
    // half of that guard.
    const [claimed] = await tx
      .select({ id: receivables.id })
      .from(receivables)
      .where(and(eq(receivables.receivedTransactionId, movement.id), isNull(receivables.deletedAt)))
      .limit(1);

    if (claimed && claimed.id !== receivableId.data) return 'alreadyMatched' as const;

    const [updated] = await tx
      .update(receivables)
      .set({
        receivedOn: movement.date,
        receivedTransactionId: movement.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(receivables.id, receivableId.data),
          eq(receivables.householdId, householdId),
          isNull(receivables.deletedAt),
        ),
      )
      .returning({ id: receivables.id, amount: receivables.amount });

    if (!updated) return 'notFound' as const;

    // Y en el mismo paso, la tajada del impuesto. Dentro de la transacción a
    // propósito: un cobro dado por recibido cuya reserva falló después dejaría
    // al hogar creyendo que apartó algo que no apartó.
    await reserveOnReceipt(tx, {
      householdId,
      receivableId: updated.id,
      amount: updated.amount,
      currency: currencyOf(session, householdId) as CurrencyCode,
    });

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  return { ok: true };
}

/** Undoing a collection, when the match turned out to be the wrong money. */
export async function reopenReceivable(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(receivables)
      // La reserva se va con el cobro. Dejarla dejaría al plan deduciendo un
      // impuesto sobre dinero que el hogar acaba de decir que nunca entró.
      .set({
        receivedOn: null,
        receivedTransactionId: null,
        taxReserved: '0',
        taxReservedRate: null,
        taxReleasedOn: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(receivables.id, id.data),
          eq(receivables.householdId, householdId),
          isNull(receivables.deletedAt),
        ),
      )
      .returning({ id: receivables.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * Dar por cobrado a mano, sin haber importado nada.
 *
 * Casi todo el mundo cobra antes de subir el estado de cuenta, y obligar a
 * importar para poder marcar un cobro convierte una acción de dos segundos en
 * una tarea de fin de mes. La diferencia con la conciliación se conserva en la
 * fila: `receivedTransactionId` queda nulo, y eso es lo que distingue «lo cobré»
 * de «aquí está el depósito que lo cobró» cuando alguien lo mire en marzo.
 *
 * La reserva fiscal se aparta igual. Que el respaldo sea la palabra de la casa y
 * no un movimiento no cambia que ese dinero entró y que una parte no es suyo.
 */
export async function markReceivableReceived(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  const on = z.iso.date().safeParse(formData.get('receivedOn'));
  if (!id.success || !on.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    const [updated] = await tx
      .update(receivables)
      .set({ receivedOn: on.data, updatedAt: new Date() })
      .where(
        and(
          eq(receivables.id, id.data),
          eq(receivables.householdId, householdId),
          isNull(receivables.receivedOn),
          isNull(receivables.deletedAt),
        ),
      )
      .returning({ id: receivables.id, amount: receivables.amount });

    if (!updated) return 'notFound' as const;

    await reserveOnReceipt(tx, {
      householdId,
      receivableId: updated.id,
      amount: updated.amount,
      currency: currencyOf(session, householdId) as CurrencyCode,
    });

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * Liberar la reserva, porque el impuesto ya se pagó.
 *
 * Hasta aquí la reserva era una deducción viva del disponible. Liberarla no
 * borra el dato —queda cuánto se apartó y a qué tasa, que es la historia fiscal
 * del hogar— sino que deja de reclamarlo, porque el dinero ya salió de verdad.
 */
export async function releaseTaxReserve(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  const on = z.iso.date().safeParse(formData.get('releasedOn'));
  if (!id.success || !on.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(receivables)
      .set({ taxReleasedOn: on.data, updatedAt: new Date() })
      .where(
        and(
          eq(receivables.id, id.data),
          eq(receivables.householdId, householdId),
          isNull(receivables.taxReleasedOn),
          isNull(receivables.deletedAt),
        ),
      )
      .returning({ id: receivables.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}
