import 'server-only';

import {
  computeCushion,
  computeIncomeFloor,
  type CushionState,
  type IncomeFloor,
  type IncomeReceipt,
} from '@app/budget-engine';
import { accounts, householdSettings, households, receivables } from '@app/database/schema';
import { Money, todayIn, type CurrencyCode, type PlainDate } from '@app/domain';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * El piso y el colchón, sobre las filas del hogar.
 *
 * ## Qué cuenta como ingreso variable, y por qué sólo eso
 *
 * Los cobros marcados como recibidos, y nada más. La tentación es medir sobre
 * las entradas de las cuentas, que son más y llegan solas — y sería un error:
 * ahí dentro están el sueldo, las transferencias entre cuentas propias, la
 * devolución de una compra y el préstamo que hizo un hermano. Ninguna de esas
 * cosas es «lo que vendo», y adivinar cuál es cuál pondría una conjetura dentro
 * del número contra el que la casa compromete el alquiler.
 *
 * Un cobro, en cambio, es exactamente eso por definición: la casa lo declaró
 * como algo que iba a cobrar, y marcarlo recibido fue un acto deliberado. La
 * pantalla dice de dónde sale el piso para que nadie tenga que deducirlo.
 *
 * ## De dónde sale lo que hay guardado
 *
 * Del saldo de la cuenta de retención que el hogar señaló. Sin cuenta señalada
 * no hay colchón que medir, y eso se enseña como lo que es —falta un paso— en
 * vez de como un colchón de cero, que sería afirmar algo distinto.
 */

export interface IncomeFloorView {
  readonly currency: CurrencyCode;
  readonly today: PlainDate;
  readonly floor: IncomeFloor;
  readonly cushion: CushionState;
  /** El piso que la persona declaró, exista o no historia para medir uno. */
  readonly declared: Money | null;
  /** La cuenta de retención, cuando el hogar señaló una. */
  readonly retention: {
    readonly id: string;
    readonly name: string;
    readonly balance: Money;
  } | null;
  /** Cuántos cobros sostienen la medición. Cero significa que no hay historia. */
  readonly receiptCount: number;
  /** El objetivo en meses que la casa fijó a mano, si lo fijó. */
  readonly declaredMonths: number | null;
}

export async function loadIncomeFloor(
  session: Session,
  householdId: string,
): Promise<IncomeFloorView> {
  return queryAsUser(session, async (tx) => {
    const [household] = await tx
      .select({ currency: households.baseCurrency, timeZone: households.timeZone })
      .from(households)
      .where(eq(households.id, householdId))
      .limit(1);

    const currency = (household?.currency.trim() ?? 'USD') as CurrencyCode;
    const today = todayIn(household?.timeZone ?? 'America/Panama');

    const [settingsRows, receiptRows] = await Promise.all([
      tx
        .select({
          incomeFloor: householdSettings.incomeFloor,
          percentile: householdSettings.incomeFloorPercentile,
          cushionMonths: householdSettings.cushionMonths,
          retentionAccountId: householdSettings.retentionAccountId,
        })
        .from(householdSettings)
        .where(eq(householdSettings.householdId, householdId))
        .limit(1),
      tx
        .select({
          id: receivables.id,
          receivedOn: receivables.receivedOn,
          amount: receivables.amount,
        })
        .from(receivables)
        .where(
          and(
            eq(receivables.householdId, householdId),
            isNotNull(receivables.receivedOn),
            isNull(receivables.deletedAt),
          ),
        ),
    ]);

    const settings = settingsRows[0];

    const receipts: IncomeReceipt[] = receiptRows.map((row) => ({
      id: row.id,
      receivedOn: row.receivedOn as PlainDate,
      amount: Money.fromDecimalString(row.amount, currency),
    }));

    const declared = settings?.incomeFloor
      ? Money.fromDecimalString(settings.incomeFloor, currency)
      : null;

    const floor = computeIncomeFloor({
      currency,
      receipts,
      today,
      declared,
      ...(settings?.percentile ? { percentile: Number(settings.percentile) } : {}),
    });

    let retention: IncomeFloorView['retention'] = null;
    if (settings?.retentionAccountId) {
      const [account] = await tx
        .select({
          id: accounts.id,
          name: accounts.name,
          balance: accounts.currentBalance,
        })
        .from(accounts)
        .where(
          and(
            eq(accounts.id, settings.retentionAccountId),
            eq(accounts.householdId, householdId),
            isNull(accounts.deletedAt),
          ),
        )
        .limit(1);

      if (account) {
        retention = {
          id: account.id,
          name: account.name,
          balance: Money.fromDecimalString(account.balance, currency),
        };
      }
    }

    return {
      currency,
      today,
      floor,
      cushion: computeCushion({
        currency,
        floor: floor.amount,
        held: retention?.balance ?? Money.zero(currency),
        variation: floor.variation,
        monthsTarget: settings?.cushionMonths ?? null,
      }),
      declared,
      retention,
      receiptCount: receipts.length,
      declaredMonths: settings?.cushionMonths ?? null,
    };
  });
}
