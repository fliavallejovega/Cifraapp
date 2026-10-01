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
 * ## El programa cuenta, y por meses no contó
 *
 * Una Visa ConnectMiles y una Visa Estrellas del mismo banco, la misma red y el
 * mismo nivel acumulan cosas distintas. La columna `program` estaba cargada y
 * este filtro la ignoraba, así que a una ConnectMiles se le ofrecían Estrellas
 * y CashBack — tres programas incompatibles presentados como si los tuviera los
 * tres. Un sistema que sabe qué tarjeta es y aun así pregunta cuál de seis
 * programas ajenos es el suyo no está usando lo que sabe.
 *
 * ## Y lo que describe el mercado no se ofrece como propio
 *
 * «La anualidad más baja es US$84 en Davivienda» es un dato sobre otro banco.
 * Sale aparte, sin botón para adoptarlo, porque no es de nadie.
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
  /**
   * Verdadero cuando otra publicación del mismo emisor dice algo distinto.
   *
   * La página de producto de Credicorp anuncia «3 puntos x $1.00»; su propio
   * reglamento dice «1.25». Este producto no elige: enseña las dos y dice cuál
   * documento es cuál, porque una casa que ve el conflicto sabe qué preguntar y
   * una que ve sólo un lado cree que sabe algo que no sabe.
   */
  readonly isDisputed: boolean;
  readonly disputeNote: string | null;
  readonly disputeSourceUrl: string | null;
  /** Verdadero cuando ya pasó la fecha sugerida de reconfirmación. */
  readonly isStale: boolean;
}

export interface CatalogueForCard {
  /** Lo que este banco y esta red publican para una tarjeta como la tuya. */
  readonly benefits: readonly CatalogueEntry[];
  /** Cómo se compara con el resto del mercado. No se adopta: se lee. */
  readonly marketReferences: readonly CatalogueEntry[];
}

export async function loadCatalogueFor(
  card: {
    issuerKey: string | null;
    network: string | null;
    tier: string | null;
    /** La llave del programa declarado, o nulo cuando la casa no lo dijo. */
    program: string | null;
  },
  today: PlainDate,
): Promise<CatalogueForCard> {
  // Sin red ni emisor no hay nada que filtrar, y devolver el catálogo entero
  // sería enseñarle a una tarjeta los beneficios de otras seis.
  if (!card.issuerKey && !card.network) return { benefits: [], marketReferences: [] };

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
        /*
          El programa. Una fila que nombra uno sólo aplica a una tarjeta que
          declaró ese mismo; una que no lo nombra aplica igual.

          Y si la tarjeta todavía no declaró el suyo, las filas con programa
          quedan fuera: enseñarlas todas afirmaría que tiene los tres, que es
          justo lo que este filtro existe para no hacer. La pantalla lo dice y
          ofrece declararlo.
        */
        matches(cardBenefitCatalogue.programKey, card.program),
      ),
    )
    .orderBy(asc(cardBenefitCatalogue.kind), asc(cardBenefitCatalogue.label));

  const entries = rows.map((row) => ({
    isMarketReference: row.isMarketReference,
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
    isDisputed: row.isDisputed,
    disputeNote: row.disputeNote,
    disputeSourceUrl: row.disputeSourceUrl,
    // Vencido según la fuente, o pasada la fecha en que este producto sugiere
    // reconfirmar. Las dos se dicen distinto en pantalla.
    isStale:
      (row.validUntil !== null && (row.validUntil as PlainDate) < today) ||
      (row.reviewBy !== null && (row.reviewBy as PlainDate) < today),
  }));

  return {
    benefits: entries.filter((entry) => !entry.isMarketReference),
    marketReferences: entries.filter((entry) => entry.isMarketReference),
  };
}
