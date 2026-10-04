import 'server-only';

import { parseOutput, toJsonSchema, type ObjectShape } from '@app/ai';
import {
  parseAmountText,
  readEdgeLine,
  readOcrRows,
  type EdgeLine,
  type OcrRow,
  type ParsedStatement,
} from '@app/transaction-engine';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';

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

const EDGE_SHAPE = {
  topCutDate: {
    kind: 'text',
    description:
      'Look at the strip directly under the app header bar, above the first movement you transcribed. In a scrolled list there is often the lower half of one more movement there — only its date line, or a sliver of its amount, shows. If so, copy that date exactly as printed («23 Septiembre 2026»); if only an amount shows, leave this empty and fill topCutAmount. Empty when the first movement below the header is complete.',
    maxLength: 32,
  },
  topCutAmount: {
    kind: 'text',
    description:
      'The amount of that half-hidden movement at the top, with its sign, if legible. Empty otherwise.',
    maxLength: 32,
  },
  cutLines: {
    kind: 'record_list',
    description:
      'Movement lines you could NOT transcribe in full because the image itself cuts them: at the top, a line partly hidden under the app header bar or above the first fully visible line (often only its date or its amount shows); at the bottom, a line sliced by the lower edge. Look carefully at the strip just below the header and at the very bottom. A line whose date and amount you CAN read — even if a floating button covers part of it — is not cut: it belongs in rows, not here. Give whatever part of a cut line is legible and leave the rest empty. Empty list when no line is cut.',
    maxItems: 4,
    fields: {
      edge: { kind: 'choice', description: 'Which edge cuts it.', options: ['top', 'bottom'] },
      date: {
        kind: 'text',
        description: 'The date as printed, if legible; empty otherwise.',
        maxLength: 24,
      },
      description: {
        kind: 'text',
        description: 'The concept as printed, as far as legible; empty otherwise.',
        maxLength: 200,
      },
      amount: {
        kind: 'text',
        description: 'The figure as printed with its sign, if legible; empty otherwise.',
        maxLength: 32,
      },
    },
  },
} as const satisfies ObjectShape;

/**
 * El saldo que la página imprime, aparte de los movimientos.
 *
 * Es el único número del estado que dice cuánto hay, y es del banco: con él el
 * saldo de la cuenta deja de depender de lo que alguien escribió el día que la
 * creó. Se lee aparte porque no es una fila — sumarlo a los movimientos sería
 * contarlo dos veces.
 */
const BALANCE_SHAPE = {
  printedBalance: {
    kind: 'text',
    description:
      'The account balance the page prints as of its latest date, exactly as printed with its sign: the closing balance («Saldo final», «Saldo al corte», «Saldo actual») on a statement, or the current or available balance shown at the top of a banking-app screen («Saldo disponible»). On a credit-card statement, the total balance owed («Saldo total», «Saldo al corte»), not the minimum payment. Empty if the page prints no balance. Never compute one.',
    maxLength: 32,
  },
  printedBalanceDate: {
    kind: 'text',
    description:
      'The date that balance is stated for, exactly as printed («30/09/2026», «Al 30 SEP»). Empty if the page prints no date for it.',
    maxLength: 24,
  },
} as const satisfies ObjectShape;

/**
 * What the header says about the account itself.
 *
 * A statement uploaded without choosing an account opens one, and the header
 * is where that account's facts are printed: whose bank it is, whether it is a
 * card, and — on a card — the minimum, the due date, the rate and the limit.
 * Read as printed and validated like every other figure; nothing is inferred.
 */
