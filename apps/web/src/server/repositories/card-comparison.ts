import 'server-only';

import { getPlatformDb } from '@app/database';
import { cardPromotions } from '@app/database/schema';
import { compareCards, type CardOffer, type ComparisonResult, type SpendCategory } from '@app/budget-engine';
import { type PlainDate } from '@app/domain';
import { getServerEnv } from '@app/validation/env';
import { sql } from 'drizzle-orm';

/**
 * El comparativo, por categoría, sobre lo que hay cargado.
 *
 * Junta dos cosas que hasta ahora vivían separadas: lo que **la casa anotó** de
 * sus propias tarjetas —leído de su contrato, lo más confiable que hay— y lo
 * que **el mercado ofrece** este mes, incluidas las tarjetas de bancos donde no
 * tiene cuenta.
 *
 * Las dos entran a la misma comparación porque responden la misma pregunta. Lo
 * que las distingue en pantalla es de dónde salió cada una y si alguien la
 * confirmó, no en qué lista aparecen.
 */

export const COMPARE_CATEGORIES: readonly SpendCategory[] = [
  'restaurantes',
  'supermercados',
  'combustible',
  'farmacias',
  'viajes',
  'entretenimiento',
  'tecnologia',
  'salud',
  'otros',
];

export interface OwnBenefit {
  readonly cardId: string;
  readonly cardName: string;
  readonly issuerName: string | null;
  readonly kind: string;
  readonly label: string;
  readonly value: string | null;
  readonly capturedOn: PlainDate;
  readonly expiresOn: PlainDate | null;
}

/**
 * Compara, categoría por categoría.
 *
 * La categoría de un beneficio propio se deduce de su texto, y sólo cuando el
 * texto la nombra: «3% en supermercados» es de supermercados, «1% en todo» cae
 * en `otros`. Repartir un beneficio genérico por las nueve categorías lo haría
 * ganar todas por el mero hecho de ser vago.
 */
export async function compareByCategory(
  own: readonly OwnBenefit[],
  today: PlainDate,
): Promise<Readonly<Record<string, ComparisonResult>>> {
  const db = getPlatformDb(getServerEnv().DATABASE_URL);

  const promos = await db
    .select()
    .from(cardPromotions)
    .where(sql`${cardPromotions.status} in ('verified', 'unverified')`);

  const result: Record<string, ComparisonResult> = {};

  for (const category of COMPARE_CATEGORIES) {
    const fromOwn: CardOffer[] = own
      .filter((benefit) => categoryOf(`${benefit.label} ${benefit.value ?? ''}`) === category)
      .map((benefit) => ({
        cardId: benefit.cardId,
        cardName: benefit.cardName,
        issuerName: benefit.issuerName,
        network: null,
        headline: benefit.label,
        detail: benefit.value,
        kind: benefit.kind,
        // Lo que la casa anotó de su contrato es lo más confiable que hay aquí.
        isVerified: true,
        capturedOn: benefit.capturedOn,
        validUntil: benefit.expiresOn,
        isOwned: true,
      }));

    const fromMarket: CardOffer[] = promos
      .filter((promo) => promo.category === category)
      .map((promo) => ({
        cardId: promo.id,
        cardName: `${promo.issuerName} · ${promo.merchantName}`,
        issuerName: promo.issuerName,
        network: promo.networks[0] ?? null,
        headline: promo.headline,
        detail: promo.detail,
        kind: 'discount',
        isVerified: promo.status === 'verified',
        capturedOn: promo.capturedOn as PlainDate,
        validUntil: (promo.validUntil as PlainDate | null) ?? null,
        // Del mercado: puede ser de un banco donde la casa no tiene cuenta.
        isOwned: false,
      }));

    result[category] = compareCards([...fromOwn, ...fromMarket], category, today);
  }

  return result;
}

/**
 * En qué categoría cae un beneficio, según lo que su texto nombra.
 *
 * Deliberadamente conservador: lo que no nombra una categoría cae en `otros` en
 * vez de repartirse por todas. Un «1% en todo» que apareciera primero en las
 * nueve ganaría por vago, y la comparación dejaría de servir justo donde más
 * hace falta.
 */
export function categoryOf(text: string): SpendCategory {
  const lower = text.toLowerCase();

  if (/supermercad|abarrot|super\b/.test(lower)) return 'supermercados';
  if (/restaurant|comida|gastron|fonda|cafeter/.test(lower)) return 'restaurantes';
  if (/gasolin|combustib|estación de servicio/.test(lower)) return 'combustible';
  if (/farmac|botica/.test(lower)) return 'farmacias';
  if (/viaje|milla|aéreo|aereo|hotel|equipaje|sala vip|lounge|alquiler de veh|alquiler de auto/.test(lower))
    return 'viajes';
  if (/cine|entreten|concierto|streaming/.test(lower)) return 'entretenimiento';
  if (/tecnolog|electrónic|electronic|billetera digital|app\b/.test(lower)) return 'tecnologia';
  if (/salud|médic|medic|clínic|clinic|hospital/.test(lower)) return 'salud';

  return 'otros';
}
