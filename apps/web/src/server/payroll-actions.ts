'use server';

import { Money } from '@app/domain';
import { estimatePayroll, thirteenthMonth, PANAMA_2026_DRAFT } from '@app/tax-engine';

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
  /** El porcentaje que explica la línea, como se cita: `9.75`. */
  readonly rate: string;
  /** Si ese porcentaje es el de la ley o el que le tocó a este sueldo. */
  readonly isEffectiveRate: boolean;
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
    lines: result.lines.map((line) => ({
      key: line.key,
      amount: asShown(line.amount),
      rate: line.rate,
      isEffectiveRate: line.isEffectiveRate,
    })),
    net: asShown(result.net),
    // Nunca deja de serlo mientras nadie revise el conjunto, y el día que
    // alguien lo publique esto lo dirá solo.
    isEstimate: !result.mayPresentAsOwed,
    source: 'CSS · Seguro Educativo · Código Fiscal',
  };
}

/** Una partida del decimotercer mes, lista para rellenar un cobro. */
export interface ThirteenthOut {
  readonly on: string;
  readonly amount: string;
}

/**
 * El decimotercer mes de un sueldo, en las tres fechas en que se paga.
 *
 * Se ofrece para rellenar tres cobros esperados —abril, agosto y diciembre— que
 * la persona confirma o corrige. No se anota solo: el hogar decide si su sueldo
 * lo tiene, porque no todo ingreso en este paso es una planilla y ninguna ley
 * cubre un alquiler ni una factura de un cliente.
 *
 * Igual que el resto de este archivo, sale de un conjunto de reglas en borrador
 * que nadie calificado revisó. Y para salario variable la ley manda sobre lo
 * devengado en el cuatrimestre, que este conjunto no modela: por eso lo que
 * queda guardado es lo que la persona confirmó.
 */
export async function estimateThirteenthMonth(
  amount: string,
  frequency: string,
  year: number,
): Promise<{ ok: boolean; instalments?: readonly ThirteenthOut[] }> {
  await Promise.resolve();

  const paymentsPerYear = PAYMENTS_PER_YEAR[frequency];
  if (paymentsPerYear === undefined) return { ok: false };
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { ok: false };

  const clean = amount.replace(/[^\d.]/g, '');
  if (clean === '' || Number(clean) <= 0) return { ok: false };

  // Un sueldo mensual, sea cual sea la cadencia con que se cobre: la ley habla
  // de un mes de salario, no de un pago.
  const monthly = Money.fromDecimalString(clean, 'PAB').multiply(paymentsPerYear).divide(12);

  const parts = thirteenthMonth({ monthlySalary: monthly, year, rules: PANAMA_2026_DRAFT });
  if (!parts) return { ok: false };

  return {
    ok: true,
    instalments: parts.map((one) => ({ on: one.on, amount: asShown(one.amount) })),
  };
}
