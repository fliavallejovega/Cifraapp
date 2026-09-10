import { Money, type CurrencyCode } from '@app/domain';

import { computeFingerprint } from '../fingerprint.js';
import { normalizeDescription } from '../normalize.js';
import type { CandidateTransaction, ParsedStatement, RejectedRow } from '../types.js';

import { parseAmountText, parseStatementDate } from './table.js';

/**
 * Un estado de cuenta escaneado, después de que alguien lo leyó en voz alta.
 *
 * Un escaneo no tiene columnas. No hay capa de texto que recorrer ni celdas que
 * mapear: hay una fotografía de una tabla. Alguien tiene que mirarla y decir qué
 * dice, y en este despliegue ese alguien es un modelo con vista.
 *
 * ## Lo que el modelo hace y lo que no
 *
 * **Transcribe.** Devuelve la fecha como está impresa, la descripción como está
 * impresa y el monto como está impreso — `1,234.56`, con su coma y su signo, no
 * un número que él haya interpretado. Nada más.
 *
 * **No decide.** No suma, no concilia contra el saldo, no juzga si una línea ya
 * estaba registrada, no clasifica. Todo eso lo hace código determinista con lo
 * que él transcribió, y lo hace después. La razón no es desconfianza genérica:
 * un modelo que suma bien casi siempre y mal a veces, sobre una columna de
 * movimientos, produce un saldo que nadie puede auditar.
 *
 * ## Por qué esto no viola «la IA nunca es la fuente de la verdad»
 *
 * Porque leer no es decidir. El parser de CSV también convierte bytes en filas
 * y nadie lo llama una fuente de verdad: es un lector. La diferencia es que un
 * lector puede equivocarse de formas nuevas, así que **todo lo que sale de aquí
 * entra a la cola de revisión**, ninguna fila se archiva sola, y cada monto pasa
 * por el mismo `parseAmountText` que usan las demás rutas. Si el modelo devuelve
 * algo que no es un monto, la fila se rechaza con su texto crudo a la vista, no
 * se corrige.
 *
 * ## Por qué las filas rechazadas se enseñan
 *
 * Una transcripción con seis de siete líneas es peor que ninguna si la séptima
 * desaparece en silencio: el hogar cuadra el mes contra un total que le falta un
 * cargo. Cada línea que no se pudo leer viaja con su texto original y su motivo.
 */

/** Una línea tal como el modelo la leyó, sin interpretar. */
export interface OcrRow {
  /** La fecha como está impresa: `07/09/2026`, `7 sep`, `2026-09-07`. */
  readonly date: string;
  readonly description: string;
  /** El monto como está impreso, con separadores y signo. */
  readonly amount: string;
  /**
   * Lo que la página dice sobre la dirección: `debit`, `credit` o `unknown`.
   *
   * `unknown` es una respuesta legítima y frecuente — muchos estados no marcan
   * la dirección salvo por la columna en que cae la cifra. Sin declaración se
   * asume cargo, que es lo que es la mayoría de las líneas de un estado.
   */
  readonly direction: string;
}

export interface OcrParseOptions {
  readonly accountId: string;
  readonly currency: CurrencyCode;
  /** Panamá escribe día primero. Es lo que decide si `07/09` es julio o setiembre. */
  readonly dayFirst?: boolean;
}

/**
 * Un tope duro de filas.
 *
 * No es una optimización: es el límite que impide que una transcripción que se
 * descarriló —un modelo repitiendo la misma línea— entre como mil movimientos.
 * Un estado de cuenta de un mes no tiene seiscientas líneas.
 */
const MAX_ROWS = 600;

export function readOcrRows(
  rows: readonly OcrRow[],
  options: OcrParseOptions,
): ParsedStatement {
  const dayFirst = options.dayFirst ?? true;
  const transactions: CandidateTransaction[] = [];
  const rejected: RejectedRow[] = [];

  rows.slice(0, MAX_ROWS).forEach((row, index) => {
    const line = index + 1;
    const raw = `${row.date} ${row.description} ${row.amount}`.trim();

    const date = parseStatementDate(row.date, dayFirst);
    if (!date) {
      rejected.push({ line, raw, reason: 'unreadable_date' });
      return;
    }

    const amountText = parseAmountText(row.amount);
    if (amountText === null) {
      rejected.push({ line, raw, reason: 'unreadable_amount' });
      return;
    }

    const description = row.description.trim();
    if (description === '') {
      // Un monto sin concepto no se puede conciliar ni clasificar, y aceptarlo
      // llenaría el mes de líneas que nadie puede identificar después.
      rejected.push({ line, raw, reason: 'missing_description' });
      return;
    }

    const signed = Money.fromDecimalString(amountText, options.currency);
    if (signed.isZero()) {
      rejected.push({ line, raw, reason: 'zero_amount' });
      return;
    }

    const amount = signed.abs();
    const direction = directionOf(row.direction);
    const { normalized } = normalizeDescription(description);

    transactions.push({
      transactionDate: date,
      amount,
      direction,
      descriptionOriginal: description,
      descriptionNormalized: normalized,
      fingerprint: computeFingerprint({
        accountId: options.accountId,
        transactionDate: date,
        amount,
        descriptionNormalized: normalized,
      }),
    });
  });

  if (rows.length > MAX_ROWS) {
    rejected.push({
      line: MAX_ROWS + 1,
      raw: '',
      reason: 'too_many_rows',
    });
  }

  return { format: 'pdf', currency: options.currency, transactions, rejected };
}

/**
 * Entrada o salida.
 *
 * Lo que la página dice manda. Cuando no dice nada se asume cargo, y el signo
 * **no** se usa para desempatar a propósito: un menos significa cosas opuestas
 * en un estado de banco y en uno de tarjeta —salida en el primero, un pago que
 * baja la deuda en el segundo— y resolverlo con una regla única acertaría en la
 * mitad de los archivos. Un cargo es lo que es la abrumadora mayoría de las
 * líneas, todo esto entra a revisión igual, y corregir una casilla cuesta menos
 * que dar por recibido dinero que nadie recibió.
 */
function directionOf(declared: string): 'inflow' | 'outflow' {
  const said = declared.trim().toLowerCase();
  return said === 'credit' || said === 'inflow' ? 'inflow' : 'outflow';
}
