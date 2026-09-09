import 'server-only';

import { accounts, debts, householdPeople, transactions } from '@app/database/schema';
import { unitRatio } from '@app/budget-engine';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * Las tarjetas de la casa, con su cupo y su rastro.
 *
 * ## Por qué merecen pantalla propia
 *
 * Una tarjeta es dos cosas a la vez y el producto ya las guardaba por separado:
 * una **deuda** —lo que se debe, la tasa, el mínimo, lo que el motor ataca— y
 * una **cuenta** —el cupo, los movimientos, contra qué se importa el estado de
 * cuenta—. Cuentas enseñaba la mitad y Deudas la otra, y ninguna de las dos
 * respondía la pregunta que se hace de verdad al mirar una tarjeta: cuánto
 * debo, cuánto me queda, cuándo se paga y en qué la estoy usando.
 *
 * ## Los dos saldos no se ponen de acuerdo, a propósito
 *
 * La cuenta guarda lo que dice el banco hoy; la deuda guarda lo que la casa
 * está gestionando. Suelen ser la misma cifra, y **el día que difieren esa
 * diferencia es el hallazgo**, no un error que tapar. La pantalla los enseña
 * juntos cuando no coinciden en vez de elegir uno.
 *
 * ## La utilización
 *
 * Cuánto del cupo está usado. Es la cifra que mueve un puntaje de crédito y la
 * que nadie mira hasta que ya está alta, y sale de dos números que la casa ya
 * declaró — no hay modelo ni estimación detrás.
 */

export interface CardView {
  readonly accountId: string;
  readonly debtId: string | null;
  readonly name: string;
  readonly maskedNumber: string | null;
  readonly holder: string | null;
  /** Lo que dice el banco hoy, en positivo: lo que se debe. */
  readonly owed: Money;
  /** Lo que la casa está gestionando como deuda. Nulo si no hay deuda ligada. */
  readonly managed: Money | null;
  /** Verdadero cuando los dos saldos no coinciden. Es un hallazgo, no un error. */
  readonly balancesDiffer: boolean;
  readonly creditLimit: Money | null;
  /** Cupo menos lo debido. Nulo sin límite declarado: no es cero, es que no se sabe. */
  readonly available: Money | null;
  /** 0–1. Nulo sin límite. Es la cifra que mueve un puntaje y nadie mira a tiempo. */
  readonly utilization: number | null;
  readonly apr: string | null;
  readonly minimumPayment: Money | null;
  /** El día del mes en que vence. Nulo cuando nadie lo declaró. */
  readonly dueDay: number | null;
  readonly statementDay: number | null;
  /** El rastro: cuántos movimientos lleva y cuándo fue el último. */
  readonly movementCount: number;
  readonly lastMovementOn: PlainDate | null;
  readonly lastMovementDescription: string | null;
  readonly isArchived: boolean;
}

export interface CardsView {
  readonly currency: CurrencyCode;
  readonly cards: readonly CardView[];
  readonly totalOwed: Money;
  readonly totalLimit: Money | null;
  readonly totalAvailable: Money | null;
  /** La utilización del conjunto. Nula si ninguna tarjeta declaró cupo. */
  readonly utilization: number | null;
  readonly isEmpty: boolean;
}

