import { Money, monthKey, type CurrencyCode, type PlainDate } from '@app/domain';

import { median, relativeVariation } from './statistics.js';

/**
 * El piso: el sueldo que se paga a sí mismo quien no tiene sueldo.
 *
 * El error que arruina a un independiente no es no saber cuánto gana. Es
 * planificar contra el promedio de lo que gana. Con meses de $6,000, $1,000,
 * $4,000, $0, $8,000 y $2,000 el promedio da $3,500, y comprometerse a $3,500
 * garantiza la insolvencia el mes de $0 — que va a llegar, porque ya llegó.
 *
 * La salida no es un promedio mejor. Es dejar de usar un promedio: se toma un
 * **percentil bajo** de la propia historia del hogar y se planifica como si eso
 * fuera un sueldo fijo. Un mes normal sobra dinero y engorda el colchón; un mes
 * malo el colchón lo cubre. El ingreso variable se vuelve fijo en la capa de
 * planificación, y todos los motores que ya existen —períodos, safe-to-spend,
 * asignación— siguen funcionando sin enterarse.
 *
 * ## Por qué percentil y no mediana
 *
 * La mediana responde «cuánto suele entrar», que es la pregunta de un
 * asalariado. La pregunta de quien vende es otra: «con cuánto puedo contar casi
 * siempre». El p25 dice que tres de cada cuatro meses entra al menos eso. Es
 * deliberadamente pesimista, porque el costo de los dos errores no es simétrico:
 * un piso bajo deja dinero sin repartir, y un piso alto deja el alquiler sin
 * pagar.
 *
 * ## Por qué un mes en cero cuenta
 *
 * Porque pasó. Agrupar sólo los meses en que hubo cobros y sacarles un percentil
 * borra exactamente los meses que el piso existe para sobrevivir: un año con
 * tres meses secos tiene un piso mucho más bajo que uno sin ellos, y la
 * diferencia entre ambos es toda la información. `monthlyIncomeTotals` rellena
 * los huecos entre el primer y el último cobro observado.
 */

/** El percentil que define el piso. Tres de cada cuatro meses entra al menos esto. */
export const FLOOR_PERCENTILE = 0.25;

/**
 * Cuántos meses hacen falta antes de medir uno.
 *
 * Seis, no doce: pedir un año antes de decir nada deja a alguien que empezó en
 * marzo sin producto hasta el marzo siguiente. Con seis meses el percentil ya no
 * es un capricho de dos observaciones, y `monthsObserved` viaja en el resultado
 * para que la pantalla pueda decir sobre cuánta historia está hablando.
 */
export const MIN_MONTHS_FOR_FLOOR = 6;

/** Cuánta historia mira, como máximo. Lo de hace tres años no describe hoy. */
export const FLOOR_LOOKBACK_MONTHS = 12;

/** Un cobro que entró de verdad, con su día y su monto. Nunca una expectativa. */
export interface IncomeReceipt {
  readonly id: string;
  readonly receivedOn: PlainDate;
  readonly amount: Money;
}

/** Lo que entró en un mes de calendario. `total` puede ser cero, y eso es un dato. */
export interface IncomeMonth {
  /** `YYYY-MM`. */
  readonly month: string;
  readonly total: Money;
  readonly receiptCount: number;
}

/**
 * De dónde sale el piso.
 *
 * `measured` lo sacó el sistema de cobros reales. `declared` lo dijo la persona
 * porque todavía no hay historia. `unknown` es que no hay ni una cosa ni la
 * otra, y entonces no hay piso — que es distinto de un piso de cero, porque un
 * piso de cero es una afirmación y esto es una ausencia.
 */
export type FloorSource = 'measured' | 'declared' | 'unknown';

export interface IncomeFloor {
  readonly currency: CurrencyCode;
  readonly amount: Money;
  readonly source: FloorSource;
  /** El percentil usado, cuando fue medido. Nulo si lo declaró la persona. */
  readonly percentile: number | null;
  readonly monthsObserved: number;
  /** Los meses que se miraron, del más viejo al más nuevo. Vacío si no hay. */
  readonly months: readonly IncomeMonth[];
  readonly worstMonth: Money | null;
  readonly typicalMonth: Money | null;
  readonly bestMonth: Money | null;
  /** Cuánto se mueve el ingreso alrededor de su propia mediana. 0 = idéntico. */
  readonly variation: number;
  /**
   * Verdadero cuando el piso vino de la persona y hay historia suficiente para
   * contrastarlo. La pantalla lo usa para ofrecer el número medido, nunca para
   * sustituirlo por su cuenta: corregir a la baja el ingreso que alguien declaró
   * sin avisarle es cambiarle el plan sin decírselo.
   */
  readonly hasMeasurableHistory: boolean;
  /** El piso que se mediría con la historia que hay, exista o no uno declarado. */
  readonly measured: Money | null;
}

