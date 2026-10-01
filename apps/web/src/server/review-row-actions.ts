'use server';

import type { Database } from '@app/database';
import { categories, debts, importRows } from '@app/database/schema';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { RecordActionResult } from '@/components/records/spec';

import { loadSession, queryAsUser } from './session';

/**
 * Lo que se puede decidir sobre una fila **antes** de confirmarla.
 *
 * ## Por qué esto no existía
 *
 * La pantalla de revisión era una lista de casillas: aprobar o descartar. Todo
 * lo demás —qué rubro, qué comercio, si ese pago baja una deuda— pasaba después,
 * automáticamente, y sólo para las filas que el motor determinista supo
 * resolver. Una fila que no entendía se quedaba con categoría nula y **no
 * entraba a ninguna cola**: nadie la veía nunca.
 *
 * El resultado era un producto que le pedía a la casa que aprobara una lista de
 * descripciones crudas sin decirle qué iba a hacer con ellas. Eso no es
 * aprobar; es firmar.
 *
 * ## Por qué se guarda en la fila y no se aplica ya
 *
 * Porque la fila todavía no es un movimiento. Elegir el rubro aquí es declarar
 * una intención sobre algo que aún se puede descartar entero, y aplicarla antes
 * de confirmar dejaría categorías colgando de movimientos que nunca existieron.
 * Se guarda en `import_rows` y se aplica en el mismo acto que crea el
 * movimiento.
 */

const CATEGORY_KINDS = ['income', 'expense', 'transfer', 'investment'] as const;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Que la fila pertenezca a este hogar. Sin esto, un id ajeno edita algo ajeno. */
async function ownsRow(
  tx: Tx,
  householdId: string,
  rowId: string,
): Promise<{ importId: string } | null> {
  const rows = await tx
    .select({
      importId: importRows.importId,
      createdTransactionId: importRows.createdTransactionId,
    })
    .from(importRows)
    .where(and(eq(importRows.id, rowId), eq(importRows.householdId, householdId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  // Una fila ya archivada no se re-decide desde aquí: cambiarle el rubro
  // después de que es un movimiento se hace en Movimientos, donde queda
  // registrado como una corrección y no como una preferencia de importación.
  if (row.createdTransactionId !== null) return null;

  return { importId: row.importId };
}

/** El rubro que la persona eligió para esta fila. Gana sobre el propuesto. */
export async function setRowCategory(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const rowId = z.uuid().safeParse(formData.get('rowId'));
  if (!rowId.success) return { error: 'notFound' };

  const raw = formData.get('categoryId');
  const categoryId =
    typeof raw === 'string' && raw !== '' ? z.uuid().safeParse(raw) : { success: true as const, data: null };
  if (!categoryId.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const done = await queryAsUser(session, async (tx) => {
    const owned = await ownsRow(tx, householdId, rowId.data);
    if (!owned) return null;

    if (categoryId.data !== null) {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, categoryId.data), eq(categories.householdId, householdId)))
        .limit(1);
      if (!category) return null;
    }

    await tx
      .update(importRows)
      .set({ chosenCategoryId: categoryId.data })
      .where(eq(importRows.id, rowId.data));

    return owned.importId;
  });

  if (!done) return { error: 'notFound' };

  revalidatePath(`/[locale]/documents/${done}`, 'page');
  return { ok: true };
}

/**
 * Crear un rubro sin salir de la revisión, y aplicarlo a la fila.
 *
 * Mandar a alguien a otra pantalla a crear una categoría, y de vuelta a buscar
 * la fila donde estaba, es cómo se abandona una revisión a la mitad. El rubro
 * nuevo es del hogar desde que se crea; no es un rubro «de importación».
 */
export async function createCategoryForRow(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const rowId = z.uuid().safeParse(formData.get('rowId'));
  if (!rowId.success) return { error: 'notFound' };

  const name = z.string().trim().min(1).max(80).safeParse(formData.get('name'));
  if (!name.success) return { error: 'nameRequired' };

  const kind = z.enum(CATEGORY_KINDS).safeParse(formData.get('kind') ?? 'expense');
  if (!kind.success) return { error: 'kindInvalid' };

  const householdId = session.activeHouseholdId;

  const done = await queryAsUser(session, async (tx) => {
    const owned = await ownsRow(tx, householdId, rowId.data);
    if (!owned) return null;

    const [created] = await tx
      .insert(categories)
      .values({
        householdId,
        name: name.data,
        kind: kind.data,
        isSystem: false,
      })
      .returning({ id: categories.id });

    if (!created) return null;

    await tx
      .update(importRows)
      .set({ chosenCategoryId: created.id })
      .where(eq(importRows.id, rowId.data));

    return owned.importId;
  });

  if (!done) return { error: 'generic' };

  revalidatePath(`/[locale]/documents/${done}`, 'page');
  return { ok: true, created: done };
}

/**
 * Marcar que esta fila es un pago a una deuda.
 *
 * No descuenta nada todavía. Al confirmar, el mismo acto que crea el movimiento
 * aplica el pago y baja el saldo, dentro de una sola transacción de base: un
 * pago registrado cuya deuda no bajó, y una deuda que bajó sin pago que la
 * explique, son las dos formas de que los números dejen de cuadrar.
 */
export async function setRowDebt(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const rowId = z.uuid().safeParse(formData.get('rowId'));
  if (!rowId.success) return { error: 'notFound' };

  const raw = formData.get('debtId');
  const debtId =
    typeof raw === 'string' && raw !== '' ? z.uuid().safeParse(raw) : { success: true as const, data: null };
  if (!debtId.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const done = await queryAsUser(session, async (tx) => {
    const owned = await ownsRow(tx, householdId, rowId.data);
    if (!owned) return null;

    if (debtId.data !== null) {
      const [debt] = await tx
        .select({ id: debts.id })
        .from(debts)
        .where(and(eq(debts.id, debtId.data), eq(debts.householdId, householdId)))
        .limit(1);
      if (!debt) return null;
    }

    await tx
      .update(importRows)
      .set({ applyToDebtId: debtId.data })
      .where(eq(importRows.id, rowId.data));

    return owned.importId;
  });

  if (!done) return { error: 'notFound' };

  revalidatePath(`/[locale]/documents/${done}`, 'page');
  return { ok: true };
}
