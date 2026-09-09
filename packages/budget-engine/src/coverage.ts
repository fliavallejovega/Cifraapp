import { addDays, Money, type CurrencyCode, type PlainDate } from '@app/domain';

/**
 * Compromiso por compromiso: cubierto, condicional o descubierto.
 *
 * Las dos respuestas que un producto financiero suele dar a «¿me alcanza?» son
 * malas de maneras distintas. «Tenés $3,400» es mentira, porque $1,900 de eso
 * son una factura que el cliente todavía no pagó. «No se puede saber» es
 * inútil, porque sí se puede: lo que no se sabe es el día exacto, no el rango.
 *
 * Lo que se puede decir —y es lo que esta pasada produce— es esto:
 *
 *   «Tus compromisos de los próximos 30 días suman $1,836. Con lo que tenés
 *   cubrís hasta el 14. Para llegar al 30 tienen que entrar $1,240 antes del
 *   26. Esperás $3,400 en ese rango, de los cuales $1,900 son confirmados.»
 *
 * Eso es un plan de acción: dice a quién hay que llamar y para cuándo. La cifra
 * optimista no dice nada y encima invita a gastar.
 *
 * ## Cómo se decide cada veredicto
 *
 * Los compromisos se recorren **por fecha de vencimiento** y se pagan primero
 * con el efectivo que la casa tiene hoy. Lo que el efectivo no alcanza a cubrir
 * se busca en los cobros esperados, y ahí entra la regla que hace todo el
 * trabajo: **un cobro sólo sirve si su ventana cierra antes del vencimiento**.
 * Una factura que llega «entre el 20 y el 30» no paga un alquiler del 25: puede
 * que sí y puede que no, y un plan que asume que sí es el que deja a la casa
 * explicándole al dueño por qué el 25 no había plata.
 *
 * `covered` es efectivo que ya está. `conditional` es «alcanza si entra esto».
 * `uncovered` es que no alcanza ni contando todo lo que se espera, que es la
 * situación que hay que ver con semanas de antelación y no el día 29.
 */

export const COVERAGE_HORIZON_DAYS = 30;

export type CoverageVerdict = 'covered' | 'conditional' | 'uncovered';

/** Los tres grados de certeza de un cobro, del más firme al más flojo. */
export type ReceiptConfidence = 'confirmed' | 'likely' | 'estimated';

const CONFIDENCE_RANK: Record<ReceiptConfidence, number> = {
  confirmed: 0,
  likely: 1,
  estimated: 2,
};

export interface CoverageCommitment {
  readonly id: string;
  readonly label: string;
  readonly due: PlainDate;
  readonly amount: Money;
  readonly isEssential: boolean;
}

export interface ExpectedReceipt {
  readonly id: string;
  readonly label: string;
  readonly amount: Money;
  /** El primer día en que puede entrar. Nulo cuando la casa no lo sabe. */
  readonly from: PlainDate | null;
  /** El último. Es el que decide: antes de esto no se puede contar con él. */
  readonly to: PlainDate | null;
  readonly confidence: ReceiptConfidence;
}

/** Un cobro del que depende un compromiso, y para cuándo hace falta. */
export interface CoverageDependency {
  readonly receiptId: string;
  readonly label: string;
  readonly amount: Money;
  readonly by: PlainDate;
  readonly confidence: ReceiptConfidence;
}

export interface CommitmentCoverage {
  readonly id: string;
  readonly label: string;
  readonly due: PlainDate;
  readonly amount: Money;
  readonly isEssential: boolean;
  readonly verdict: CoverageVerdict;
  /** Lo que el efectivo de hoy cubre de este compromiso. */
  readonly fromCash: Money;
  /** Lo que cubriría si entran los cobros de los que depende. */
  readonly fromExpected: Money;
  /** Lo que no cubre nada. Positivo sólo en `uncovered`. */
  readonly shortfall: Money;
  readonly dependsOn: readonly CoverageDependency[];
  /**
   * El grado más flojo del que depende, o nulo si no depende de nada. Es la
   * diferencia entre «alcanza si el cliente paga la factura que ya aceptó» y
   * «alcanza si sale algo de lo que hablamos por teléfono».
   */
  readonly weakestDependency: ReceiptConfidence | null;
}

export interface CoverageResult {
  readonly currency: CurrencyCode;
  readonly today: PlainDate;
  readonly horizon: PlainDate;
  readonly cash: Money;
  readonly commitments: readonly CommitmentCoverage[];
  readonly totalCommitted: Money;
  /**
   * Hasta qué día llega el efectivo solo. Nulo cuando ni el primer compromiso
   * está cubierto, que es una frase distinta y hay que poder decirla.
   */
  readonly coveredThrough: PlainDate | null;
  /** Lo que tiene que entrar para llegar al final del horizonte. */
  readonly mustArrive: Money;
  /** Y para cuándo: el vencimiento del primer compromiso que el efectivo no paga. */
  readonly mustArriveBy: PlainDate | null;
  /** Lo que la casa espera cobrar dentro del horizonte, de cualquier certeza. */
  readonly expectedInHorizon: Money;
  /** De eso, lo confirmado. La cifra que de verdad sostiene una decisión. */
  readonly confirmedInHorizon: Money;
  /** Lo que no cubre ni el efectivo ni todo lo esperado. */
  readonly uncovered: Money;
  readonly hasUncovered: boolean;
}

