import { Money, toPlainDate, type CurrencyCode, type PlainDate } from '@app/domain';

import { ungroundedFigures } from './guardrails.js';
import type { Grounding, OutputRecord } from './types.js';

/**
 * Lo que el chat puede pedir que cambie, sin poder cambiarlo.
 *
 * Hasta aquí el copiloto sólo explicaba. La queja legítima es evidente: alguien
 * que acaba de leer «tu alquiler del 30 está descubierto por $240» quiere decir
 * «entonces mové la meta del viaje al mes que viene», y tener que ir a buscar la
 * pantalla de metas convierte una conversación en una tarea.
 *
 * Dejar que el modelo escriba en la base de datos, en cambio, rompe la regla que
 * sostiene todo lo demás: **la IA nunca es la fuente de verdad**. Un modelo que
 * puede modificar un plan puede modificarlo mal, con seguridad, y en un producto
 * financiero eso no es un bug: es dinero mal repartido y una casa que no sabe
 * por qué.
 *
 * La salida es que el modelo no propone acciones libres, propone **filas de un
 * catálogo cerrado**, y cada fila pasa tres puertas deterministas antes de que
 * una persona la vea:
 *
 *   1. **El tipo tiene que estar en la lista.** `ProposalKind` es cerrado.
 *      Nada que no esté aquí se puede pedir, aunque el modelo lo escriba.
 *   2. **El objetivo tiene que ser una fila del hogar.** Los identificadores se
 *      contrastan contra los que el llamador cargó; no hay camino desde una
 *      propuesta hasta una fila que la sesión no podía leer.
 *   3. **Las cifras tienen que venir del contexto.** Un monto que no aparezca en
 *      el `grounding` se rechaza. El modelo puede reordenar lo que se le
 *      enseñó; no puede inventar un número nuevo y presentarlo como propuesta.
 *
 * Y después de las tres puertas, la propuesta sigue sin aplicarse: se guarda
 * como pendiente y espera a que alguien la confirme. Aplicar sin confirmar sería
 * el mismo error con más pasos.
 */

/**
 * Lo que se puede proponer. Cerrado a propósito.
 *
 * Agregar un miembro es el momento de preguntarse si lo nuevo es un ajuste que
 * la casa podría hacer sola en dos clics —lo cual está bien— o una operación que
 * destruye estado financiero. Borrar una cuenta, eliminar un movimiento, saldar
 * una deuda y cerrar un mes están ausentes porque están prohibidos, no porque
 * nadie los haya necesitado todavía.
 */
export type ProposalKind =
  | 'set_income_floor'
  | 'set_cushion_months'
  | 'set_buffer_minimum'
  | 'set_tax_reserve_rate'
  | 'set_debt_strategy'
  | 'set_receivable_window'
  | 'set_receivable_confidence'
  | 'set_goal_priority'
  | 'set_goal_target_date';

export const PROPOSAL_KINDS: readonly ProposalKind[] = [
  'set_income_floor',
  'set_cushion_months',
  'set_buffer_minimum',
  'set_tax_reserve_rate',
  'set_debt_strategy',
  'set_receivable_window',
  'set_receivable_confidence',
  'set_goal_priority',
  'set_goal_target_date',
];

export type DebtStrategy = 'avalanche' | 'snowball' | 'custom' | 'hybrid';
export type ReceivableConfidence = 'confirmed' | 'likely' | 'estimated';

