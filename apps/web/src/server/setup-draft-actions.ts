'use server';

import { setupDrafts } from '@app/database/schema';
import { eq } from 'drizzle-orm';

import { loadSession, queryAsUser } from './session';

/**
 * El cuestionario a medio contestar, guardado con el hogar.
 *
 * Existe por una razón concreta: quien arranca la descripción de la casa suele
 * ser quien tiene tiempo esa tarde, y quien sabe el saldo de la cuenta o la
 * tasa de la tarjeta es la otra persona. Guardarlo en el navegador las obligaba
 * a terminar en el mismo dispositivo, que para un hogar de dos personas es casi
 * lo mismo que no guardarlo.
 *
 * Lo que se guarda aquí **no es un hogar descrito**. Son respuestas a medias,
 * con campos vacíos y filas a medio llenar, y por eso viajan como un objeto
 * opaco que solo el cuestionario vuelve a leer. Nada de esto llega a las tablas
 * financieras: eso pasa una sola vez, al enviar, y entero.
 *
 * Falla en silencio a propósito. Un borrador que no se pudo guardar es una
 * comodidad perdida, no un error que interrumpa a alguien a mitad de una
 * pantalla — y el formulario sigue teniendo en memoria todo lo que se escribió.
 */

export interface SetupDraftResult {
  readonly ok: boolean;
}

/** Cuántos pasos tiene el cuestionario. Un borrador fuera de rango no se guarda. */
const MAX_STEP = 20;

/** Un borrador enorme es un formulario que se rompió, no un hogar muy detallado. */
const MAX_BYTES = 256 * 1024;

export async function saveSetupDraft(answers: string, step: number): Promise<SetupDraftResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { ok: false };
  if (!Number.isInteger(step) || step < 0 || step > MAX_STEP) return { ok: false };
  if (answers.length > MAX_BYTES) return { ok: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(answers);
  } catch {
    return { ok: false };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false };

  const householdId = session.activeHouseholdId;

  try {
    await queryAsUser(session, async (tx) => {
      await tx
        .insert(setupDrafts)
        .values({
          householdId,
          answers: parsed,
          step,
          updatedBy: session.profile.id,
        })
        .onConflictDoUpdate({
          target: setupDrafts.householdId,
          set: { answers: parsed, step, updatedBy: session.profile.id, updatedAt: new Date() },
        });
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Y se borra en cuanto lo contestado deja de estar a medias.
 *
 * Un borrador que sobrevive al envío reaparece encima de lo que ya está
 * guardado la próxima vez que alguien abra la pantalla, que es la forma más
 * rápida de resucitar una cifra recién corregida.
 */
export async function discardSetupDraft(): Promise<SetupDraftResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { ok: false };
  const householdId = session.activeHouseholdId;

  try {
    await queryAsUser(session, async (tx) => {
      await tx.delete(setupDrafts).where(eq(setupDrafts.householdId, householdId));
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
