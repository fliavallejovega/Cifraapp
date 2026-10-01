import 'server-only';

import { getPlatformDb } from '@app/database';
import {
  cardBenefitCatalogue,
  cardPromotions,
  catalogueRefreshRuns,
  catalogueSources,
} from '@app/database/schema';
import { flatten } from '@app/transaction-engine';
import { todayIn } from '@app/domain';
import { getServerEnv } from '@app/validation/env';
import { eq, sql } from 'drizzle-orm';

import { decideRefresh } from './catalogue-refresh';
import { readPromotions } from './promotion-extract';

/**
 * El barrido mensual del catálogo.
 *
 * Corre una vez al mes y hace dos cosas distintas con la misma descarga:
 *
 * 1. **Compara la huella** de cada fuente contra la guardada. Si la página se
 *    movió, las filas que salieron de ahí quedan marcadas por revisar y la
 *    pantalla lo dice al lado de cada una. El dato **no se toca**: reinterpretar
 *    una página automáticamente y pisar lo que había es como se mete una cifra
 *    inventada en un producto financiero.
 *
 * 2. **Extrae promociones** de las páginas de promociones, que son las que
 *    cambian cada mes por diseño. Eso sí entra solo, porque una oferta que nadie
 *    sube es una oferta que nadie usa — pero entra como `unverified`, con su
 *    fuente y su fecha, y la pantalla la enseña marcada.
 *
 * La diferencia entre las dos no es de implementación: es de qué se está
 * afirmando. Una condición del contrato dura años y merece que la confirme una
 * persona. Una promoción del mes dura semanas, y esperar a que alguien la
 * confirme es garantizar que se enseñe cuando ya venció.
 *
 * ## Por qué no hay reintentos ni paralelismo
 *
 * Trece fuentes una vez al mes. Descargarlas en serie cuesta segundos y no
 * arriesga que un banco vea trece peticiones simultáneas desde la misma
 * dirección. Una que falla queda registrada con su motivo y se reintenta el mes
 * que viene, que para un dato que cambia trimestralmente es a tiempo.
 */

export interface RefreshResult {
  readonly checked: number;
  readonly changed: number;
  readonly failed: number;
  readonly promotionsFound: number;
  readonly promotionsRejected: number;
}

/** Cuánto texto se le da al modelo. Una página entera es sobre todo menú. */
const MAX_PAGE_CHARS = 24_000;

const FETCH_TIMEOUT_MS = 20_000;

