import { createHash } from 'node:crypto';

/**
 * Las decisiones del barrido, separadas de la red y de la base.
 *
 * Todo lo que el barrido decide —si una página cambió, si eso obliga a una
 * revisión humana, si una promoción venció— está aquí, en funciones puras. Lo
 * que queda en `refresh.ts` es descargar y escribir.
 *
 * La separación no es estética. Un barrido que sólo se puede probar levantando
 * trece sitios de bancos es un barrido que nadie prueba, y esta es exactamente
 * la clase de código donde un error se manifiesta como «el catálogo dejó de
 * avisar» — un fallo silencioso que nadie nota hasta que un dato lleva medio
 * año podrido.
 */

/**
 * La huella de una página, sacada de su texto legible.
 *
 * Del texto y no del HTML crudo a propósito: un banco que cambia una clase de
 * CSS o el orden de dos `div` no cambió sus condiciones, y marcarlo como
 * movimiento llenaría la lista de revisiones falsas hasta que nadie la mire.
 */
export function fingerprint(readable: string): string {
  return createHash('sha256').update(readable.trim().replace(/\s+/g, ' ')).digest('hex');
}

export type SourceKind = 'issuer' | 'regulator' | 'network' | 'third_party' | 'promotions';

export interface RefreshDecision {
  readonly hash: string;
  /** Verdadero cuando la página se movió desde la última lectura. */
  readonly moved: boolean;
  /**
   * Verdadero cuando ese movimiento obliga a que una persona reconfirme.
   *
   * Sólo las fuentes de condiciones. Las de promociones cambian cada mes por
   * diseño y el barrido las vuelve a extraer solo: pedir revisión humana por
   * cada una sería pedirla doce veces al año para nada.
   */
  readonly needsReview: boolean;
  readonly status: 'ok' | 'changed';
}

export function decideRefresh(
  readable: string,
  previousHash: string | null,
  kind: SourceKind,
): RefreshDecision {
  const hash = fingerprint(readable);
  // Una fuente que nunca se leyó no «cambió»: se leyó por primera vez. Marcarla
  // como movida pediría revisar cada fuente el primer mes, que es el mes en que
  // menos falta hace.
  const moved = previousHash !== null && previousHash !== hash;

  return {
    hash,
    moved,
    needsReview: moved && kind !== 'promotions',
    status: moved ? 'changed' : 'ok',
  };
}

/**
 * Si una promoción ya pasó, según su propia fecha de fin.
 *
 * Sin fecha nunca vence: una promoción que el banco publica sin fin es una que
 * sigue viva hasta que la quite, y darle un vencimiento inventado la borraría
 * de la pantalla mientras el comercio la sigue honrando.
 */
export function hasExpired(validUntil: string | null, today: string): boolean {
  return validUntil !== null && validUntil < today;
}
