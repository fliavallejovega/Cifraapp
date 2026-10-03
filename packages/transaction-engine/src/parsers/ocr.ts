import { addDays, Money, plainDateFromParts, type CurrencyCode, type PlainDate } from '@app/domain';

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
  /**
   * El día en que se subió el archivo.
   *
   * Una captura de la app del banco dice «28 sep», «Ayer» o «Hoy», sin año. Con
   * esta fecha cada línea toma el año que la deja en el pasado más cercano: un
   * «28 dic» leído en enero es del año anterior, no del que empieza.
   */
  readonly referenceDate?: PlainDate;
  /** El año impreso en la página (el periodo del estado), cuando lo hay. */
  readonly printedYear?: number;
  /** Los dígitos de la cuenta o tarjeta tal como el lector los vio impresos. */
  readonly accountDigits?: string;
}

/**
 * Un tope duro de filas.
 *
 * No es una optimización: es el límite que impide que una transcripción que se
 * descarriló —un modelo repitiendo la misma línea— entre como mil movimientos.
 * Un estado de cuenta de un mes no tiene seiscientas líneas.
 */
const MAX_ROWS = 600;

export function readOcrRows(rows: readonly OcrRow[], options: OcrParseOptions): ParsedStatement {
  const dayFirst = options.dayFirst ?? true;
  const transactions: CandidateTransaction[] = [];
  const rejected: RejectedRow[] = [];

  rows.slice(0, MAX_ROWS).forEach((row, index) => {
    const line = index + 1;
    const raw = `${row.date} ${row.description} ${row.amount}`.trim();

    const date =
      parseStatementDate(row.date, dayFirst) ??
      readLooseDate(row.date, dayFirst, options.referenceDate, options.printedYear);
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

  const digits = options.accountDigits?.replace(/\D/g, '') ?? '';
  const accountHint = digits.length >= 4 ? digits.slice(-4) : undefined;

  return {
    format: 'pdf',
    currency: options.currency,
    ...(accountHint ? { accountHint } : {}),
    transactions,
    rejected,
  };
}

const MONTHS: Record<string, number> = {
  ene: 1,
  jan: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  aug: 8,
  sep: 9,
  set: 9,
  oct: 10,
  nov: 11,
  dic: 12,
  dec: 12,
};

/**
 * Una fecha sin año, como la imprime una app de banco.
 *
 * `28 sep`, `sep 28`, `28 de septiembre`, `07/09`, `Hoy`, `Ayer`. Sin la fecha
 * de referencia no hay forma honesta de saber el año, y la línea se rechaza con
 * su texto a la vista, como antes. Con ella, el año es el impreso en la página
 * si lo hay; si no, el de la referencia — y si eso deja la fecha en el futuro,
 * el anterior, porque un estado no trae movimientos que todavía no pasaron.
 */
export function readLooseDate(
  raw: string,
  dayFirst: boolean,
  reference: PlainDate | undefined,
  printedYear?: number,
): PlainDate | null {
  if (!reference) return null;
  const text = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (/^(hoy|today)\b/.test(text)) return reference;
  if (/^(ayer|yesterday)\b/.test(text)) return addDays(reference, -1);

  let day: number | undefined;
  let month: number | undefined;
  let year: number | undefined;

  const dayName = /^(\d{1,2})\s*(?:de\s+)?([a-z]{3,})\.?(?:,?\s+(?:de\s+)?(\d{2,4}))?/.exec(text);
  const nameDay = /^([a-z]{3,})\.?\s+(\d{1,2})(?:,?\s+(\d{2,4}))?/.exec(text);
  const numeric = /^(\d{1,2})[/\-.](\d{1,2})$/.exec(text);

  if (dayName) {
    day = Number(dayName[1]);
    month = MONTHS[dayName[2]?.slice(0, 3) ?? ''];
    if (dayName[3]) year = Number(dayName[3]);
  } else if (nameDay) {
    month = MONTHS[nameDay[1]?.slice(0, 3) ?? ''];
    day = Number(nameDay[2]);
    if (nameDay[3]) year = Number(nameDay[3]);
  } else if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    day = second > 12 ? second : first > 12 ? first : dayFirst ? first : second;
    month = second > 12 ? first : first > 12 ? second : dayFirst ? second : first;
  }

  if (!day || !month || day > 31) return null;
  if (year !== undefined && year < 100) year += 2000;

  const explicit = year !== undefined;
  const base = year ?? printedYear ?? Number(reference.slice(0, 4));

  let date: PlainDate;
  try {
    date = plainDateFromParts(base, month, day);
  } catch {
    return null;
  }

  if (!explicit && date > reference) {
    try {
      date = plainDateFromParts(base - 1, month, day);
    } catch {
      return null;
    }
  }
  return date;
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