export interface CoverageInput {
  readonly currency: CurrencyCode;
  readonly today: PlainDate;
  /** El efectivo disponible hoy. Nunca un cobro, nunca un límite de crédito. */
  readonly cash: Money;
  readonly commitments: readonly CoverageCommitment[];
  readonly expected: readonly ExpectedReceipt[];
  readonly horizonDays?: number;
}

export function computeCoverage(input: CoverageInput): CoverageResult {
  const { currency, today } = input;
  const zero = Money.zero(currency);
  const horizon = addDays(today, input.horizonDays ?? COVERAGE_HORIZON_DAYS);

  const commitments = [...input.commitments]
    .filter((one) => one.due <= horizon)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));

  /**
   * Los cobros, del más firme al más flojo y, dentro de cada grado, del que
   * cierra antes al que cierra después.
   *
   * El orden importa porque el reparto es codicioso: el alquiler del 10 se lleva
   * primero lo confirmado que llega antes del 10, y lo que quede flojo se
   * ofrece a lo que vence después. Al revés, un compromiso temprano quedaría
   * apoyado en una conversación telefónica mientras la factura firmada financia
   * algo del día 28.
   */
  const pool = input.expected
    .filter((one) => one.to !== null)
    .map((one) => ({ receipt: one, left: one.amount }))
    .sort((a, b) => {
      const byCertainty =
        CONFIDENCE_RANK[a.receipt.confidence] - CONFIDENCE_RANK[b.receipt.confidence];
      if (byCertainty !== 0) return byCertainty;
      const aTo = a.receipt.to ?? '9999-12-31';
      const bTo = b.receipt.to ?? '9999-12-31';
      return aTo < bTo ? -1 : aTo > bTo ? 1 : 0;
    });

  let cash = input.cash.isPositive() ? input.cash : zero;
  let coveredThrough: PlainDate | null = null;
  let cashRanOut = false;
  let mustArrive = zero;
  let mustArriveBy: PlainDate | null = null;

  const covered: CommitmentCoverage[] = commitments.map((commitment) => {
    const amount = commitment.amount.isPositive() ? commitment.amount : zero;

    const fromCash = Money.min(cash, amount);
    cash = cash.subtract(fromCash);
    let owed = amount.subtract(fromCash);

    if (owed.isZero() && !cashRanOut) {
      coveredThrough = commitment.due;
    } else if (owed.isPositive()) {
      cashRanOut = true;
      mustArrive = mustArrive.add(owed);
      mustArriveBy ??= commitment.due;
    }

    const dependsOn: CoverageDependency[] = [];
    let fromExpected = zero;

    for (const entry of pool) {
      if (!owed.isPositive()) break;
      if (!entry.left.isPositive()) continue;
      // La regla que hace el trabajo: la ventana tiene que cerrar antes del
      // vencimiento. Un cobro que «puede que llegue el 30» no paga el día 25.
      if ((entry.receipt.to ?? '9999-12-31') > commitment.due) continue;

      const applied = Money.min(entry.left, owed);
      entry.left = entry.left.subtract(applied);
      owed = owed.subtract(applied);
      fromExpected = fromExpected.add(applied);
      dependsOn.push({
        receiptId: entry.receipt.id,
        label: entry.receipt.label,
        amount: applied,
        by: commitment.due,
        confidence: entry.receipt.confidence,
      });
    }

    const verdict: CoverageVerdict = owed.isPositive()
      ? 'uncovered'
      : fromExpected.isPositive()
        ? 'conditional'
        : 'covered';

    return {
      id: commitment.id,
      label: commitment.label,
      due: commitment.due,
      amount,
      isEssential: commitment.isEssential,
      verdict,
      fromCash,
      fromExpected,
      shortfall: owed,
      dependsOn,
      weakestDependency: weakest(dependsOn),
    };
  });

  const inHorizon = input.expected.filter((one) => one.to !== null && one.to <= horizon);

  return {
    currency,
    today,
    horizon,
    cash: input.cash,
    commitments: covered,
    totalCommitted: Money.sum(
      covered.map((one) => one.amount),
      currency,
    ),
    coveredThrough,
    mustArrive,
    mustArriveBy,
    expectedInHorizon: Money.sum(
      inHorizon.map((one) => one.amount),
      currency,
    ),
    confirmedInHorizon: Money.sum(
      inHorizon.filter((one) => one.confidence === 'confirmed').map((one) => one.amount),
      currency,
    ),
    uncovered: Money.sum(
      covered.map((one) => one.shortfall),
      currency,
    ),
    hasUncovered: covered.some((one) => one.verdict === 'uncovered'),
  };
}

function weakest(dependencies: readonly CoverageDependency[]): ReceiptConfidence | null {
  let found: ReceiptConfidence | null = null;
  for (const dependency of dependencies) {
    if (!found || CONFIDENCE_RANK[dependency.confidence] > CONFIDENCE_RANK[found]) {
      found = dependency.confidence;
    }
  }
  return found;
}
