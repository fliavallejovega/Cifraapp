import { Money, toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { spendShift } from './spend-shift.js';
import type { TransactionRow } from './types.js';

/**
 * En qué se gastó más y en qué menos, y lo que eso libera.
 *
 * Los casos protegen dos cosas que se rompen fácil y en silencio: que no se
 * compare contra un mes que no existió, y que las transferencias no cuenten
 * como gasto — pagar la tarjeta movería el resultado entero sin que nadie gaste
 * un centavo de más.
 */

const usd = (value: string) => Money.fromDecimalString(value, 'USD');

const spend = (over: Partial<TransactionRow> & { amount: Money }): TransactionRow => ({
  id: Math.random().toString(36).slice(2),
  date: toPlainDate('2026-09-01'),
  accountId: 'account',
  categorySlug: 'dining',
  categoryLabel: 'Restaurantes',
  isTransfer: false,
  merchant: null,
  deductibleAmount: null,
  ...over,
});

describe('en qué se gastó más y en qué menos', () => {
  it('separa lo que subió de lo que bajó, lo más movido primero', () => {
    const shift = spendShift({
      currency: 'USD',
      hadPrevious: true,
      previous: [
        spend({ amount: usd('-200.00'), categorySlug: 'dining', categoryLabel: 'Restaurantes' }),
        spend({ amount: usd('-500.00'), categorySlug: 'groceries', categoryLabel: 'Supermercado' }),
        spend({
          amount: usd('-60.00'),
          categorySlug: 'transportation',
          categoryLabel: 'Transporte',
        }),
      ],
      current: [
        spend({ amount: usd('-340.00'), categorySlug: 'dining', categoryLabel: 'Restaurantes' }),
        spend({ amount: usd('-380.00'), categorySlug: 'groceries', categoryLabel: 'Supermercado' }),
        spend({
          amount: usd('-90.00'),
          categorySlug: 'transportation',
          categoryLabel: 'Transporte',
        }),
      ],
    });

    expect(shift.comparable).toBe(true);
    expect(shift.spentMore.map((one) => one.key)).toEqual(['dining', 'transportation']);
    expect(shift.spentLess.map((one) => one.key)).toEqual(['groceries']);
    expect(shift.spentMore[0]?.change.toDecimalString()).toBe('140.0000');
    // Lo que bajó se dice en positivo: es dinero que está, no una pérdida.
    expect(shift.freed.toDecimalString()).toBe('120.0000');
    expect(shift.added.toDecimalString()).toBe('170.0000');
    expect(shift.net.toDecimalString()).toBe('50.0000');
  });

  it('no compara contra un mes que no existió', () => {
    // Un hogar en su primer mes no gastó «menos que antes»: no hay antes, y
    // felicitarlo por no haber existido es la peor forma de estrenar la app.
    const shift = spendShift({
      currency: 'USD',
      hadPrevious: false,
      previous: [],
      current: [spend({ amount: usd('-340.00') })],
    });
    expect(shift.comparable).toBe(false);
    expect(shift.spentMore).toHaveLength(0);
    expect(shift.spentLess).toHaveLength(0);
  });

  it('distingue un mes sin movimientos de un mes que no hubo', () => {
    // Control positivo del caso anterior: con `hadPrevious`, un anterior vacío
    // sí compara, y todo lo de este mes cuenta como subida.
    const shift = spendShift({
      currency: 'USD',
      hadPrevious: true,
      previous: [],
      current: [spend({ amount: usd('-340.00') })],
    });
    expect(shift.comparable).toBe(true);
    expect(shift.spentMore.map((one) => one.key)).toEqual(['dining']);
    expect(shift.spentMore[0]?.isNew).toBe(true);
    // Sin anterior contra qué medir, el porcentaje no existe: un rubro nuevo no
    // subió un infinito por ciento, sencillamente antes no estaba.
    expect(shift.spentMore[0]?.changeRate).toBeNull();
  });

  it('no cuenta las transferencias como gasto', () => {
    // Pagar la tarjeta mueve dinero entre dos cuentas de la casa. Contarlo
    // duplicaría cada compra que ya está en la tarjeta.
    const shift = spendShift({
      currency: 'USD',
      hadPrevious: true,
      previous: [],
      current: [
        spend({ amount: usd('-900.00'), isTransfer: true, categorySlug: 'transfers' }),
        spend({ amount: usd('-40.00') }),
      ],
    });
    expect(shift.spentMore.map((one) => one.key)).toEqual(['dining']);
    expect(shift.added.toDecimalString()).toBe('40.0000');
  });

  it('ignora las entradas: una devolución no es gastar menos', () => {
    const shift = spendShift({
      currency: 'USD',
      hadPrevious: true,
      previous: [spend({ amount: usd('-100.00') })],
      current: [spend({ amount: usd('-100.00') }), spend({ amount: usd('250.00') })],
    });
    expect(shift.spentMore).toHaveLength(0);
    expect(shift.spentLess).toHaveLength(0);
  });

  it('calcula el porcentaje contra lo que había', () => {
    const shift = spendShift({
      currency: 'USD',
      hadPrevious: true,
      previous: [spend({ amount: usd('-200.00') })],
      current: [spend({ amount: usd('-340.00') })],
    });
    expect(shift.spentMore[0]?.changeRate).toBe(70);
  });
});
