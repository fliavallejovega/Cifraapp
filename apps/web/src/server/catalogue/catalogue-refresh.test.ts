import { describe, expect, it } from 'vitest';

import { decideRefresh, fingerprint, hasExpired } from './catalogue-refresh';

/**
 * El barrido mensual: qué decide mirar y qué se niega a tocar.
 *
 * Lo que se prueba aquí es lo único que el barrido decide por su cuenta. El
 * resto —descargar y escribir— no toma decisiones, y probarlo exigiría levantar
 * trece sitios de bancos.
 */

describe('la huella de una página', () => {
  it('ignora los cambios de maquetación', () => {
    // Un banco que reindenta su HTML o mete un salto de línea no cambió sus
    // condiciones, y marcarlo llenaría la lista de revisiones falsas hasta que
    // nadie la mire.
    const antes = 'Programa Estrellas   1 estrella por cada US$1';
    const despues = 'Programa Estrellas 1 estrella por cada US$1';

    expect(fingerprint(antes)).toBe(fingerprint(despues));
  });

  it('nota un cambio de condiciones', () => {
    const antes = '1 estrella por cada US$1 de compra';
    const despues = '1 estrella por cada US$2 de compra';

    expect(fingerprint(antes)).not.toBe(fingerprint(despues));
  });
});

describe('qué hace el barrido cuando una fuente se mueve', () => {
  it('la primera lectura no es un cambio', () => {
    // Marcar como movida una fuente que nunca se leyó pediría revisar las
    // treinta y dos el primer mes, que es el mes en que menos falta hace.
    const decision = decideRefresh('lo que sea', null, 'issuer');

    expect(decision.moved).toBe(false);
    expect(decision.needsReview).toBe(false);
    expect(decision.status).toBe('ok');
  });

  it('una página de condiciones que cambió pide revisión humana', () => {
    const decision = decideRefresh('condiciones nuevas', fingerprint('condiciones viejas'), 'issuer');

    expect(decision.moved).toBe(true);
    expect(decision.needsReview).toBe(true);
    expect(decision.status).toBe('changed');
  });

  it('una de promociones que cambió NO la pide', () => {
    // Cambian cada mes por diseño y el barrido las vuelve a extraer solo:
    // pedir revisión por cada una sería pedirla doce veces al año para nada.
    const decision = decideRefresh('promos de octubre', fingerprint('promos de septiembre'), 'promotions');

    expect(decision.moved).toBe(true);
    expect(decision.needsReview).toBe(false);
  });

  it('lo mismo vale para el regulador y la red', () => {
    for (const kind of ['regulator', 'network', 'third_party'] as const) {
      expect(decideRefresh('nuevo', fingerprint('viejo'), kind).needsReview).toBe(true);
    }
  });

  it('una página que no se movió no pide nada', () => {
    const readable = 'las mismas condiciones de siempre';
    const decision = decideRefresh(readable, fingerprint(readable), 'issuer');

    expect(decision.moved).toBe(false);
    expect(decision.needsReview).toBe(false);
    expect(decision.status).toBe('ok');
  });
});

describe('cuándo vence una promoción', () => {
  it('vence el día después de su última fecha', () => {
    expect(hasExpired('2026-09-29', '2026-09-29')).toBe(false);
    expect(hasExpired('2026-09-29', '2026-09-30')).toBe(true);
  });

  it('una promoción sin fecha de fin no vence sola', () => {
    // El banco la publicó sin fin: sigue viva hasta que la quite, y darle un
    // vencimiento inventado la borraría mientras el comercio la sigue honrando.
    expect(hasExpired(null, '2027-01-01')).toBe(false);
  });
});