const HEADER_SHAPE = {
  institutionName: {
    kind: 'text',
    description:
      'The bank or issuer name as printed in the header or logo («Banco General», «Banistmo», «BAC»). Empty if none is shown.',
    maxLength: 60,
  },
  statementKind: {
    kind: 'choice',
    description:
      'card if this is a credit-card statement or a card screen in a banking app; bank if it is a checking, savings or wallet account; unknown if the page does not make it clear.',
    options: ['bank', 'card', 'unknown'],
  },
  cardMinimumPayment: {
    kind: 'text',
    description:
      'On a card statement, the minimum payment as printed («Pago mínimo»). Empty otherwise.',
    maxLength: 32,
  },
  cardDueDate: {
    kind: 'text',
    description:
      'On a card statement, the payment due date as printed («Fecha límite de pago»). Empty otherwise.',
    maxLength: 24,
  },
  cardApr: {
    kind: 'text',
    description:
      'On a card statement, the annual interest rate as printed («Tasa de interés anual», «24.00%»). Empty otherwise.',
    maxLength: 16,
  },
  cardCreditLimit: {
    kind: 'text',
    description:
      'On a card statement, the credit limit as printed («Límite de crédito»). Empty otherwise.',
    maxLength: 32,
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
  'marketing copy and page furniture. Only movement lines go in rows; the closing',
  'or current balance goes, as printed, in printedBalance and nowhere else.',
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
  | {
      readonly ok: true;
      readonly statement: ParsedStatement;
      readonly model: string;
      /** Lines cut at the image's edges: evidence of continuity, never filed. */
      readonly edges: { readonly top: EdgeLine | null; readonly bottom: EdgeLine | null };
      /** The balance the page prints, as printed and validated; null when none. */
      readonly balance: PrintedBalance | null;
      /** What the header says about the account, for opening one. */
      readonly header: StatementHeader;
    }
  | { readonly ok: false; readonly reason: OcrFailure; readonly detail?: string };

/** A balance as the page printed it: the figure with its printed sign, and its date if shown. */
export interface PrintedBalance {
  readonly amount: string;
  readonly date: PlainDate | null;
}

/** The account facts a statement header prints, each validated or null. */
export interface StatementHeader {
  readonly institution: string | null;
  readonly kind: 'bank' | 'card' | null;
  readonly minimumPayment: string | null;
  readonly dueDay: number | null;
  readonly apr: string | null;
  readonly creditLimit: string | null;
}

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
    outputSchema: toJsonSchema({ ...SHAPE, ...EDGE_SHAPE, ...BALANCE_SHAPE, ...HEADER_SHAPE }),
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

  const parsed = parseOutput(
    { ...SHAPE, ...EDGE_SHAPE, ...BALANCE_SHAPE, ...HEADER_SHAPE },
    result.value.raw,
  );
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

  // A «cut» line whose date, concept and amount are all legible is a full line
  // the reader was too cautious with: it is filed like any other, and stays an
  // edge for the continuity check.
  const legibleCut = cutLines(parsed.value['cutLines']).filter(
    (line) => line.date !== '' && line.amount !== '' && line.description !== '',
  );
  const promoted = legibleCut.map((line) => ({
    date: line.date,
    description: line.description,
    amount: line.amount,
    direction: 'unknown',
  }));
  const ordered = [
    ...promoted.filter((_, index) => legibleCut[index]?.edge === 'top'),
    ...rows.map(toOcrRow),
    ...promoted.filter((_, index) => legibleCut[index]?.edge === 'bottom'),
  ];

  // The account chosen says bank or card; without one, the page says it.
  const printedKind = asText(parsed.value['statementKind']);
  const kind: 'bank' | 'card' | undefined =
    input.accountKind ??
    (printedKind === 'card' ? 'card' : printedKind === 'bank' ? 'bank' : undefined);

  const statement = readOcrRows(ordered, {
    accountId: input.accountId,
    currency: input.currency,
    ...(input.dayFirst === undefined ? {} : { dayFirst: input.dayFirst }),
    ...(input.referenceDate ? { referenceDate: input.referenceDate } : {}),
    ...(printedYear >= 2000 && printedYear <= 2100 ? { printedYear } : {}),
    ...(accountDigits ? { accountDigits } : {}),
    ...(kind ? { accountKind: kind } : {}),
  });

  // Cero filas legibles no es un estado vacío: es una lectura fallida, y decirlo
  // así deja al hogar buscando otro archivo en vez de creyendo que no gastó.
  if (statement.transactions.length === 0) {
    return { ok: false, reason: 'no_rows' };
  }

  const options = {
    accountId: input.accountId,
    currency: input.currency,
    ...(input.dayFirst === undefined ? {} : { dayFirst: input.dayFirst }),
    ...(input.referenceDate ? { referenceDate: input.referenceDate } : {}),
    ...(printedYear >= 2000 && printedYear <= 2100 ? { printedYear } : {}),
  };
  const cut = cutLines(parsed.value['cutLines']);
  const topDate = asText(parsed.value['topCutDate']).trim();
  const topAmount = asText(parsed.value['topCutAmount']).trim();
  const edge = (which: 'top' | 'bottom'): EdgeLine | null => {
    // Nearest to the edge: the first cut at the top, the last at the bottom.
    const found = cut.filter((line) => line.edge === which);
    const line = which === 'top' ? found[0] : found.at(-1);
    if (line) return readEdgeLine(line, options);
    if (which === 'top' && (topDate !== '' || topAmount !== '')) {
      return readEdgeLine({ date: topDate, amount: topAmount, description: '' }, options);
    }
    return null;
  };

  return {
    ok: true,
    statement,
    model: result.value.model,
    edges: { top: edge('top'), bottom: edge('bottom') },
    balance: printedBalance(
      asText(parsed.value['printedBalance']),
      asText(parsed.value['printedBalanceDate']),
      options,
    ),
    header: {
      institution: asText(parsed.value['institutionName']).trim() || null,
      kind: kind ?? null,
      minimumPayment: positiveFigure(asText(parsed.value['cardMinimumPayment']), options.currency),
      dueDay: dueDayOf(asText(parsed.value['cardDueDate']), options),
      apr: rate(asText(parsed.value['cardApr'])),
      creditLimit: positiveFigure(asText(parsed.value['cardCreditLimit']), options.currency),
    },
  };
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

/**
 * The printed balance, through the same validators as every movement.
 *
 * Zero is a real balance — a card paid off — so it is not dropped the way a
 * zero-amount line is. Anything the amount parser refuses is no balance at all.
 */
function printedBalance(
  amountText: string,
  dateText: string,
  options: Parameters<typeof readEdgeLine>[1],
): PrintedBalance | null {
  const text = parseAmountText(amountText.trim());
  if (text === null) return null;
  let amount: string;
  try {
    amount = Money.fromDecimalString(text, options.currency).toDecimalString();
  } catch {
    return null;
  }
  const { date } = readEdgeLine({ date: dateText.trim(), amount: '', description: '' }, options);
  return { amount, date };
}

/** A printed figure as a positive decimal string, or null when it does not read as one. */
function positiveFigure(text: string, currency: CurrencyCode): string | null {
  const parsed = parseAmountText(text.trim());
  if (parsed === null) return null;
  try {
    const value = Money.fromDecimalString(parsed, currency).abs();
    return value.isZero() ? null : value.toDecimalString();
  } catch {
    return null;
  }
}

/** The day of the month a printed due date falls on, or null. */
function dueDayOf(text: string, options: Parameters<typeof readEdgeLine>[1]): number | null {
  const { date } = readEdgeLine({ date: text.trim(), amount: '', description: '' }, options);
  return date ? Number(date.slice(8, 10)) : null;
}

/** A printed annual rate («24.00%», «24,5 %») as a decimal string, within 0–200. */
function rate(text: string): string | null {
  const match = /(\d{1,3})(?:[.,](\d{1,3}))?\s*%?/.exec(text.trim());
  if (!match?.[1]) return null;
  const whole = match[1];
  const fraction = match[2] ?? '0';
  if (Number(whole) > 200) return null;
  return `${whole}.${fraction}`;
}

/** The reader's cut lines, flattened to text before anything reads them. */
function cutLines(
  raw: unknown,
): { edge: string; date: string; amount: string; description: string }[] {
  const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  return (Array.isArray(raw) ? (raw as unknown[]) : []).map((line) => {
    const record = (typeof line === 'object' && line !== null ? line : {}) as {
      readonly edge?: unknown;
      readonly date?: unknown;
      readonly amount?: unknown;
      readonly description?: unknown;
    };
    return {
      edge: asText(record.edge),
      date: asText(record.date),
      amount: asText(record.amount),
      description: asText(record.description),
    };
  });
}
