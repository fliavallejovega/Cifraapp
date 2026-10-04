import 'server-only';

import { parseOutput, toJsonSchema, type ObjectShape } from '@app/ai';
import { readOcrRows, type OcrRow, type ParsedStatement } from '@app/transaction-engine';
import type { CurrencyCode, PlainDate } from '@app/domain';

import { providerFor } from './ai';

/**
 * Leer un estado de cuenta que llegó como escaneo o como foto.
 *
 * ## Por qué esto existe
 *
 * Un PDF de banco trae capa de texto y el parser posicional lo recorre. Un
 * escaneo no: es una imagen de una tabla, y hasta hoy el importador la rechazaba
 * por su nombre. Rechazarla es honesto —mejor que devolver cero filas y dejar
 * que la casa concluya que su mes estuvo vacío— pero no es útil, y leer estados
 * de cuenta es el trabajo central de este producto.
 *
 * ## Qué proveedor
 *
 * El mismo que ya está configurado. Claude lee PDF e imagen de forma nativa, así
 * que no hace falta contratar un servicio de OCR aparte: el documento viaja como
 * bloque adjunto en la misma llamada. Un vendor menos es una credencial menos,
 * un contrato menos y un sitio menos por donde se fuga un estado de cuenta.
 *
 * ## Qué se le pide y qué no
 *
 * Se le pide **transcribir**: la fecha como está impresa, el concepto como está
 * impreso, el monto como está impreso. No se le pide sumar, ni cuadrar contra el
 * saldo, ni decidir si una línea ya estaba registrada, ni clasificarla. Todo eso
 * lo hace código determinista después, sobre lo que él transcribió.
 *
 * ## Por qué no pasa por el guardián de cifras
 *
 * `ungroundedFigures` existe para que un modelo que **narra** no invente un
 * número que no esté en los datos que se le dieron. Aquí el modelo no narra:
 * lee, y por definición cada cifra que devuelve es nueva. Aplicarle ese guardián
 * rechazaría toda transcripción correcta. Lo que la reemplaza es más estricto y
 * más adecuado: cada monto pasa por el mismo `parseAmountText` que las demás
 * rutas, cada fecha por el mismo `parseStatementDate`, lo que no pase se rechaza
 * con su texto a la vista, y **nada se archiva solo** — todo entra a la cola de
 * revisión igual que una fila de CSV.
 */

const SHAPE = {
  accountDigits: {
    kind: 'text',
    description:
      'The account or card number printed in the header, exactly as printed, masked or not: "XXXX-XXXX-XXXX-0209", "****0209", "04-72-01-091783-1". Empty if the page does not show one. Never take it from a movement line.',
    maxLength: 48,
  },
  printedYear: {
    kind: 'text',
    description:
      'The four-digit year printed on the page for the statement period or the movements, if any is printed. Empty if no year appears — do not assume one.',
    // Holgado a propósito: un «2026-2027» de más no puede tumbar la lectura entera.
    maxLength: 16,
  },
  rows: {
    kind: 'record_list',
    description:
      'Every movement line on the statement, in the order printed, top to bottom. Include every line, including ones you are unsure about — a line left out is a line the household will never see again.',
    maxItems: 600,
    fields: {
      date: {
        kind: 'text',
        description:
          'The date exactly as printed on that line: "07/09/2026", "7 SEP", "2026-09-07", "Ayer", "Hoy". In a banking-app screenshot where movements sit under a date heading, repeat that heading on each line under it. Do not convert it, do not reformat it, do not fill in a missing year.',
        maxLength: 24,
      },
      description: {
        kind: 'text',
        description:
          'The concept exactly as printed, including the merchant name and any reference. Do not tidy it, expand abbreviations, or translate it.',
        maxLength: 200,
      },
      amount: {
        kind: 'text',
        description:
          'The figure exactly as printed, with its thousands separators, decimal mark and sign: "1,234.56", "-40.00", "B/. 125.40". Never compute, round, or convert it.',
        maxLength: 32,
      },
      direction: {
        kind: 'choice',
        description:
          'What the page itself says: debit if the line is a charge or withdrawal, credit if it is a payment or deposit, unknown if the page does not make it clear. Read the page’s own marks: in a bank account or a banking-app list, a minus sign or a red figure is a debit, and an unsigned figure in a list where others carry a minus is a credit. On a credit-card statement, a minus, «CR» or «PAGO» on the figure is a credit. Do not infer from the merchant.',
        options: ['debit', 'credit', 'unknown'],
      },
      top: {
        kind: 'number',
        description:
          'Where this line sits on the page, as a fraction of the page height: 0 is the top edge, 1 the bottom edge, 0.5 the middle. Measure the middle of the line. For a multi-page PDF, measure within its own page.',
        minimum: 0,
        maximum: 1,
      },
    },
  },
} as const satisfies ObjectShape;