export async function refreshCatalogue(): Promise<RefreshResult> {
  const db = getPlatformDb(getServerEnv().DATABASE_URL);
  const today = todayIn('America/Panama');

  const [run] = await db.insert(catalogueRefreshRuns).values({}).returning({ id: catalogueRefreshRuns.id });

  const sources = await db.select().from(catalogueSources);

  let checked = 0;
  let changed = 0;
  let failed = 0;
  let promotionsFound = 0;
  let promotionsRejected = 0;

  for (const source of sources) {
    checked += 1;

    let body: string;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, FETCH_TIMEOUT_MS);

      const response = await fetch(source.url, {
        signal: controller.signal,
        headers: {
          /*
            Un agente honesto. Un barrido mensual que se disfraza de navegador
            es un barrido que alguien va a bloquear con razón.

            Y además funciona mejor. baccredomatic.com cuelga la conexión —cero
            bytes, sin código de estado— cuando recibe una cabecera de Chrome, y
            responde normal sin ella. Cuatro de sus páginas se dieron por muertas
            durante una auditoría porque se leyeron con user-agent de navegador;
            estaban vivas todas. Disfrazarse no es sólo deshonesto: es frágil.
          */
          'user-agent': 'Cifraapp/1.0 (catálogo de tarjetas de Panamá; contacto vía cifraapp)',
          accept: 'text/html,application/xhtml+xml',
        },
      });
      clearTimeout(timer);

      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      body = await response.text();
    } catch (cause) {
      failed += 1;
      await db
        .update(catalogueSources)
        .set({
          lastStatus: 'unreachable',
          lastError: cause instanceof Error ? cause.message.slice(0, 200) : 'unknown',
          fetchedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(catalogueSources.id, source.id));
      continue;
    }

    const readable = flatten(body).slice(0, MAX_PAGE_CHARS);
    // Todo lo que se decide aquí vive en `catalogue-refresh.ts`, en funciones
    // puras: un barrido que sólo se puede probar levantando trece sitios de
    // bancos es un barrido que nadie prueba.
    const decision = decideRefresh(readable, source.contentHash, source.kind as never);
    const { hash, moved } = decision;

    if (moved) changed += 1;

    await db
      .update(catalogueSources)
      .set({
        contentHash: hash,
        fetchedAt: new Date(),
        lastStatus: decision.status,
        lastError: null,
        needsReview: decision.needsReview,
        updatedAt: new Date(),
      })
      .where(eq(catalogueSources.id, source.id));

    if (moved && source.kind !== 'promotions') {
      // Las filas que salieron de esta página quedan señaladas. No se borran ni
      // se cambian: siguen siendo lo que la fuente decía cuando se leyó, que es
      // exactamente lo que `captured_on` promete.
      await db
        .update(cardBenefitCatalogue)
        .set({ notes: sql`coalesce(${cardBenefitCatalogue.notes} || ' ', '') || '⚠ La página de la fuente cambió desde esta lectura.'` })
        .where(eq(cardBenefitCatalogue.sourceId, source.id));
    }

    if (source.kind === 'promotions') {
      const outcome = await extractInto(db, source, readable, today);
      promotionsFound += outcome.found;
      promotionsRejected += outcome.rejected;
    }
  }

  // Lo que venció desde el último barrido, marcado. Una promoción de julio en
  // la pantalla de septiembre es peor que no tener pantalla.
  await db
    .update(cardPromotions)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(sql`${cardPromotions.validUntil} is not null and ${cardPromotions.validUntil} < ${today} and ${cardPromotions.status} in ('verified','unverified')`);

  if (run) {
    await db
      .update(catalogueRefreshRuns)
      .set({
        finishedAt: new Date(),
        sourcesChecked: checked,
        sourcesChanged: changed,
        sourcesFailed: failed,
        notes: `${String(promotionsFound)} promociones leídas, ${String(promotionsRejected)} descartadas.`,
      })
      .where(eq(catalogueRefreshRuns.id, run.id));
  }

  return { checked, changed, failed, promotionsFound, promotionsRejected };
}

type PlatformDb = ReturnType<typeof getPlatformDb>;

/**
 * Extrae las promociones de una página y las sube sin confirmar.
 *
 * Sin clave de modelo no hace nada y lo dice devolviendo cero: el barrido de
 * huellas sigue sirviendo, y fingir que se extrajo algo sería peor que no
 * extraer.
 */
async function extractInto(
  db: PlatformDb,
  source: typeof catalogueSources.$inferSelect,
  readable: string,
  today: string,
): Promise<{ found: number; rejected: number }> {
  const env = getServerEnv();
  const key = env.AI_PROVIDER === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  if (!key) return { found: 0, rejected: 0 };

  const rows = await askForPromotions(readable, source.name);
  const reading = readPromotions(rows, today);

  for (const promo of reading.accepted) {
    /**
     * Una promoción por comercio y por titular y por fuente.
     *
     * Sin esto, doce barridos dejarían doce copias de la misma oferta de
     * Fosters. Con esto, el barrido de octubre actualiza la de septiembre y la
     * pantalla sigue teniendo una fila por oferta.
     *
     * Lo confirmado por una persona no se pisa: `where status <> 'verified'`.
     */
    await db
      .insert(cardPromotions)
      .values({
        issuerKey: source.issuerKey ?? 'desconocido',
        issuerName: source.name.split('·')[0]?.trim() ?? source.name,
        networks: [...promo.networks],
        cardTypes: [...promo.cardTypes],
        merchantName: promo.merchantName,
        merchantNote: promo.merchantNote,
        category: promo.category,
        headline: promo.headline,
        detail: promo.detail,
        weekdays: [...promo.weekdays],
        validFrom: promo.validFrom,
        validUntil: promo.validUntil,
        channel: promo.channel,
        sourceName: source.name,
        sourceUrl: source.url,
        sourceId: source.id,
        capturedOn: today,
        status: 'unverified',
      })
      .onConflictDoNothing();
  }

  return { found: reading.accepted.length, rejected: reading.rejected.length };
}