/** Una propuesta ya validada. El `reason` es del modelo; todo lo demás no. */
export type PlanProposal = { readonly reason: string } & (
  | { readonly kind: 'set_income_floor'; readonly amount: Money }
  | { readonly kind: 'set_cushion_months'; readonly months: number }
  | { readonly kind: 'set_buffer_minimum'; readonly amount: Money }
  | { readonly kind: 'set_tax_reserve_rate'; readonly rate: number }
  | { readonly kind: 'set_debt_strategy'; readonly strategy: DebtStrategy }
  | {
      readonly kind: 'set_receivable_window';
      readonly receivableId: string;
      readonly from: PlainDate;
      readonly to: PlainDate;
    }
  | {
      readonly kind: 'set_receivable_confidence';
      readonly receivableId: string;
      readonly confidence: ReceivableConfidence;
    }
  | { readonly kind: 'set_goal_priority'; readonly goalId: string; readonly priority: number }
  | { readonly kind: 'set_goal_target_date'; readonly goalId: string; readonly on: PlainDate }
);

/** Por qué se descartó una fila. Se enseña: un rechazo callado no se arregla. */
export interface RejectedProposal {
  readonly kind: string;
  readonly target: string;
  readonly value: string;
  readonly reason: string;
}

export interface ProposalReading {
  readonly accepted: readonly PlanProposal[];
  readonly rejected: readonly RejectedProposal[];
}

/**
 * Lo que el hogar tiene y contra lo que se valida.
 *
 * Las listas son las filas que la sesión ya cargó legítimamente. Que estén aquí
 * y no en una consulta dentro de esta función es deliberado: este paquete no
 * habla con la base de datos, y un validador que pudiera consultar sería un
 * validador que puede leer filas de otro hogar.
 */
export interface ProposalContext {
  readonly currency: CurrencyCode;
  readonly receivableIds: readonly string[];
  readonly goalIds: readonly string[];
  /** Las cifras que el modelo tenía delante. Nada fuera de aquí se acepta. */
  readonly grounding: Grounding;
  /** Hoy, para rechazar una ventana o una meta puesta en el pasado. */
  readonly today: PlainDate;
}

/** El máximo de propuestas que se leen de una respuesta. */
export const MAX_PROPOSALS = 5;

export function readProposals(
  rows: readonly OutputRecord[],
  context: ProposalContext,
): ProposalReading {
  const accepted: PlanProposal[] = [];
  const rejected: RejectedProposal[] = [];

  for (const row of rows.slice(0, MAX_PROPOSALS)) {
    const kind = text(row['kind']);
    const target = text(row['target']);
    const value = text(row['value']);
    const reason = text(row['reason']);

    const fail = (why: string): void => {
      rejected.push({ kind, target, value, reason: why });
    };

    if (!isProposalKind(kind)) {
      fail('No está en el catálogo de cambios que el chat puede proponer.');
      continue;
    }

    if (reason.length === 0) {
      // Una propuesta sin razón es un botón sin explicación, y la persona que
      // tiene que confirmarla se queda sin nada con qué decidir.
      fail('Llegó sin explicación de por qué.');
      continue;
    }

    const parsed = build(kind, target, value, reason, context, fail);
    if (parsed) accepted.push(parsed);
  }

  return { accepted, rejected };
}