const SYSTEM = [
  'You transcribe bank and credit-card statements. You are a reader, not an analyst.',
  '',
  'Copy what is printed, character for character, for every movement line on the page.',
  'Do not total anything. Do not reconcile against a balance. Do not skip lines that',
  'look like duplicates — deciding that is somebody else’s job and you would be',
  'guessing. Do not categorise. Do not correct what looks like a typo in the',
  'statement: it may be the statement, and a silent correction is unauditable.',
  '',
  'Ignore the opening and closing balance rows, subtotals, interest-rate tables,',
  'marketing copy and page furniture. Only movement lines.',
  '',
  'If a line is partly illegible, return it anyway with the part you can read. A row',
  'that fails validation is shown to a person with its raw text; a row you dropped',
  'is gone.',
].join('\n');

const USER = [
  'Transcribe every movement line in the attached statement or banking-app screenshot.',
  'Return them in the order they are printed.',
].join('\n');

/** Lo que este despliegue puede leer como imagen. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export type OcrOutcome =
  | { readonly ok: true; readonly statement: ParsedStatement; readonly model: string }
  | { readonly ok: false; readonly reason: OcrFailure; readonly detail?: string };

export type OcrFailure =
  'not_configured' | 'unsupported_type' | 'too_large' | 'transport' | 'malformed' | 'no_rows';

/**
 * El tope de tamaño de lo que se manda a leer.
 *
 * Más bajo que el del importador entero: un estado de cuenta escaneado de más de
 * cinco megas es un documento de cien páginas o un escaneo a resolución de
 * imprenta, y en los dos casos la respuesta correcta es pedir otro archivo antes
 * de gastar la llamada.
 */
const MAX_OCR_BYTES = 5 * 1024 * 1024;

export function canReadByOcr(mimeType: string): boolean {
  return mimeType === 'application/pdf' || IMAGE_TYPES.has(mimeType);
}

export async function readStatementByOcr(input: {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly accountId: string;
  readonly currency: CurrencyCode;
  readonly dayFirst?: boolean;
  /** The upload day: a screenshot prints «28 sep» or «Ayer» and no year. */
  readonly referenceDate?: PlainDate;
  /** Bank account or card, for what a printed minus means. */
  readonly accountKind?: 'bank' | 'card';
}): Promise<OcrOutcome> {
  if (!canReadByOcr(input.mimeType)) {
    return { ok: false, reason: 'unsupported_type' };
  }

  if (input.bytes.byteLength > MAX_OCR_BYTES) {
    return { ok: false, reason: 'too_large' };
  }

  const provider = await providerFor('reading');
  if (provider.id === 'none') {
    return { ok: false, reason: 'not_configured' };
  }

  const result = await provider.complete({
    system: SYSTEM,
    user: USER,
    attachment: {
      kind: input.mimeType === 'application/pdf' ? 'pdf' : 'image',
      mediaType: input.mimeType,
      dataBase64: Buffer.from(input.bytes).toString('base64'),
    },
    outputSchema: toJsonSchema(SHAPE),
    // Un estado de cuenta largo son muchas filas cortas. El techo alto es lo que
    // impide que la transcripción se corte a la mitad del mes.
    maxOutputTokens: 16_000,
    // Cero: la misma página leída dos veces tiene que dar lo mismo. Una
    // transcripción que varía entre lecturas no se puede auditar.
    temperature: 0,
    timeoutMs: 120_000,
  });

  if (!result.ok) {
    return {
      ok: false,
      reason: result.error.kind === 'transport' ? 'transport' : 'malformed',
      ...(result.error.kind === 'transport' ? { detail: result.error.message } : {}),
    };
  }

  const parsed = parseOutput(SHAPE, result.value.raw);
  if (!parsed.ok) {
    return { ok: false, reason: 'malformed', detail: parsed.error.join('; ') };
  }

  const rows = parsed.value['rows'];
  if (!Array.isArray(rows)) {
    return { ok: false, reason: 'malformed' };
  }

  const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
  const printedYear = Number(/\b(20\d{2})\b/.exec(asText(parsed.value['printedYear']))?.[1] ?? 0);
  const accountDigits = asText(parsed.value['accountDigits']).trim();

  const statement = readOcrRows(rows.map(toOcrRow), {
    accountId: input.accountId,
    currency: input.currency,
    ...(input.dayFirst === undefined ? {} : { dayFirst: input.dayFirst }),
    ...(input.referenceDate ? { referenceDate: input.referenceDate } : {}),
    ...(printedYear >= 2000 && printedYear <= 2100 ? { printedYear } : {}),
    ...(accountDigits ? { accountDigits } : {}),
    ...(input.accountKind ? { accountKind: input.accountKind } : {}),
  });

  // Cero filas legibles no es un estado vacío: es una lectura fallida, y decirlo
  // así deja al hogar buscando otro archivo en vez de creyendo que no gastó.
  if (statement.transactions.length === 0) {
    return { ok: false, reason: 'no_rows' };
  }

  return { ok: true, statement, model: result.value.model };
}

/** Un registro del modelo, aplanado a texto antes de que lo toque el validador. */
function toOcrRow(record: Readonly<Record<string, string | number | boolean>>): OcrRow {
  return {
    date: String(record['date'] ?? ''),
    description: String(record['description'] ?? ''),
    amount: String(record['amount'] ?? ''),
    direction: String(record['direction'] ?? 'unknown'),
    ...(typeof record['top'] === 'number' ? { top: record['top'] } : {}),
  };
}
