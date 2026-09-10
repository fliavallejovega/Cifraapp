import 'server-only';

import { categories, debts } from '@app/database/schema';
import { Money, type CurrencyCode } from '@app/domain';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * Lo que el asistente de revisión ofrece para resolver una fila.
 *
 * Dos listas cortas y nada más: los rubros con que puede quedar, y las deudas
 * que puede bajar. Se cargan enteras porque son decenas, no miles, y un
 * selector que hay que buscar es un selector que se deja en blanco.
 */

export interface CategoryOptionView {
  readonly id: string;
  readonly name: string;
}

export interface DebtOptionView {
  readonly id: string;
  readonly name: string;
  readonly outstanding: Money;
}

/** Los rubros vivos del hogar. Los archivados no reciben movimientos nuevos. */
export async function loadCategoryOptions(
  session: Session,
  householdId: string,
): Promise<readonly CategoryOptionView[]> {
  return queryAsUser(session, (tx) =>
    tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.householdId, householdId), isNull(categories.archivedAt)))
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
  );
}

/**
 * Las deudas vivas, con lo que queda debiéndose.
 *
 * El saldo viaja con cada una porque es la mitad de la frase que hace útil el
 * selector: elegir «Préstamo de Giovanni» sin ver que quedan $1,800 no deja
 * juzgar si este pago de $500 tiene sentido ahí.
 */
export async function loadDebtOptions(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<readonly DebtOptionView[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({ id: debts.id, name: debts.name, balance: debts.currentBalance })
      .from(debts)
      .where(and(eq(debts.householdId, householdId), isNull(debts.deletedAt)))
      .orderBy(asc(debts.name)),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    outstanding: Money.fromDecimalString(row.balance, currency).abs(),
  }));
}
