import 'server-only';

import { getPlatformDb } from '@app/database';
import { cardPrograms } from '@app/database/schema';
import { getServerEnv } from '@app/validation/env';
import { asc } from 'drizzle-orm';

/**
 * Los programas de lealtad de las tarjetas panameñas.
 *
 * ## Por qué es un dato propio y no se deduce
 *
 * Dos Visa Platinum del mismo banco pueden acumular ConnectMiles una y
 * Estrellas la otra. Comparten emisor, red y nivel, y sin embargo «doble millas
 * ConnectMiles este mes» le sirve a una y no a la otra. El nombre de la tarjeta
 * suele decirlo —«Visa ConnectMiles BG»— pero deducirlo de una cadena que
 * escribió la casa sería adivinar, y adivinar sobre plata es lo que este
 * producto no hace.
 *
 * ## Por qué cuelga de un emisor
 *
 * ConnectMiles es de Copa Airlines, no de un banco, y varios bancos panameños
 * lo co-emiten con condiciones propias. Cada par emisor+programa es un producto
 * distinto con la misma moneda de lealtad, y lleva su propia fuente.
 */

export interface CardProgramView {
  readonly issuerKey: string;
  readonly programKey: string;
  readonly name: string;
  /** `miles`, `points`, `cashback`, `discounts`, `other`. */
  readonly kind: string;
  /** Vacío es «en todas»: un programa que no distingue red aplica a todas. */
  readonly networks: readonly string[];
  readonly tiers: readonly string[];
  readonly detail: string | null;
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly capturedOn: string;
}

/** Todo el catálogo, ordenado por emisor y nombre. */
export async function loadCardPrograms(): Promise<readonly CardProgramView[]> {
  const db = getPlatformDb(getServerEnv().DATABASE_URL);

  const rows = await db
    .select()
    .from(cardPrograms)
    .orderBy(asc(cardPrograms.issuerKey), asc(cardPrograms.name));

  return rows.map((row) => ({
    issuerKey: row.issuerKey,
    programKey: row.programKey,
    name: row.name,
    kind: row.kind,
    networks: row.networks,
    tiers: row.tiers,
    detail: row.detail,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    capturedOn: row.capturedOn,
  }));
}

/**
 * El nombre comercial de cada llave de programa.
 *
 * La llave es lo que se guarda y lo que se cruza; el nombre es lo único que
 * una persona reconoce. Se indexa sólo por llave y no por emisor+llave a
 * propósito: `connectmiles` se llama ConnectMiles lo emita quien lo emita, y
 * una tarjeta cuyo emisor todavía no se declaró igual merece que su programa
 * se lea con su nombre.
 */
export async function loadProgramNames(): Promise<ReadonlyMap<string, string>> {
  const programs = await loadCardPrograms();
  return new Map(programs.map((program) => [program.programKey, program.name]));
}

/**
 * De qué tipo es cada programa: `miles`, `points`, `cashback`.
 *
 * Decide si tiene sentido pedirle a la casa el saldo. Un cashback se acredita
 * en el estado de cuenta y ya está contado; unas millas viven en otro lado y
 * nadie las ve al mirar la tarjeta — que es justamente por qué hay que
 * preguntarlas.
 */
export async function loadProgramKinds(): Promise<ReadonlyMap<string, string>> {
  const programs = await loadCardPrograms();
  return new Map(programs.map((program) => [program.programKey, program.kind]));
}
