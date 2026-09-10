import { describe, expect, it } from 'vitest';

import {
  findCoverageGaps,
  monthOf,
  nextMonth,
  previousMonth,
  type AccountActivity,
} from './statement-coverage.js';

/**
 * Un hueco en los datos no se lee como un hueco: se lee como un buen mes.
 *
 * Esto es lo que hace que el producto pida lo que le falta en vez de esperar a
 * que alguien se acuerde. Lo que se prueba aquí es sobre todo lo que **no** se
 * reclama — pedir de más enseña a ignorar el aviso, y el aviso que se ignora es
 * el mismo que después no avisa de agosto.
 */

const account = (over: Partial<AccountActivity> = {}): AccountActivity => ({
  accountId: 'acc-1',
  name: 'Cuenta de ahorros',
  maskedNumber: '1783',
  kind: 'bank',
  monthsSeen: ['2026-06', '2026-07', '2026-08'],
  ...over,
});

describe('findCoverageGaps', () => {
  it('no reclama nada cuando la cuenta está al día', () => {
    const report = findCoverageGaps([account()], '2026-09');
    expect(report.gaps).toEqual([]);
    expect(report.isComplete).toBe(true);
  });

  it('encuentra el mes que falta en el medio', () => {
    const report = findCoverageGaps(
      [account({ monthsSeen: ['2026-06', '2026-08'] })],
      '2026-09',
    );

    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0]?.missing).toEqual(['2026-07']);
    // Con qué nombrarla: «la cuenta 1783».
    expect(report.gaps[0]?.maskedNumber).toBe('1783');
  });

  it('reclama el mes cerrado más reciente cuando no llegó', () => {
    // Agosto cerró y no está. Es el caso que el usuario describió.
    const report = findCoverageGaps(
      [account({ monthsSeen: ['2026-06', '2026-07'] })],
      '2026-09',
    );
    expect(report.gaps[0]?.missing).toEqual(['2026-08']);
  });

  it('NO reclama el mes en curso', () => {
    // El banco todavía no lo cerró. Pedirlo es pedir algo que no existe, y eso
    // enseña a ignorar el aviso.
    const report = findCoverageGaps([account({ monthsSeen: ['2026-08'] })], '2026-09');
    expect(report.gaps).toEqual([]);
  });

  it('NO reclama meses anteriores al primero que la cuenta vio', () => {
    // Reclamar lo anterior a que la casa empezara a usar el producto es
    // reclamar una deuda que nadie contrajo.
    const report = findCoverageGaps([account({ monthsSeen: ['2026-08'] })], '2026-10');
    expect(report.gaps[0]?.missing).toEqual(['2026-09']);
  });

  it('separa una cuenta que nunca recibió nada', () => {
    // Es un caso distinto —no hay hueco, no hay nada— y se dice distinto.
    const report = findCoverageGaps([account({ monthsSeen: [] })], '2026-09');

    expect(report.gaps).toEqual([]);
    expect(report.neverImported).toHaveLength(1);
    expect(report.isComplete).toBe(false);
  });

  it('cruza el año sin perderse', () => {
    const report = findCoverageGaps(
      [account({ monthsSeen: ['2025-11', '2026-02'] })],
      '2026-03',
    );
    expect(report.gaps[0]?.missing).toEqual(['2025-12', '2026-01']);
  });

  it('corta una cuenta abandonada en seis meses', () => {
    // Dos años de reclamos ahogarían a los tres que importan, y los viejos ya
    // no se pueden conseguir del banco.
    const report = findCoverageGaps(
      [account({ monthsSeen: ['2023-01'] })],
      '2026-09',
    );

    expect(report.gaps[0]?.missing).toHaveLength(6);
    // Los más recientes, que son los que todavía se pueden pedir.
    expect(report.gaps[0]?.missing.at(-1)).toBe('2026-08');
  });

  it('reporta varias cuentas a la vez, que es el caso real', () => {
    const report = findCoverageGaps(
      [
        account({ accountId: 'a', maskedNumber: '1783', monthsSeen: ['2026-07'] }),
        account({ accountId: 'b', maskedNumber: '0209', kind: 'card', monthsSeen: ['2026-07'] }),
      ],
      '2026-09',
    );

    expect(report.gaps).toHaveLength(2);
    expect(report.gaps.map((gap) => gap.maskedNumber)).toEqual(['1783', '0209']);
    expect(report.gaps[1]?.kind).toBe('card');
  });

  it('sobrevive a una cuenta sin últimos cuatro declarados', () => {
    const report = findCoverageGaps(
      [account({ maskedNumber: null, monthsSeen: ['2026-06'] })],
      '2026-08',
    );
    expect(report.gaps[0]?.maskedNumber).toBeNull();
    expect(report.gaps[0]?.name).toBe('Cuenta de ahorros');
  });

  it('no se cae sin cuentas', () => {
    expect(findCoverageGaps([], '2026-09').isComplete).toBe(true);
  });
});

describe('aritmética de meses', () => {
  it('avanza y retrocede cruzando diciembre', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(previousMonth('2026-01')).toBe('2025-12');
  });

  it('mantiene el cero a la izquierda', () => {
    expect(nextMonth('2026-08')).toBe('2026-09');
    expect(previousMonth('2026-10')).toBe('2026-09');
  });

  it('saca el mes de una fecha', () => {
    expect(monthOf('2026-08-14')).toBe('2026-08');
  });
});
