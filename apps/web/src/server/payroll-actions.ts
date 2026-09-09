'use server';

import { Money } from '@app/domain';
import { estimatePayroll, PANAMA_2026_DRAFT } from '@app/tax-engine';

/**
 * Los descuentos de planilla, calculados para rellenar un formulario.
 *
 * Lo que devuelve es una sugerencia editable, no una cifra que este producto
 * afirme. El conjunto de reglas del que sale es un borrador que nadie
 * calificado revisó —`mayPresent()` es falso para él— y eso decide lo único que
 * importa: estos números llegan a una pantalla donde la persona los compara con
 * su propio recibo y corrige lo que no cuadre. Lo que queda guardado es lo que
 * ella confirmó.
 *
 * Por eso la respuesta lleva `isEstimate` y la fuente: una pantalla que los
 * muestre sin decir de dónde salen los estaría presentando como hechos, y no lo
 * son todavía.
 */

export interface PayrollLineOut {
  readonly key: string;
  readonly amount: string;
}

export interface PayrollEstimateOut {
  readonly ok: boolean;
  readonly lines?: readonly PayrollLineOut[];
  readonly net?: string;
  /** Siempre true mientras el conjunto de reglas siga en borrador. */
  readonly isEstimate?: boolean;
  readonly source?: string;
}

/** Cuántas veces al año se paga cada cadencia. */
const PAYMENTS_PER_YEAR: Record<string, number> = {
  daily: 365,
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  quarterly: 4,
  annual: 1,
};

/** Como lo escribiría una persona: dos decimales, sin ceros de relleno extra. */
const asShown = (value: Money): string => Number(value.toDecimalString()).toFixed(2);

export async function estimatePanamaPayroll(
  gross: string,
  frequency: string,
): Promise<PayrollEstimateOut> {
  // La cuenta es pura y no espera nada, pero un archivo `'use server'` solo
  // exporta funciones asíncronas: es el contrato con el cliente, no una
  // consecuencia de que aquí haya E/S. El día que las tasas se lean de
  // `platform.tax_rules` en vez del conjunto empaquetado, la firma no cambia.
  await Promise.resolve();

  const paymentsPerYear = PAYMENTS_PER_YEAR[frequency];
  if (paymentsPerYear === undefined) return { ok: false };

  const clean = gross.replace(/[^\d.]/g, '');
  if (clean === '' || Number(clean) <= 0) return { ok: false };

  const result = estimatePayroll({
    // El conjunto panameño está en balboas; la paridad con el dólar es una
    // política y no una identidad, así que la cuenta se hace en la moneda del
    // conjunto y el resultado son cifras, no dinero de otra moneda.
    gross: Money.fromDecimalString(clean, 'PAB'),
    paymentsPerYear,
    rules: PANAMA_2026_DRAFT,
  });
  if (!result) return { ok: false };

  return {
    ok: true,
    // A dos decimales, que es como lo dice un recibo. El dinero se guarda con
    // cuatro y esta cifra va a un campo que una persona va a leer y corregir:
    // «195.0000» en una casilla de dinero se ve como un error del sistema.
    lines: result.lines.map((line) => ({ key: line.key, amount: asShown(line.amount) })),
    net: asShown(result.net),
    // Nunca deja de serlo mientras nadie revise el conjunto, y el día que
    // alguien lo publique esto lo dirá solo.
    isEstimate: !result.mayPresentAsOwed,
    source: 'CSS · Seguro Educativo · Código Fiscal',
  };
}