export async function loadCards(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<CardsView> {
  return queryAsUser(session, async (tx) => {
    const rows = await tx
      .select({
        accountId: accounts.id,
        name: accounts.name,
        maskedNumber: accounts.maskedNumber,
        status: accounts.status,
        balance: accounts.currentBalance,
        accountLimit: accounts.creditLimit,
        holder: householdPeople.displayName,
        debtId: debts.id,
        debtBalance: debts.currentBalance,
        debtLimit: debts.creditLimit,
        apr: debts.apr,
        minimumPayment: debts.minimumPayment,
        dueDay: debts.dueDay,
        statementDay: debts.statementDay,
        // El rastro, contado en la misma consulta: un hogar con seis tarjetas no
        // debería costar seis viajes más.
        movementCount: sql<number>`(
          select count(*)::int from app.transactions t
          where t.account_id = ${accounts.id} and t.deleted_at is null
        )`,
      })
      .from(accounts)
      .leftJoin(householdPeople, eq(householdPeople.id, accounts.personId))
      // La deuda que esta cuenta respalda. `left`, porque una tarjeta puede
      // existir como cuenta sin que nadie la haya registrado como deuda —y esa
      // ausencia es justo lo que la pantalla tiene que poder señalar.
      .leftJoin(debts, and(eq(debts.accountId, accounts.id), isNull(debts.deletedAt)))
      .where(
        and(
          eq(accounts.householdId, householdId),
          eq(accounts.accountType, 'credit_card'),
          isNull(accounts.deletedAt),
        ),
      )
      .orderBy(desc(accounts.status), accounts.createdAt);

    if (rows.length === 0) {
      return {
        currency,
        cards: [],
        totalOwed: Money.zero(currency),
        totalLimit: null,
        totalAvailable: null,
        utilization: null,
        isEmpty: true,
      };
    }

    const lastMovements = await tx
      .select({
        accountId: transactions.accountId,
        date: transactions.transactionDate,
        description: transactions.descriptionOriginal,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          isNull(transactions.deletedAt),
          // `inArray` y no una plantilla `sql`: un arreglo interpolado en un
          // `in` se enlaza como un solo parámetro y Postgres lo rechaza en
          // ejecución. El compilador no ve la diferencia; la petición sí.
          inArray(
            transactions.accountId,
            rows.map((row) => row.accountId),
          ),
        ),
      )
      .orderBy(desc(transactions.transactionDate), desc(transactions.createdAt));

    const latest = new Map<string, { date: PlainDate; description: string }>();
    for (const movement of lastMovements) {
      if (latest.has(movement.accountId)) continue;
      latest.set(movement.accountId, {
        date: movement.date as PlainDate,
        description: movement.description,
      });
    }

    const cards: CardView[] = rows.map((row) => {
      // El saldo de una tarjeta se guarda negativo —es lo que se debe— y se
      // enseña en positivo. Un signo menos delante de una deuda invita a leerla
      // como un descuento.
      const owed = Money.fromDecimalString(row.balance, currency).abs();
      const managed = row.debtBalance
        ? Money.fromDecimalString(row.debtBalance, currency).abs()
        : null;

      // El de la deuda manda cuando existe: es el que la casa mantiene al día.
      const limitSource = row.debtLimit ?? row.accountLimit;
      const creditLimit = limitSource ? Money.fromDecimalString(limitSource, currency) : null;

      const available = creditLimit?.isPositive() ? creditLimit.subtract(owed) : null;

      const last = latest.get(row.accountId) ?? null;

      return {
        accountId: row.accountId,
        debtId: row.debtId,
        name: row.name,
        maskedNumber: row.maskedNumber,
        holder: row.holder,
        owed,
        managed,
        balancesDiffer: managed !== null && !managed.equals(owed),
        creditLimit,
        available,
        utilization: creditLimit?.isPositive()
          ? unitRatio(owed.scaledUnits, creditLimit.scaledUnits)
          : null,
        apr: row.apr,
        minimumPayment: row.minimumPayment
          ? Money.fromDecimalString(row.minimumPayment, currency)
          : null,
        dueDay: row.dueDay,
        statementDay: row.statementDay,
        movementCount: row.movementCount,
        lastMovementOn: last?.date ?? null,
        lastMovementDescription: last?.description ?? null,
        isArchived: row.status !== 'active',
      };
    });

    const live = cards.filter((card) => !card.isArchived);
    const withLimit = live.filter((card) => card.creditLimit !== null);

    const totalOwed = Money.sum(
      live.map((card) => card.owed),
      currency,
    );
    const totalLimit =
      withLimit.length === 0
        ? null
        : Money.sum(
            withLimit.map((card) => card.creditLimit).filter((one): one is Money => one !== null),
            currency,
          );

    return {
      currency,
      cards,
      totalOwed,
      totalLimit,
      // Sólo sobre las que declararon cupo: restar de un total incompleto daría
      // un disponible más bajo que el real y nadie sabría por qué.
      totalAvailable: totalLimit
        ? totalLimit.subtract(
            Money.sum(
              withLimit.map((card) => card.owed),
              currency,
            ),
          )
        : null,
      utilization: totalLimit?.isPositive()
        ? unitRatio(
            Money.sum(
              withLimit.map((card) => card.owed),
              currency,
            ).scaledUnits,
            totalLimit.scaledUnits,
          )
        : null,
      isEmpty: false,
    };
  });
}
