'use server';

import { accounts, programBalances } from '@app/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { RecordActionResult } from '@/components/records/spec';

import { plainDateString } from './record-input';
import { loadSession, queryAsUser } from './session';

/**
 * Anotar cuántas millas o puntos lleva una tarjeta.
 *
 * ## Por qué se pregunta en vez de calcularse
 *
 * Porque la tasa vive en prosa. «Una milla ConnectMiles por cada US$3.00 de
 * compra, y por cada US$3.00 en impuestos y multas a favor del Gobierno de
 * Panamá» es una frase, no un número: sacar un factor de ahí e ir acumulando
 * produciría un saldo que el programa no reconoce, y una casa decidiendo un
 * viaje contra una cifra que este sistema se inventó.
 *
 * Lo que el producto sí hace es no dejar que el número envejezca en silencio:
 * dice de cuándo es, y cuánto se consumió con esa tarjeta desde entonces.
 *
 * ## Por qué cada lectura se guarda
 *
 * Un saldo con fecha es un hecho fechado. Si el programa devalúa, si vencen
 * millas o si alguien canjea, el histórico es lo único que explica por qué el
 * número dejó de cuadrar. Guardar sólo el último borra esa explicación.
 */

const input = z.object({
  accountId: z.uuid(),
  /** Entero: no hay medias millas, y los separadores de miles se escriben. */
  balance: z.preprocess(
    (value) => (typeof value === 'string' ? value.replace(/[\s,._']/g, '') : value),
    z.coerce.number().int().min(0).max(100_000_000),
  ),
  asOf: plainDateString,
  programKey: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.string().trim().max(60).optional(),
  ),
});

const FIELD_ERRORS = {
  accountId: 'accountRequired',
  balance: 'amountInvalid',
  asOf: 'dateInvalid',
} as const;

export async function recordProgramBalance(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = input.safeParse({
    accountId: formData.get('accountId'),
    balance: formData.get('balance'),
    asOf: formData.get('asOf'),
    programKey: formData.get('programKey'),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0]?.path[0];
    return {
      error:
        typeof first === 'string' && first in FIELD_ERRORS
          ? FIELD_ERRORS[first as keyof typeof FIELD_ERRORS]
          : 'generic',
    };
  }

  const householdId = session.activeHouseholdId;

  const done = await queryAsUser(session, async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, parsed.data.accountId),
          eq(accounts.householdId, householdId),
          isNull(accounts.deletedAt),
        ),
      )
      .limit(1);

    if (!account) return false;

    await tx.insert(programBalances).values({
      householdId,
      accountId: parsed.data.accountId,
      balance: parsed.data.balance,
      asOf: parsed.data.asOf,
      recordedBy: session.user.id,
      ...(parsed.data.programKey === undefined ? {} : { programKey: parsed.data.programKey }),
    });

    return true;
  });

  if (!done) return { error: 'accountRequired' };

  revalidatePath('/[locale]/cards', 'page');
  return { ok: true };
}
