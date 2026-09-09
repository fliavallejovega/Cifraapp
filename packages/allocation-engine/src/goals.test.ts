import { Money, toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { goalWeight, receiptsByGoal } from './goals.js';

/**
 * Metas con fecha, y el dinero que viene en camino hacia ellas.
 *
 * Lo que estos casos protegen es una sola idea: una fecha comprometida no es
 * una preferencia más fuerte, es otra clase de cosa. Y el dinero que todavía no
 * llegó se enseña al lado de la meta, nunca sumado a ella.
 */

const on = (date: string) => toPlainDate(date);
const usd = (value: string) => Money.fromDecimalString(value, 'USD');
const today = on('2026-09-09');

describe('el peso de una meta', () => {
  it('deja en paz el orden que la casa le dio a lo que no está confirmado', () => {
    // Sin confirmar, la prioridad es la prioridad — con fecha o sin ella. Poner
    // un día en una casilla no es comprometerse: «algún día en diciembre» es
    // una fecha, y reordenar por eso sería reordenar por una suposición.
    expect(goalWeight({ priority: 3, targetDate: null, isCommitted: false, today })).toBe(3);
    expect(
      goalWeight({ priority: 3, targetDate: on('2026-12-20'), isCommitted: false, today }),
    ).toBe(3);
  });

  it('pone cualquier meta confirmada por delante de todas las que no lo están', () => {
    const confirmedLast = goalWeight({
      priority: 99,
      targetDate: null,
      isCommitted: true,
      today,
    });
    const rankedFirst = goalWeight({ priority: 0, targetDate: null, isCommitted: false, today });
    expect(confirmedLast).toBeLessThan(rankedFirst);
  });

  it('entre confirmadas manda la fecha, no la prioridad', () => {
    // El viaje del 20 de diciembre está más cerca que el carro de marzo, y lo
    // que importa es a cuál hay que llegar primero — aunque la casa hubiera
    // puesto el carro más arriba cuando ninguna de las dos tenía fecha.
    const trip = goalWeight({
      priority: 5,
      targetDate: on('2026-12-20'),
      isCommitted: true,
      today,
    });
    const car = goalWeight({ priority: 1, targetDate: on('2027-03-01'), isCommitted: true, today });
    expect(trip).toBeLessThan(car);
  });

  it('una confirmada con fecha gana a una confirmada sin fecha', () => {
    const dated = goalWeight({
      priority: 9,
      targetDate: on('2030-01-01'),
      isCommitted: true,
      today,
    });
    const undated = goalWeight({ priority: 0, targetDate: null, isCommitted: true, today });
    expect(dated).toBeLessThan(undated);
  });

  it('una confirmada que ya venció es la más urgente de todas', () => {
    // No dejó de hacer falta por llegar tarde: hace más falta.
    const overdue = goalWeight({
      priority: 5,
      targetDate: on('2026-08-01'),
      isCommitted: true,
      today,
    });
    const soon = goalWeight({
      priority: 5,
      targetDate: on('2026-09-10'),
      isCommitted: true,
      today,
    });
    expect(overdue).toBeLessThan(soon);
  });
});

describe('qué cobro le sirve a qué meta', () => {
  const trip = { id: 'trip', targetDate: on('2026-12-20') };
  const car = { id: 'car', targetDate: on('2027-03-01') };
  const someday = { id: 'someday', targetDate: null };

  it('lo atribuye a la meta más cercana que todavía no venció', () => {
    // Un préstamo que devuelven el 10 de diciembre llega a tiempo para el viaje
    // del 20. Para marzo también llegaría, pero para entonces ya se gastó.
    const byGoal = receiptsByGoal({
      goals: [car, trip, someday],
      receipts: [
        {
          id: 'loan',
          name: 'Préstamo a Luis',
          amount: usd('550.00'),
          expectedOn: on('2026-12-10'),
        },
      ],
    });
    expect(byGoal.get('trip')?.map((one) => one.id)).toEqual(['loan']);
    expect(byGoal.has('car')).toBe(false);
  });

  it('lo pasa a la siguiente meta cuando llega tarde para la primera', () => {
    const byGoal = receiptsByGoal({
      goals: [trip, car],
      receipts: [
        { id: 'invoice', name: 'Factura', amount: usd('900.00'), expectedOn: on('2027-01-15') },
      ],
    });
    expect(byGoal.has('trip')).toBe(false);
    expect(byGoal.get('car')?.map((one) => one.id)).toEqual(['invoice']);
  });

  it('no atribuye un cobro sin fecha', () => {
    // «Me deben 500 y no sé cuándo» no se puede prometer a ninguna meta: no hay
    // forma de saber si llega a tiempo para nada.
    const byGoal = receiptsByGoal({
      goals: [trip, car],
      receipts: [{ id: 'vague', name: 'Lo de Luis', amount: usd('500.00'), expectedOn: null }],
    });
    expect(byGoal.size).toBe(0);
  });

  it('no atribuye un cobro posterior a todas las metas fechadas', () => {
    const byGoal = receiptsByGoal({
      goals: [trip, car, someday],
      receipts: [
        { id: 'late', name: 'Factura', amount: usd('900.00'), expectedOn: on('2028-01-01') },
      ],
    });
    expect(byGoal.size).toBe(0);
  });

  it('nunca reparte un cobro entre dos metas', () => {
    // Mil balboas que llegan una vez no son quinientos para cada una.
    // Prometerlos dos veces es la aritmética que deja a la casa corta en las dos.
    const byGoal = receiptsByGoal({
      goals: [trip, car],
      receipts: [
        {
          id: 'one',
          name: 'Décimo tercer mes',
          amount: usd('1000.00'),
          expectedOn: on('2026-12-15'),
        },
      ],
    });
    const attached = [...byGoal.values()].flat();
    expect(attached).toHaveLength(1);
    expect(byGoal.get('trip')?.[0]?.id).toBe('one');
  });

  it('junta varios cobros bajo la misma meta', () => {
    const byGoal = receiptsByGoal({
      goals: [trip],
      receipts: [
        { id: 'a', name: 'A', amount: usd('100.00'), expectedOn: on('2026-10-01') },
        { id: 'b', name: 'B', amount: usd('200.00'), expectedOn: on('2026-12-01') },
      ],
    });
    expect(byGoal.get('trip')?.map((one) => one.id)).toEqual(['a', 'b']);
  });
});
