import { Money } from '@app/domain';
import { describe, expect, it } from 'vitest';

import {
  computeCushion,
  cushionClaim,
  cushionMonths,
  HIGH_VARIATION,
  MAX_CUSHION_MONTHS,
  MIN_CUSHION_MONTHS,
  STABLE_VARIATION,
} from './cushion.js';

const usd = (value: string) => Money.fromDecimalString(value, 'USD');

describe('cuántos meses de colchón pide este hogar', () => {
  it('pide el mínimo a quien cobra casi lo mismo todos los meses', () => {
    expect(cushionMonths(0)).toBe(MIN_CUSHION_MONTHS);
    expect(cushionMonths(0.02)).toBe(MIN_CUSHION_MONTHS);
    expect(cushionMonths(STABLE_VARIATION)).toBe(MIN_CUSHION_MONTHS);
  });

  it('pide el máximo a quien alterna meses gordos con meses secos', () => {
    expect(cushionMonths(HIGH_VARIATION)).toBe(MAX_CUSHION_MONTHS);
    expect(cushionMonths(1.4)).toBe(MAX_CUSHION_MONTHS);
  });

  it('sube gradualmente entre los dos extremos', () => {
    const gentle = cushionMonths(0.25);
    const rough = cushionMonths(0.4);

    expect(gentle).toBeGreaterThanOrEqual(MIN_CUSHION_MONTHS);
    expect(rough).toBeGreaterThan(gentle);
    expect(rough).toBeLessThanOrEqual(MAX_CUSHION_MONTHS);
  });

  it('trata una variación imposible como la más estable, no como un error', () => {
    expect(cushionMonths(Number.NaN)).toBe(MIN_CUSHION_MONTHS);
    expect(cushionMonths(-3)).toBe(MIN_CUSHION_MONTHS);
  });
});

describe('el objetivo y lo que falta', () => {
  it('multiplica el piso por los meses que la volatilidad pide', () => {
    const state = computeCushion({
      currency: 'USD',
      floor: usd('1500.00'),
      held: usd('0'),
      variation: 0.8,
    });

    expect(state.monthsTarget).toBe(6);
    expect(state.target.toDecimalString()).toBe('9000.0000');
    expect(state.missing.toDecimalString()).toBe('9000.0000');
    expect(state.isFunded).toBe(false);
  });

  it('respeta el objetivo que la casa fijó a mano', () => {
    const state = computeCushion({
      currency: 'USD',
      floor: usd('1000.00'),
      held: usd('0'),
      variation: 0.9,
      monthsTarget: 2,
    });

    expect(state.monthsTarget).toBe(2);
    expect(state.target.toDecimalString()).toBe('2000.0000');
  });

  it('no pide nada más cuando el colchón está completo', () => {
    const state = computeCushion({
      currency: 'USD',
      floor: usd('1000.00'),
      held: usd('4000.00'),
      variation: 0.1,
    });

    expect(state.monthsTarget).toBe(3);
    expect(state.missing.toDecimalString()).toBe('0.0000');
    expect(state.isFunded).toBe(true);
    expect(state.monthsHeld).toBe(4);
  });
});

describe('lo que la retención pasa a la operativa cada mes', () => {
  it('pasa exactamente el piso mientras haya de dónde', () => {
    const state = computeCushion({
      currency: 'USD',
      floor: usd('1500.00'),
      held: usd('9000.00'),
      variation: 0.6,
    });

    expect(state.release.toDecimalString()).toBe('1500.0000');
    expect(state.shortOfFloor.toDecimalString()).toBe('0.0000');
  });

  it('cuando el colchón se acabó, pasa lo que queda y lo dice en voz alta', () => {
    const state = computeCushion({
      currency: 'USD',
      floor: usd('1500.00'),
      held: usd('400.00'),
      variation: 0.6,
    });

    expect(state.release.toDecimalString()).toBe('400.0000');
    // El mes va a ser $1,100 más corto que el piso, y esa es la frase que hace
    // falta decir antes de que la casa gaste como si el piso hubiera llegado.
    expect(state.shortOfFloor.toDecimalString()).toBe('1100.0000');
  });

  it('sin piso no hay colchón que calcular ni meses que contar', () => {
    const state = computeCushion({
      currency: 'USD',
      floor: usd('0'),
      held: usd('2000.00'),
      variation: 0.3,
    });

    expect(state.target.toDecimalString()).toBe('0.0000');
    expect(state.release.toDecimalString()).toBe('0.0000');
    expect(state.monthsHeld).toBe(0);
    // Un objetivo de cero no está «completo»: no hay objetivo todavía.
    expect(state.isFunded).toBe(false);
  });
});

describe('el excedente va al colchón antes que a las metas', () => {
  it('se lleva todo el excedente mientras falte más de lo que sobra', () => {
    const state = computeCushion({
      currency: 'USD',
      floor: usd('1000.00'),
      held: usd('500.00'),
      variation: 0.1,
    });

    expect(cushionClaim(state, usd('800.00')).toDecimalString()).toBe('800.0000');
  });

  it('se lleva sólo lo que le falta, y el resto sigue de largo', () => {
    const state = computeCushion({
      currency: 'USD',
      floor: usd('1000.00'),
      held: usd('2900.00'),
      variation: 0.1,
    });

    expect(state.missing.toDecimalString()).toBe('100.0000');
    expect(cushionClaim(state, usd('800.00')).toDecimalString()).toBe('100.0000');
  });

  it('no reclama nada con el colchón lleno ni con el mes en rojo', () => {
    const full = computeCushion({
      currency: 'USD',
      floor: usd('1000.00'),
      held: usd('3000.00'),
      variation: 0.1,
    });
    expect(cushionClaim(full, usd('800.00')).isZero()).toBe(true);

    const empty = computeCushion({
      currency: 'USD',
      floor: usd('1000.00'),
      held: usd('0'),
      variation: 0.1,
    });
    expect(cushionClaim(empty, usd('-50.00')).isZero()).toBe(true);
  });
});
