import { describe, expect, it } from 'vitest';

import { readIsoDate, readPromotions, readWeekdays } from './promotion-extract';

/**
 * Lo que se le permite al modelo, y lo que no.
 *
 * Cada prueba de este archivo es un intento de que una lectura automática entre
 * como si fuera un hecho. Que fallen es el producto: una promoción leída por
 * una máquina es una pista muy buena, y presentarla como confirmada sería lo
 * mismo que este repositorio se niega a hacer con cualquier otra cifra.
 */

const CAPTURED = '2026-09-10';

const row = (over: Record<string, unknown> = {}) => ({
  merchantName: 'Fosters',
  headline: '50% de descuento',
  detail: 'Todos los martes de septiembre. Consumo hasta US$250.',
  category: 'restaurantes',
  networks: ['visa', 'mastercard'],
  cardTypes: ['credit', 'debit'],
  validFrom: '2026-09-01',
  validUntil: '2026-09-29',
  channel: 'Sólo en el local',
  ...over,
});

describe('lo que entra', () => {
  it('acepta una promoción completa y la normaliza', () => {
    const reading = readPromotions([row()], CAPTURED);

    expect(reading.accepted).toHaveLength(1);
    const promo = reading.accepted[0];
    expect(promo?.merchantName).toBe('Fosters');
    expect(promo?.category).toBe('restaurantes');
    expect(promo?.networks).toEqual(['visa', 'mastercard']);
    expect(promo?.cardTypes).toEqual(['credit', 'debit']);
    expect(promo?.validUntil).toBe('2026-09-29');
  });

  it('lee los días del texto y no del modelo', () => {
    // El modelo podría decir «todos los días» y el texto decir «los martes».
    // Manda el texto: es lo que decide si alguien maneja hasta allá para nada.
    const reading = readPromotions([row({ weekdays: [1, 2, 3, 4, 5, 6, 7] })], CAPTURED);
    expect(reading.accepted[0]?.weekdays).toEqual([2]);
  });

  it('deja los días vacíos cuando la promoción no restringe ninguno', () => {
    const reading = readPromotions(
      [row({ detail: 'Válido durante todo el mes.', headline: '2x1' })],
      CAPTURED,
    );
    expect(reading.accepted[0]?.weekdays).toEqual([]);
  });
});

describe('lo que se descarta', () => {
  it('rechaza una promoción sin comercio: eso es publicidad', () => {
    const reading = readPromotions(
      [row({ merchantName: '', headline: 'Descuentos en tus comercios favoritos' })],
      CAPTURED,
    );

    expect(reading.accepted).toEqual([]);
    expect(reading.rejected[0]?.reason).toContain('comercio');
  });

  it('rechaza una sin titular', () => {
    const reading = readPromotions([row({ headline: '' })], CAPTURED);
    expect(reading.accepted).toEqual([]);
    expect(reading.rejected[0]?.reason).toContain('titular');
  });

  it('rechaza lo que ni siquiera es una fila', () => {
    const reading = readPromotions(['una cadena', 42, null], CAPTURED);
    expect(reading.accepted).toEqual([]);
    expect(reading.rejected).toHaveLength(3);
  });

  it('no lee más de cuarenta de una sola página', () => {
    const many = Array.from({ length: 60 }, () => row());
    expect(readPromotions(many, CAPTURED).accepted).toHaveLength(40);
  });
});

describe('lo que se normaliza en vez de creerse', () => {
  it('manda a «otros» una categoría que no está en el catálogo', () => {
    const reading = readPromotions([row({ category: 'gastronomía gourmet' })], CAPTURED);
    // La promoción es real aunque el modelo se equivoque de cajón.
    expect(reading.accepted[0]?.category).toBe('otros');
  });

  it('descarta redes y tipos que no existen', () => {
    const reading = readPromotions(
      [row({ networks: ['visa', 'diners', 'unionpay'], cardTypes: ['credit', 'prepago'] })],
      CAPTURED,
    );

    expect(reading.accepted[0]?.networks).toEqual(['visa']);
    expect(reading.accepted[0]?.cardTypes).toEqual(['credit']);
  });

  it('descarta una fecha inventada en vez de propagarla', () => {
    expect(readIsoDate('2026-02-30')).toBeNull();
    expect(readIsoDate('septiembre')).toBeNull();
    expect(readIsoDate('2026-13-01')).toBeNull();
    expect(readIsoDate('2026-09-29')).toBe('2026-09-29');

    const reading = readPromotions([row({ validUntil: '2026-02-30' })], CAPTURED);
    expect(reading.accepted[0]?.validUntil).toBeNull();
  });
});

describe('los días de la semana', () => {
  it('lee los nombres como se escriben en Panamá, con y sin tilde', () => {
    expect(readWeekdays('todos los miércoles')).toEqual([3]);
    expect(readWeekdays('todos los miercoles')).toEqual([3]);
    expect(readWeekdays('sábados y domingos')).toEqual([6, 7]);
    expect(readWeekdays('de lunes a viernes')).toEqual([1, 5]);
  });

  it('no inventa días donde no los hay', () => {
    expect(readWeekdays('50% de descuento en el total de tu cuenta')).toEqual([]);
  });
});
