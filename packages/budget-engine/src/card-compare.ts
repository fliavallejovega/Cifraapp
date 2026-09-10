import type { PlainDate } from '@app/domain';

/**
 * Cuál de tus tarjetas conviene aquí.
 *
 * Es la pregunta que una casa con tres tarjetas se hace en la caja del
 * supermercado, y la que ninguna aplicación contesta porque contestarla exige
 * dos cosas a la vez: saber qué da cada tarjeta y saber qué se está comprando.
 *
 * ## Lo que ordena, y lo que se niega a ordenar
 *
 * Ordena por **lo que la fuente dijo**, no por una estimación. Una tarjeta con
 * «5% en supermercados» va delante de una con «1%», y las dos van delante de
 * una sin dato — pero una sin dato **no** cae al final como si diera cero: cae
 * a un grupo aparte que dice «no se sabe». La diferencia importa porque la
 * mayoría de las tarjetas de una casa no tienen su beneficio cargado todavía, y
 * enterrarlas como perdedoras sería inventar una comparación.
 *
 * ## Por qué el porcentaje se lee del texto y no se guarda aparte
 *
 * Porque un beneficio real casi nunca es un número limpio: «3% hasta $200 al
 * mes en comercios afiliados». Guardar sólo el 3 tiraría el tope, que es la
 * mitad de lo que decide si conviene. Se guarda la frase entera y se le extrae
 * la cifra sólo para ordenar; lo que la pantalla enseña es la frase.
 */

export type SpendCategory =
  | 'restaurantes'
  | 'supermercados'
  | 'combustible'
  | 'farmacias'
  | 'viajes'
  | 'entretenimiento'
  | 'tecnologia'
  | 'salud'
  | 'otros';

/** Lo que una tarjeta ofrece en una categoría, según lo que haya cargado. */
export interface CardOffer {
  readonly cardId: string;
  readonly cardName: string;
  readonly issuerName: string | null;
  readonly network: string | null;
  /** La frase tal como la fuente la escribió. Es lo que se enseña. */
  readonly headline: string;
  readonly detail: string | null;
  /** De qué tipo es: devolución, millas, descuento puntual. */
  readonly kind: string;
  /** Verdadero cuando lo confirmó una persona; falso si lo leyó el barrido. */
  readonly isVerified: boolean;
  /** Cuándo se leyó la fuente. Una condición de hace ocho meses es una pista. */
  readonly capturedOn: PlainDate;
  readonly validUntil: PlainDate | null;
  readonly isOwned: boolean;
}

export interface RankedOffer extends CardOffer {
  /** El porcentaje que se pudo leer de la frase, para ordenar. Nulo si no hay. */
  readonly rate: number | null;
  readonly position: number;
  /** Por qué quedó donde quedó, en palabras que la pantalla puede enseñar. */
  readonly reason: 'rate' | 'unquantified' | 'expired';
}

export interface ComparisonResult {
  readonly category: SpendCategory;
  /** Las que se pudieron ordenar por su cifra, de la mejor a la peor. */
  readonly ranked: readonly RankedOffer[];
  /**
   * Las que dicen algo pero sin cifra comparable, y las vencidas.
   *
   * Aparte y no al final de la lista: una tarjeta cuyo beneficio nadie cargó no
   * es una tarjeta que dé cero, y ponerla debajo de la que da 1% afirmaría algo
   * que nadie sabe.
   */
  readonly unquantified: readonly RankedOffer[];
  readonly expired: readonly RankedOffer[];
  /** La mejor, sólo cuando hay una cifra que lo sostenga. */
  readonly best: RankedOffer | null;
  /** Verdadero cuando ninguna tarjeta tenía nada que decir en esta categoría. */
  readonly isEmpty: boolean;
}

/**
 * El porcentaje que una frase declara, o nulo.
 *
 * Lee «5%», «5 %», «hasta 7%» y «2x1» —que es un 50%— y se niega ante todo lo
 * demás. Deliberadamente literal: adivinar que «millas dobles» equivale a un
 * porcentaje exigiría saber cuánto vale una milla, que depende de a dónde vuele
 * la persona y no de este código.
 */
export function readRate(text: string): number | null {
  // Un 2x1 es medio precio, y es la forma más común de promoción en Panamá.
  if (/\b2\s*x\s*1\b/i.test(text)) return 50;

  const match = /(\d{1,3}(?:[.,]\d{1,2})?)\s*%/.exec(text);
  if (!match?.[1]) return null;

  const value = Number(match[1].replace(',', '.'));
  // Por encima de 100 no es un descuento, es otra cosa leída mal.
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : null;
}

export function compareCards(
  offers: readonly CardOffer[],
  category: SpendCategory,
  today: PlainDate,
): ComparisonResult {
  const scored: RankedOffer[] = offers.map((offer) => {
    const expired = offer.validUntil !== null && offer.validUntil < today;
    const rate = readRate(`${offer.headline} ${offer.detail ?? ''}`);

    return {
      ...offer,
      rate,
      position: 0,
      reason: expired ? 'expired' : rate === null ? 'unquantified' : 'rate',
    };
  });

  const expired = scored.filter((offer) => offer.reason === 'expired');
  const unquantified = scored.filter((offer) => offer.reason === 'unquantified');

  const ranked = scored
    .filter((offer) => offer.reason === 'rate')
    .sort((a, b) => {
      const byRate = (b.rate ?? 0) - (a.rate ?? 0);
      if (byRate !== 0) return byRate;
      // A igual cifra manda lo confirmado por una persona sobre lo que leyó el
      // barrido: entre dos promesas iguales, gana la que alguien comprobó.
      if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
      // Y después, la que la casa ya tiene: no hace falta abrir una cuenta.
      if (a.isOwned !== b.isOwned) return a.isOwned ? -1 : 1;
      return a.cardName.localeCompare(b.cardName);
    })
    .map((offer, at) => ({ ...offer, position: at + 1 }));

  return {
    category,
    ranked,
    unquantified,
    expired,
    // Sólo hay «mejor» cuando una cifra lo sostiene. Coronar a la única tarjeta
    // que alguien cargó sería premiar el haberla cargado.
    best: ranked[0] ?? null,
    isEmpty: offers.length === 0,
  };
}
