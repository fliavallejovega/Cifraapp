/**
 * Leer una página de promociones de un banco y sacar las ofertas.
 *
 * ## Por qué esto lo hace un modelo, y qué se le permite
 *
 * Una página de promociones no tiene formato: es una parrilla de tarjetas con
 * imágenes, un título por oferta y las condiciones en letra chica, y cada banco
 * la arma distinto y la rehace cada trimestre. Un parser por banco se rompe el
 * mes que alguien mueve un `div`, y mantener ocho parsers es mantener ocho
 * cosas que fallan en silencio.
 *
 * Lo que sí se le exige al modelo es lo mismo que a cualquier otra cosa en este
 * producto: **salida estructurada, catálogo cerrado, y nada que se presente
 * como confirmado**. Extrae filas con campos declarados de antemano; lo que no
 * encaje se descarta aquí, no en la pantalla; y todo lo que sobreviva entra
 * como `unverified`, que la pantalla enseña con esas palabras.
 *
 * El modelo no decide si una promoción es buena, no la compara con otra y no
 * toca ninguna cifra del hogar. Lee texto público y lo ordena.
 *
 * ## Lo que se descarta, y por qué
 *
 * Sin comercio no hay promoción: «descuentos en tus comercios favoritos» es
 * publicidad, no una oferta que alguien pueda usar el martes. Sin titular
 * tampoco. Y una fecha de fin anterior a la de lectura es una promoción que ya
 * pasó — se guarda vencida, no se tira, porque saber qué daba el banco el mes
 * pasado ayuda a leer lo que da este.
 */

/** Las categorías que la base acepta. Copiarlas mal es una fila rechazada. */
export const PROMOTION_CATEGORIES = [
  'restaurantes',
  'supermercados',
  'combustible',
  'farmacias',
  'viajes',
  'entretenimiento',
  'tecnologia',
  'salud',
  'otros',
] as const;

export type PromotionCategory = (typeof PROMOTION_CATEGORIES)[number];

export const CARD_TYPES = ['credit', 'debit'] as const;
export const PROMOTION_NETWORKS = ['visa', 'mastercard', 'amex'] as const;

export interface ExtractedPromotion {
  readonly merchantName: string;
  readonly merchantNote: string | null;
  readonly category: PromotionCategory;
  readonly headline: string;
  readonly detail: string | null;
  readonly networks: readonly string[];
  readonly cardTypes: readonly string[];
  readonly weekdays: readonly number[];
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly channel: string | null;
}

export interface ExtractionReading {
  readonly accepted: readonly ExtractedPromotion[];
  /** Lo que se descartó y por qué. Un rechazo callado no se arregla nunca. */
  readonly rejected: readonly { readonly raw: string; readonly reason: string }[];
}

const DAYS: Readonly<Record<string, number>> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
  domingo: 7,
};

/**
 * Los días que una frase nombra, en ISO.
 *
 * «Todos los martes de septiembre» son los martes. Una frase que no nombra
 * ningún día devuelve la lista vacía, que la base lee como «todos los días» —
 * y esa es la lectura correcta: una promoción que no restringe días no los
 * restringe.
 */
export function readWeekdays(text: string): number[] {
  const found = new Set<number>();
  const lower = text.toLowerCase();

  for (const [name, day] of Object.entries(DAYS)) {
    if (lower.includes(name)) found.add(day);
  }

  return [...found].sort((a, b) => a - b);
}

/** Una fecha `AAAA-MM-DD` válida, o nulo. Nunca una inventada. */
export function readIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;

  const [year, month, day] = trimmed.split('-').map(Number);
  if (!year || !month || !day) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Un 31 de febrero en la página de un banco es una página mal escrita, no una
  // fecha que este código deba propagar.
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? trimmed : null;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function list(value: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((one) => (typeof one === 'string' ? one.trim().toLowerCase() : ''))
        .filter((one) => allowed.includes(one)),
    ),
  ];
}

/**
 * Valida lo que el modelo devolvió, sin él.
 *
 * Todo lo que decide si una fila entra está aquí, en código determinista. El
 * modelo propone; esta función es la que dice que sí.
 */
export function readPromotions(rows: readonly unknown[], capturedOn: string): ExtractionReading {
  const accepted: ExtractedPromotion[] = [];
  const rejected: { raw: string; reason: string }[] = [];

  for (const row of rows.slice(0, 40)) {
    if (typeof row !== 'object' || row === null) {
      rejected.push({ raw: String(row), reason: 'No es una fila.' });
      continue;
    }

    const record = row as Record<string, unknown>;
    const merchantName = text(record['merchantName'], 160);
    const headline = text(record['headline'], 160);
    const raw = `${merchantName} · ${headline}`;

    // Sin comercio no hay promoción: «descuentos en tus comercios favoritos» es
    // publicidad, no algo que alguien pueda usar el martes.
    if (merchantName.length < 2) {
      rejected.push({ raw, reason: 'Sin comercio nombrado.' });
      continue;
    }
    if (headline.length < 3) {
      rejected.push({ raw, reason: 'Sin titular que diga qué dan.' });
      continue;
    }

    const category = text(record['category'], 40).toLowerCase();
    const detail = text(record['detail'], 600);

    accepted.push({
      merchantName,
      merchantNote: text(record['merchantNote'], 200) || null,
      // Fuera del catálogo cae en «otros» en vez de rechazarse: la promoción es
      // real aunque el modelo se equivoque de cajón.
      category: (PROMOTION_CATEGORIES as readonly string[]).includes(category)
        ? (category as PromotionCategory)
        : 'otros',
      headline,
      detail: detail || null,
      networks: list(record['networks'], PROMOTION_NETWORKS),
      cardTypes: list(record['cardTypes'], CARD_TYPES),
      // Los días se releen del texto y no se aceptan del modelo: es la clase de
      // dato que decide si alguien maneja hasta un restaurante para nada.
      weekdays: readWeekdays(`${headline} ${detail}`),
      validFrom: readIsoDate(record['validFrom']),
      validUntil: readIsoDate(record['validUntil']),
      channel: text(record['channel'], 200) || null,
    });
  }

  // `capturedOn` viaja para que quien llame no tenga que recordar estamparlo.
  void capturedOn;

  return { accepted, rejected };
}
