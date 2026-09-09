import { Money, type CurrencyCode } from '@app/domain';

/**
 * El colchón: la cuenta que convierte un ingreso irregular en un sueldo.
 *
 * El piso (`income-floor.ts`) dice contra cuánto se puede comprometer. El
 * colchón es la mecánica que lo hace cierto mes a mes:
 *
 *   1. Lo cobrado entra a una **cuenta de retención**, no a la operativa.
 *   2. Cada mes, la retención pasa exactamente **el piso** a la operativa.
 *   3. Un mes gordo deja el resto dentro y engorda el colchón.
 *   4. Un mes flaco lo consume, y la casa ni se entera — que es el punto.
 *
 * Sin el paso 1 nada de esto funciona: si lo cobrado cae en la cuenta de la que
 * se gasta, el mes de $8,000 se gasta como un mes de $8,000 y el de $0 no tiene
 * de dónde salir. La retención no es una sutileza contable, es el único
 * mecanismo que hace que un ingreso variable se sienta fijo.
 *
 * ## El objetivo sale de la volatilidad propia, no de una constante
 *
 * «Tres meses de gastos» es el consejo genérico y es el número equivocado para
 * las dos puntas: a quien factura casi lo mismo todos los meses le sobra, y a
 * quien alterna $8,000 con $0 no le alcanza. El objetivo se saca de cuánto se
 * mueve el ingreso de *este* hogar alrededor de su propia mediana — la misma
 * `relativeVariation` que ya usa el motor de recurrencia —, así que un hogar
 * estable llega antes a su meta y uno volátil sabe que la suya es más alta
 * porque su propia historia lo dice.
 */

/** El suelo del objetivo: ni el ingreso más estable se planifica sin margen. */
export const MIN_CUSHION_MONTHS = 3;

/** El techo. Más allá de seis meses el dinero rinde más atacando la deuda. */
export const MAX_CUSHION_MONTHS = 6;

/**
 * Por debajo de esta variación, un ingreso es un sueldo.
 *
 * 0.15 es «el mes típico se aleja un 15% de la mediana»: cobrar entre $2,550 y
 * $3,450 sobre una mediana de $3,000. Eso no es vivir de vender, es un sueldo
 * con horas extra, y pedirle a esa casa que guarde más de tres meses es
 * quitarle a la deuda un dinero que ahí rinde más.
 */
export const STABLE_VARIATION = 0.15;

/**
 * La variación a partir de la cual el objetivo llega al techo.
 *
 * 0.5 es «el mes típico se aleja la mitad de la mediana»: alternar $2,000 con
 * $6,000. Quien vive así no está ahorrando por prudencia, está financiando los
 * meses secos con los húmedos, y seis meses es lo que hace falta para que un
 * trimestre malo no se lleve la casa.
 */
export const HIGH_VARIATION = 0.5;

export interface CushionState {
  readonly currency: CurrencyCode;
  /** El sueldo que la retención pasa a la operativa cada mes. */
  readonly floor: Money;
  readonly monthsTarget: number;
  readonly target: Money;
  readonly held: Money;
  /** target − held, nunca negativo. Cero significa colchón completo. */
  readonly missing: Money;
  /** Cuántos meses de piso hay guardados ahora mismo, a un decimal. */
  readonly monthsHeld: number;
  readonly isFunded: boolean;
  /**
   * Lo que la retención puede pasar a la operativa este mes: el piso, o todo lo
   * que quede si ya no llega. Nunca se inventa lo que no hay.
   */
  readonly release: Money;
  /**
   * Lo que le falta a la retención para poder pagar el piso completo. Positivo
   * es la frase que hay que decir en voz alta: el colchón se acabó y el sueldo
   * de este mes va a ser más chico que el piso.
   */
  readonly shortOfFloor: Money;
}

export interface CushionInput {
  readonly currency: CurrencyCode;
  readonly floor: Money;
  /** Lo que hay hoy en la cuenta de retención. */
  readonly held: Money;
  /** La variación del ingreso, de `computeIncomeFloor`. */
  readonly variation: number;
  /** Un objetivo que la casa fijó a mano, en meses. Manda sobre el calculado. */
  readonly monthsTarget?: number | null;
}

/**
 * Cuántos meses de piso guardar, según cuánto se mueve el ingreso.
 *
 * Plano hasta `STABLE_VARIATION`, lineal de ahí al techo, y redondeado al mes
 * entero: medio mes de colchón no es una decisión que nadie tome, y «3,4 meses»
 * pide una precisión que la medición no tiene.
 */
export function cushionMonths(variation: number): number {
  if (!Number.isFinite(variation) || variation <= STABLE_VARIATION) return MIN_CUSHION_MONTHS;
  if (variation >= HIGH_VARIATION) return MAX_CUSHION_MONTHS;

  const span = MAX_CUSHION_MONTHS - MIN_CUSHION_MONTHS;
  const reach = (variation - STABLE_VARIATION) / (HIGH_VARIATION - STABLE_VARIATION);
  return Math.round(MIN_CUSHION_MONTHS + reach * span);
}

export function computeCushion(input: CushionInput): CushionState {
  const { currency } = input;
  const zero = Money.zero(currency);

  // Un piso negativo no es un piso. Se trata como ausencia y no como deuda.
  const floor = input.floor.isPositive() ? input.floor : zero;
  const held = input.held.isPositive() ? input.held : zero;

  const monthsTarget =
    input.monthsTarget && input.monthsTarget > 0
      ? Math.round(input.monthsTarget)
      : cushionMonths(input.variation);

  const target = floor.multiply(monthsTarget);
  const missing = target.greaterThan(held) ? target.subtract(held) : zero;

  const release = Money.min(floor, held);
  const shortOfFloor = floor.subtract(release);

  return {
    currency,
    floor,
    monthsTarget,
    target,
    held,
    missing,
    monthsHeld: monthsOf(held, floor),
    isFunded: missing.isZero() && target.isPositive(),
    release,
    shortOfFloor,
  };
}

/**
 * Cuánto de un excedente va al colchón antes que a cualquier otra cosa.
 *
 * Mientras el colchón no esté completo se lleva todo lo que le falte, y sólo lo
 * que sobre de ahí llega a las metas. No es una preferencia de producto: una
 * meta de viaje financiada con el colchón vacío se paga cancelando el viaje el
 * primer mes seco, y haber pasado por la ilusión de tenerlo no ayudó a nadie.
 *
 * El plan lo consume como un reclamo `emergency_fund`, que la escalera ya coloca
 * por delante de `goal` y por detrás de los esenciales y los mínimos de deuda.
 */
export function cushionClaim(state: CushionState, surplus: Money): Money {
  if (state.missing.isZero()) return Money.zero(state.currency);
  if (!surplus.isPositive()) return Money.zero(state.currency);
  return Money.min(state.missing, surplus);
}

/** Meses de piso guardados, a un decimal. Nulo sin piso: no hay unidad. */
function monthsOf(held: Money, floor: Money): number {
  if (!floor.isPositive()) return 0;
  const tenths = (held.scaledUnits * 10n) / floor.scaledUnits;
  return Number(tenths) / 10;
}