function build(
  kind: ProposalKind,
  target: string,
  value: string,
  reason: string,
  context: ProposalContext,
  fail: (why: string) => void,
): PlanProposal | null {
  switch (kind) {
    case 'set_income_floor':
    case 'set_buffer_minimum': {
      const amount = groundedMoney(value, context, fail);
      if (!amount) return null;
      return { kind, amount, reason };
    }

    case 'set_cushion_months': {
      const months = wholeNumber(value, 1, 24, fail);
      if (months === null) return null;
      return { kind, months, reason };
    }

    case 'set_tax_reserve_rate': {
      const rate = wholeNumber(value.replace('%', ''), 0, 60, fail);
      if (rate === null) return null;
      return { kind, rate, reason };
    }

    case 'set_debt_strategy': {
      const strategy = value.trim().toLowerCase();
      if (!isDebtStrategy(strategy)) {
        fail('No es una de las estrategias que el motor de deuda conoce.');
        return null;
      }
      return { kind, strategy, reason };
    }

    case 'set_receivable_window': {
      if (!context.receivableIds.includes(target)) {
        fail('Ese cobro no es de este hogar.');
        return null;
      }
      // «2026-10-01..2026-10-10». Dos fechas y un separador: una ventana de un
      // solo día se escribe con la misma fecha dos veces, y así el formato no
      // tiene un caso especial que el modelo pueda equivocar.
      const [rawFrom, rawTo] = value.split('..');
      const from = date(rawFrom, fail);
      const to = date(rawTo, fail);
      if (!from || !to) return null;
      if (from > to) {
        fail('La ventana termina antes de empezar.');
        return null;
      }
      if (to < context.today) {
        fail('La ventana entera queda en el pasado.');
        return null;
      }
      return { kind, receivableId: target, from, to, reason };
    }

    case 'set_receivable_confidence': {
      if (!context.receivableIds.includes(target)) {
        fail('Ese cobro no es de este hogar.');
        return null;
      }
      const confidence = value.trim().toLowerCase();
      if (!isConfidence(confidence)) {
        fail('No es uno de los tres grados de certeza.');
        return null;
      }
      return { kind, receivableId: target, confidence, reason };
    }

    case 'set_goal_priority': {
      if (!context.goalIds.includes(target)) {
        fail('Esa meta no es de este hogar.');
        return null;
      }
      const priority = wholeNumber(value, 1, 99, fail);
      if (priority === null) return null;
      return { kind, goalId: target, priority, reason };
    }

    case 'set_goal_target_date': {
      if (!context.goalIds.includes(target)) {
        fail('Esa meta no es de este hogar.');
        return null;
      }
      const on = date(value, fail);
      if (!on) return null;
      if (on < context.today) {
        fail('La fecha ya pasó.');
        return null;
      }
      return { kind, goalId: target, on, reason };
    }
  }
}

/**
 * Un monto que el modelo tenía delante, no uno que se le ocurrió.
 *
 * Se reutiliza el mismo guardarraíl que impide inventar cifras en la prosa. Que
 * la puerta sea la misma importa: dos comprobaciones parecidas se separan con el
 * tiempo, y el día que se separen la propuesta será el agujero.
 */
function groundedMoney(
  value: string,
  context: ProposalContext,
  fail: (why: string) => void,
): Money | null {
  const cleaned = value.replace(/[^\d.,-]/g, '').replace(/,/g, '');
  if (cleaned.length === 0 || !/^-?\d+(?:\.\d+)?$/.test(cleaned)) {
    fail('No es un monto.');
    return null;
  }

  if (ungroundedFigures([value], context.grounding).length > 0) {
    fail('Es una cifra que no estaba entre los datos que se le dieron.');
    return null;
  }

  const amount = Money.fromDecimalString(cleaned, context.currency);
  if (amount.isNegative()) {
    fail('Un monto negativo no es una propuesta, es un error.');
    return null;
  }
  return amount;
}

function wholeNumber(
  value: string,
  low: number,
  high: number,
  fail: (why: string) => void,
): number | null {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    fail('No es un número.');
    return null;
  }
  const rounded = Math.round(parsed);
  if (rounded < low || rounded > high) {
    fail(`Fuera del rango permitido (${String(low)}–${String(high)}).`);
    return null;
  }
  return rounded;
}

function date(value: string | undefined, fail: (why: string) => void): PlainDate | null {
  const trimmed = value?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    fail('No es una fecha en formato AAAA-MM-DD.');
    return null;
  }
  try {
    return toPlainDate(trimmed);
  } catch {
    fail('Esa fecha no existe en el calendario.');
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isProposalKind(value: string): value is ProposalKind {
  return (PROPOSAL_KINDS as readonly string[]).includes(value);
}

function isDebtStrategy(value: string): value is DebtStrategy {
  return value === 'avalanche' || value === 'snowball' || value === 'custom' || value === 'hybrid';
}

function isConfidence(value: string): value is ReceivableConfidence {
  return value === 'confirmed' || value === 'likely' || value === 'estimated';
}
