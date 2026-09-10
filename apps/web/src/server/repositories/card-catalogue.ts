import 'server-only';

import { getPlatformDb } from '@app/database';
import { cardBenefitCatalogue } from '@app/database/schema';
import { getServerEnv } from '@app/validation/env';
import { and, asc, isNull, or, eq, type AnyColumn, type SQL } from 'drizzle-orm';

import type { PlainDate } from '@app/domain';

/**
 * Lo que los emisores de Panamá publicaron, filtrado para una tarjeta concreta.
 *
 * ## Cómo se filtra, y por qué nulo significa «a todas»
 *
 * Una fila con `network = 'visa'` y `tier = 'infinite'` aplica sólo a una Visa
 * Infinite. Una con los tres campos nulos aplica a cualquier tarjeta de ese
 * emisor. Y una con `issuer_key` nulo y `network = 'visa'` aplica a toda Visa,
 * la emita quien la emita — que es exactamente cómo funcionan los beneficios de
 * red frente a los del banco.
 *
 * El filtro es deliberadamente **estrecho**: una fila sólo aparece si cada
 * campo que declara coincide. Enseñar el seguro de una Infinite en una Classic
 * es la forma más rápida de que alguien crea que tiene una cobertura que no
 * tiene, y este catálogo existe justamente para no hacer eso.
 *
 * ## Se lee con la conexión de plataforma
 *
 * No pertenece a ningún hogar: dice lo que un banco publicó. Leerlo con la
 * conexión del usuario funcionaría igual, y usar la de plataforma deja escrito
 * en el código que esto no es dato de nadie.
 */

export interface CatalogueEntry {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly value: string | null;
  readonly program: string | null;
  readonly sourceName: string;
  readonly sourceUrl: string;
  /** Cuándo se leyó. Lo que la pantalla enseña más grande. */
  readonly capturedOn: PlainDate;
  /** Sólo cuando la fuente dio una fecha. */
  readonly validUntil: PlainDate | null;
  /** Sugerencia de este producto, no término del emisor. */
  readonly reviewBy: PlainDate | null;
  readonly notes: string | null;
  /** Verdadero cuando ya pasó la fecha sugerida de reconfirmación. */
  readonly isStale: boolean;
}

export async function loadCatalogueFor(
  card: { issuerKey: string | null; network: string | null; tier: string | null },
  today: PlainDate,
): Promise<readonly CatalogueEntry[]> {
  // Sin red ni emisor no hay nada que filtrar, y devolver el catálogo entero
  // sería enseñarle a una tarjeta los beneficios de otras seis.
  if (!card.issuerKey && !card.network) return [];

  const db = getPlatformDb(getServerEnv().DATABASE_URL);

  /**
   * Un campo coincide si la fila no lo declara, o si lo declara igual.
   *
   * `or` de dos condiciones nunca devuelve indefinido —eso sólo pasa con la
   * lista vacía— así que la alternativa se escribe entera en vez de afirmar
   * que no es nula.
   */
  const matches = (column: AnyColumn, value: string | null): SQL =>
    value === null ? isNull(column) : or(isNull(column), eq(column, value)) ?? isNull(column);

  const rows = await db
    .select()
    .from(cardBenefitCatalogue)
    .where(
      and(
        matches(cardBenefitCatalogue.issuerKey, card.issuerKey),
        matches(cardBenefitCatalogue.network, card.network),
        matches(cardBenefitCatalogue.tier, card.tier),
      ),
    )
    .orderBy(asc(cardBenefitCatalogue.kind), asc(cardBenefitCatalogue.label));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    value: row.value,
    program: row.program,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    capturedOn: row.capturedOn as PlainDate,
    validUntil: (row.validUntil as PlainDate | null) ?? null,
    reviewBy: (row.reviewBy as PlainDate | null) ?? null,
    notes: row.notes,
    // Vencido según la fuente, o pasada la fecha en que este producto sugiere
    // reconfirmar. Las dos se dicen distinto en pantalla.
    isStale:
      (row.validUntil !== null && (row.validUntil as PlainDate) < today) ||
      (row.reviewBy !== null && (row.reviewBy as PlainDate) < today),
  }));
}