export interface IncomeFloorInput {
  readonly currency: CurrencyCode;
  /** Los cobros que entraron. Sólo dinero recibido, nunca esperado. */
  readonly receipts: readonly IncomeReceipt[];
  /** Hoy, en la zona del hogar. Cierra la ventana de meses que se mira. */
  readonly today: PlainDate;
  /** Lo que la persona dijo que cobra en su peor mes, mientras no haya historia. */
  readonly declared?: Money | null;
  readonly percentile?: number;
  readonly lookbackMonths?: number;
}

/**
 * Los totales por mes de calendario, con los meses secos incluidos.
 *
 * El relleno va del primer mes observado al último, no hasta hoy: un hogar que
 * dejó de facturar hace medio año tiene seis meses en cero que sí son suyos,
 * pero uno que empezó el mes pasado no tiene once meses de ceros a su nombre.
 * Inventarle esos ceros le pondría un piso de cero a alguien que sólo es nuevo.
 */
export function monthlyIncomeTotals(
  receipts: readonly IncomeReceipt[],
  currency: CurrencyCode,
): readonly IncomeMonth[] {
  if (receipts.length === 0) return [];

  const byMonth = new Map<string, Money[]>();
  for (const receipt of receipts) {
    const key = monthKey(receipt.receivedOn);
    const bucket = byMonth.get(key);
    if (bucket) bucket.push(receipt.amount);
    else byMonth.set(key, [receipt.amount]);
  }

  const keys = [...byMonth.keys()].sort();
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) return [];

  const months: IncomeMonth[] = [];
  for (let key = first; key <= last; key = nextMonthKey(key)) {
    const amounts = byMonth.get(key) ?? [];
    months.push({
      month: key,
      total: Money.sum(amounts, currency),
      receiptCount: amounts.length,
    });
  }
  return months;
}

/**
 * El valor por debajo del cual queda esa fracción de la muestra.
 *
 * Rango más cercano hacia arriba (`ceil`), sin interpolar: el resultado es
 * siempre un mes que de verdad ocurrió. Interpolar entre dos meses produciría
 * una cifra que nadie cobró nunca, y el piso se le presenta a alguien como «con
 * esto puedes contar» — conviene que sea verdad literal.
 */
export function percentileOf(values: readonly Money[], fraction: number): Money | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a.compare(b));
  const rank = Math.ceil(fraction * sorted.length);
  const at = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[at] ?? null;
}

export function computeIncomeFloor(input: IncomeFloorInput): IncomeFloor {
  const { currency } = input;
  const lookback = input.lookbackMonths ?? FLOOR_LOOKBACK_MONTHS;
  const percentile = input.percentile ?? FLOOR_PERCENTILE;

  const all = monthlyIncomeTotals(input.receipts, currency);
  // La ventana se cuenta desde el último mes con historia y no desde hoy, por lo
  // mismo que el relleno: si el hogar dejó de cargar cobros, lo último que tiene
  // sigue siendo lo que mejor lo describe.
  const months = all.slice(Math.max(all.length - lookback, 0));
  const totals = months.map((one) => one.total);

  const hasMeasurableHistory = months.length >= MIN_MONTHS_FOR_FLOOR;
  const measured = hasMeasurableHistory ? percentileOf(totals, percentile) : null;

  const declared = input.declared ?? null;
  const amount = measured ?? declared ?? Money.zero(currency);
  const source: FloorSource = measured ? 'measured' : declared ? 'declared' : 'unknown';

  const sorted = [...totals].sort((a, b) => a.compare(b));

  return {
    currency,
    amount,
    source,
    percentile: measured ? percentile : null,
    monthsObserved: months.length,
    months,
    worstMonth: sorted[0] ?? null,
    typicalMonth: median(totals),
    bestMonth: sorted[sorted.length - 1] ?? null,
    variation: relativeVariation(totals),
    hasMeasurableHistory,
    measured,
  };
}

/** `YYYY-MM` + 1 mes, sin pasar por `Date` — enero de un diciembre incluido. */
function nextMonthKey(key: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const rollsOver = month === 12;
  const nextYear = rollsOver ? year + 1 : year;
  const nextMonth = rollsOver ? 1 : month + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}