/**
 * La llamada al modelo.
 *
 * Va por `fetch` contra el mismo endpoint que usa `@app/ai`, y no por `invoke`,
 * por una razón concreta: `invoke` exige `grounding` y guardarraíles de cifras
 * porque su trabajo es explicar los números de un hogar sin inventarlos. Aquí no
 * hay hogar ni cifras propias — hay una página pública que se está ordenando— y
 * el guardarraíl que corresponde es el otro: el catálogo cerrado de
 * `readPromotions`, que corre después y sin el modelo.
 */
async function askForPromotions(page: string, sourceName: string): Promise<unknown[]> {
  const env = getServerEnv();
  const anthropic = env.AI_PROVIDER === 'anthropic' && Boolean(env.ANTHROPIC_API_KEY);

  const instruction = [
    'Del texto de esta página de promociones bancarias de Panamá, extrae cada oferta.',
    '',
    'Devuelve un arreglo JSON. Un objeto por oferta, con estos campos:',
    '  merchantName  el comercio, tal como la página lo nombra',
    '  merchantNote  sucursales o condiciones del local, si las dice',
    '  category      restaurantes|supermercados|combustible|farmacias|viajes|',
    '                entretenimiento|tecnologia|salud|otros',
    '  headline      qué dan, en pocas palabras: «50% de descuento», «2x1»',
    '  detail        las condiciones, tal como aparecen',
    '  networks      visa, mastercard o amex, si la página lo dice',
    '  cardTypes     credit, debit, o los dos',
    '  validFrom     AAAA-MM-DD, sólo si la página da la fecha',
    '  validUntil    AAAA-MM-DD, sólo si la página da la fecha',
    '  channel       «sólo en el local», «sólo por la app», si lo dice',
    '',
    'Reglas:',
    '- No inventes fechas, comercios ni porcentajes. Lo que la página no diga, déjalo nulo.',
    '- Una oferta sin comercio nombrado no es una oferta: no la incluyas.',
    '- No opines sobre si conviene. Sólo ordena lo que la página dice.',
    '- Responde únicamente con el arreglo JSON.',
  ].join('\n');

  const body = anthropic
    ? {
        model: env.AI_MODEL ?? 'claude-sonnet-5',
        max_tokens: 4000,
        temperature: 0,
        system: instruction,
        messages: [{ role: 'user', content: `Página: ${sourceName}\n\n${page}` }],
      }
    : {
        model: env.AI_MODEL ?? 'gpt-4o-mini',
        temperature: 0,
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: `Página: ${sourceName}\n\n${page}` },
        ],
      };

  try {
    const response = await fetch(
      anthropic ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: anthropic
          ? {
              'content-type': 'application/json',
              'x-api-key': env.ANTHROPIC_API_KEY ?? '',
              'anthropic-version': '2023-06-01',
            }
          : {
              'content-type': 'application/json',
              authorization: `Bearer ${env.OPENAI_API_KEY ?? ''}`,
            },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) return [];

    const payload: unknown = await response.json();
    const raw = readText(payload, anthropic);
    if (!raw) return [];

    // El modelo a veces envuelve el arreglo en prosa o en un bloque de código.
    // Se recorta al primer `[` y al último `]`; lo que no parsee se descarta.
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start < 0 || end <= start) return [];

    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    // `readPromotions` valida cada fila; aquí sólo hace falta que sea una lista.
    return Array.isArray(parsed) ? (parsed as unknown[]) : [];
  } catch {
    // Una extracción que falla no puede tumbar el barrido de huellas, que es la
    // mitad que sirve aunque no haya modelo.
    return [];
  }
}

function readText(payload: unknown, anthropic: boolean): string | null {
  if (typeof payload !== 'object' || payload === null) return null;

  if (anthropic) {
    const content: unknown = (payload as { content?: unknown }).content;
    if (!Array.isArray(content)) return null;
    const block: unknown = (content as unknown[]).find(
      (one) =>
        typeof one === 'object' && one !== null && (one as { type?: unknown }).type === 'text',
    );
    const value: unknown = (block as { text?: unknown } | undefined)?.text;
    return typeof value === 'string' ? value : null;
  }

  const choices: unknown = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const first: unknown = choices[0];
  const message: unknown = (first as { message?: { content?: unknown } } | undefined)?.message
    ?.content;
  return typeof message === 'string' ? message : null;
}
