import 'server-only';

import type { Database } from '@app/database';
import { debtPayments, debts } from '@app/database/schema';
import type { Money, CurrencyCode, PlainDate } from '@app/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';

/**
 * Aplicar un pago a una deuda, y deshacerlo.
 *
 * ## Por qué esto no es una resta
 *
 * Restar y ya es irreversible y no se puede explicar. Un saldo que bajó de 1800
 * a 1300 sin rastro obliga a creerle; con el rastro se puede preguntar cuál de
 * los pagos fue, quién lo aplicó, desde qué movimiento salió, y deshacerlo si
 * alguien se equivocó de deuda.
 *
 * ## Por qué el saldo se guarda igual
 *
 * Se podría calcular sumando los pagos contra el principal cada vez que alguien
 * abre la pantalla. No se hace: el saldo es lo que el motor de deudas lee para
 * ordenar la estrategia, lo que el plan lee para saber cuánto comprometer, y lo
 * que la casa compara contra el papel del banco. Una cifra que se recalcula en
 * cada lectura se vuelve distinta de la del banco por un pago que alguien anotó
 * con otra fecha, y nadie sabe cuál de las dos creer.
 *
 * El saldo manda; la tabla de pagos explica.
 *
 * ## Por qué todo pasa dentro de una transacción de base
 *
 * Un pago registrado cuya deuda no bajó, y una deuda que bajó sin un pago que
 * lo explique, son las dos formas de que los números dejen de cuadrar. Ninguna
 * de las dos puede existir ni por un instante.
 */

/**
 * La transacción de base, tal como la entrega `queryAsUser`.
 *
 * Se toma como parámetro y no se abre aquí adentro a propósito: el pago y el
 * movimiento que lo explica tienen que confirmarse o fallar juntos, y eso sólo
 * pasa si comparten la transacción de quien los llama.
 */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface ApplyPaymentInput {
  readonly householdId: string;
  readonly debtId: string;
  readonly transactionId: string | null;
  readonly amount: Money;
  readonly currency: CurrencyCode;
  readonly paidOn: PlainDate | string;
  readonly appliedBy: string | null;
  readonly note?: string;
}

/**
 * Descuenta un pago del saldo de una deuda, dejando la fila que lo explica.
 *
 * Devuelve `null` cuando no se aplicó nada — porque ese movimiento ya se había
 * aplicado a esa deuda. El índice único lo garantiza en la base, y no en el
 * código: dos personas mirando la misma pantalla descuentan el mismo pago dos
 * veces, y la deuda queda en la mitad de lo que es.
 */
export async function applyPaymentToDebt(
  tx: Tx,
  input: ApplyPaymentInput,
): Promise<string | null> {
  if (!input.amount.isPositive()) return null;

  const inserted = await tx
    .insert(debtPayments)
    .values({
      householdId: input.householdId,
      debtId: input.debtId,
      transactionId: input.transactionId,
      amount: input.amount.toDecimalString(),
      currency: input.currency,
      paidOn: input.paidOn,
      appliedBy: input.appliedBy,
      ...(input.note === undefined ? {} : { note: input.note }),
    })
    .onConflictDoNothing()
    .returning({ id: debtPayments.id });

  const payment = inserted[0];
  if (!payment) return null;

  /*
    El saldo baja, y no por debajo de cero.

    Un pago mayor que lo que queda no es un error del que haya que salvar a
    nadie —pasa cuando alguien paga de más o cuando el saldo estaba mal— pero un
    saldo negativo se leería como «la deuda te debe a vos», que es otra cosa.
    Queda en cero, y la fila del pago conserva el monto completo, así que la
    diferencia se puede ver.

    La resta la hace Postgres sobre la columna `numeric`, no JavaScript: un
    saldo que pasa por un `number` pierde centavos y este producto no toca
    plata con aritmética de punto flotante.
  */
  await tx
    .update(debts)
    .set({
      currentBalance: sql`greatest(${debts.currentBalance} - ${input.amount.toDecimalString()}::numeric, 0)`,
      updatedAt: new Date(),
    })
    .where(and(eq(debts.id, input.debtId), eq(debts.householdId, input.householdId)));

  return payment.id;
}

/**
 * Deshacer un pago.
 *
 * Marca en vez de borrar: una fila borrada no explica por qué el saldo volvió a
 * subir, y «el saldo cambió y no sé por qué» es exactamente lo que este rastro
 * existe para que nunca pase.
 */
export async function reversePayment(
  tx: Tx,
  input: {
    readonly householdId: string;
    readonly paymentId: string;
    readonly reversedBy: string | null;
    readonly reason: string;
  },
): Promise<boolean> {
  const rows = await tx
    .select({ debtId: debtPayments.debtId, amount: debtPayments.amount })
    .from(debtPayments)
    .where(
      and(
        eq(debtPayments.id, input.paymentId),
        eq(debtPayments.householdId, input.householdId),
        // Deshacer dos veces subiría el saldo dos veces.
        isNull(debtPayments.reversedAt),
      ),
    )
    .limit(1);

  const payment = rows[0];
  if (!payment) return false;

  await tx
    .update(debtPayments)
    .set({
      reversedAt: new Date(),
      reversedBy: input.reversedBy,
      reversalReason: input.reason,
    })
    .where(eq(debtPayments.id, input.paymentId));

  await tx
    .update(debts)
    .set({
      currentBalance: sql`${debts.currentBalance} + ${payment.amount}::numeric`,
      updatedAt: new Date(),
    })
    .where(and(eq(debts.id, payment.debtId), eq(debts.householdId, input.householdId)));

  return true;
}
