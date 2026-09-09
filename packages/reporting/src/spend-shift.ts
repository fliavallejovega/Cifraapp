import { Money, type CurrencyCode } from '@app/domain';

import type { StatementLine, TransactionRow } from './types.js';

/**
 * En qué se gastó más y en qué menos que el período anterior.
 *
 * Un estado de gastos dice cuánto se fue en cada rubro y no dice lo único que
 * la casa quiere saber al mirarlo: si eso es mucho. «Restaurantes $340» no
 * significa nada suelto; «Restaurantes $340, ciento veinte más que el mes
 * pasado» es una conversación.
 *
 * Y es la cifra que se puede convertir en decisión. Los ciento veinte que
 * bajaron en un rubro son ciento veinte que existen: el producto puede decir
 * dónde aparecieron, y la casa decide si van a una meta, a una deuda o a nada.
 * Por eso el resultado separa lo que subió de lo que bajó en vez de dar una
 * lista firmada — las dos mitades responden preguntas distintas.
 *
 * ## Lo que no hace
 *
 * **No compara contra un mes que no existe.** Un hogar en su primer mes no
 * gastó «menos que antes»: no hay antes. Decirle que bajó en todo sería una
 * felicitación por no haber existido, y la ausencia de comparación se devuelve
 * como tal para que la pantalla diga que todavía no hay con qué comparar.
 *
 * **No llama tendencia a dos puntos.** Esto es la diferencia entre dos
 * períodos, y así se llama. Un rubro que subió una vez no está subiendo.
 */

export interface CategoryShift {
  /** El rubro, por su `template_slug`, o `uncategorized`. */
  readonly key: string;
  readonly label: string;
  /** Lo gastado en el período que se mira. */
  readonly current: Money;
  /** Lo gastado en el anterior. */
  readonly previous: Money;
  /** Actual menos anterior: positivo subió, negativo bajó. */
  readonly change: Money;
  /**
   * El cambio en porcentaje del anterior, o null cuando no había anterior.
   *
   * Null y no infinito: un rubro que aparece por primera vez no subió un
   * infinito por ciento, sencillamente antes no estaba, y un «+∞%» en una
   * pantalla de dinero es un error de programa disfrazado de dato.
   */
  readonly changeRate: number | null;
  /** Si el rubro no aparecía en el período anterior. */
  readonly isNew: boolean;
}

export interface SpendShift {
  /** Falso cuando no hay período anterior con qué comparar. */
  readonly comparable: boolean;
  /** Rubros donde se gastó más, el que más subió primero. */
  readonly spentMore: readonly CategoryShift[];
  /** Rubros donde se gastó menos, el que más bajó primero. */
  readonly spentLess: readonly CategoryShift[];
  /** La suma de lo que bajó: dinero que este período no se fue. */
  readonly freed: Money;
  /** La suma de lo que subió. */
  readonly added: Money;
  /** Actual menos anterior, en total. */
  readonly net: Money;
}

/**
 * Compara dos listas de movimientos ya acotadas a su período.
 *
 * Los importes se toman en valor absoluto porque un gasto es un gasto: en el
 * libro va en negativo y aquí se lee como «cuánto se fue», que es como se
 * piensa. Solo se miran salidas — una devolución no es gastar menos en el rubro,
 * es no haber gastado.
 */
export function spendShift(input: {
  readonly current: readonly TransactionRow[];
  readonly previous: readonly TransactionRow[];
  readonly currency: CurrencyCode;
  /**
   * Si hubo un período anterior. No se deduce de que venga vacío: un mes sin
   * movimientos es un dato, y confundirlo con «no había mes» le diría a una
   * casa que bajó en todo cuando lo que pasó es que no gastó nada.
   */
  readonly hadPrevious: boolean;
}): SpendShift {
  const zero = Money.zero(input.currency);

  const spentByCategory = (rows: readonly TransactionRow[]) => {
    const buckets = new Map<string, { label: string; amounts: Money[] }>();
    for (const row of rows) {
      // Las transferencias no son gasto: pagar la tarjeta mueve dinero entre
      // dos cuentas de la casa, y contarlo duplica cada compra que ya está en
      // la tarjeta. Es la misma exclusión que hace el resto del paquete.
      if (row.isTransfer) continue;
      if (!row.amount.isNegative()) continue;
      const key = row.categorySlug ?? 'uncategorized';
      const bucket = buckets.get(key) ?? { label: row.categoryLabel ?? key, amounts: [] };
      bucket.amounts.push(row.amount.abs());
      buckets.set(key, bucket);
    }
    return new Map(
      [...buckets.entries()].map(([key, bucket]) => [
        key,
        { label: bucket.label, total: Money.sum(bucket.amounts, input.currency) },
      ]),
    );
  };

  const now = spentByCategory(input.current);
  const before = spentByCategory(input.previous);

  if (!input.hadPrevious) {
    return { comparable: false, spentMore: [], spentLess: [], freed: zero, added: zero, net: zero };
  }

  const shifts: CategoryShift[] = [];
  for (const key of new Set([...now.keys(), ...before.keys()])) {
    const current = now.get(key)?.total ?? zero;
    const previous = before.get(key)?.total ?? zero;
    const change = current.subtract(previous);
    if (change.isZero()) continue;

    shifts.push({
      key,
      label: now.get(key)?.label ?? before.get(key)?.label ?? key,
      current,
      previous,
      change,
      // En unidades enteras, como el resto del sistema: dividir dos importes en
      // coma flotante para enseñar un porcentaje es la puerta de atrás por la
      // que vuelve la aritmética que este proyecto no usa con dinero.
      changeRate: previous.isZero()
        ? null
        : Number((change.scaledUnits * 10_000n) / previous.scaledUnits) / 100,
      isNew: previous.isZero(),
    });
  }

  // El que más se movió primero, en cada mitad: una lista de cambios se lee por
  // arriba, y lo que la casa necesita ver es el rubro que más se corrió.
  const up = shifts
    .filter((one) => one.change.isPositive())
    .sort((a, b) => b.change.compare(a.change) || a.key.localeCompare(b.key));
  const down = shifts
    .filter((one) => one.change.isNegative())
    .sort((a, b) => a.change.compare(b.change) || a.key.localeCompare(b.key));

  return {
    comparable: true,
    spentMore: up,
    spentLess: down,
    added: Money.sum(
      up.map((one) => one.change),
      input.currency,
    ),
    // En positivo: «liberaste $120» y no «−$120», porque es dinero que está.
    freed: Money.sum(
      down.map((one) => one.change.abs()),
      input.currency,
    ),
    net: Money.sum(
      shifts.map((one) => one.change),
      input.currency,
    ),
  };
}

/** Los rubros que más bajaron, como líneas de estado listas para enseñar. */
export function freedLines(shift: SpendShift): StatementLine[] {
  return shift.spentLess.map((one) => ({
    key: one.key,
    label: one.label,
    amount: one.change.abs(),
    count: 1,
  }));
}
