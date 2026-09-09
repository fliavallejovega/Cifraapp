import { Money, toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import {
  computeIncomeFloor,
  monthlyIncomeTotals,
  percentileOf,
  type IncomeReceipt,
} from './income-floor.js';

/**
 * El piso de un ingreso que no es fijo.
 *
 * Todo lo que se afirma aquí es aritmética sobre cobros que ya entraron. Nada
 * predice nada: la prueba central es que el promedio y el piso dan cifras
 * distintas y que la distinta es la que deja a la casa de pie el mes seco.
 */

const usd = (value: string) => Money.fromDecimalString(value, 'USD');
const on = (date: string) => toPlainDate(date);

const receipt = (id: string, date: string, amount: string): IncomeReceipt => ({
  id,
  receivedOn: on(date),
  amount: usd(amount),
});

/** Los seis meses del artifact: promedio $3,500, y un mes en cero. */
const sixMonths: readonly IncomeReceipt[] = [
  receipt('a', '2026-03-10', '6000.00'),
  receipt('b', '2026-04-08', '1000.00'),
  receipt('c', '2026-05-19', '4000.00'),
  // Junio no tiene fila. Es el mes de $0 y tiene que contar.
  receipt('e', '2026-07-02', '8000.00'),
  receipt('f', '2026-08-21', '2000.00'),
];

describe('agrupar los cobros por mes de calendario', () => {
  it('cuenta el mes sin cobros como un mes de cero', () => {
    const months = monthlyIncomeTotals(sixMonths, 'USD');

    expect(months.map((one) => one.month)).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ]);
    expect(months[3]?.total.toDecimalString()).toBe('0.0000');
    expect(months[3]?.receiptCount).toBe(0);
  });

  it('suma varios cobros del mismo mes en un solo total', () => {
    const months = monthlyIncomeTotals(
      [receipt('a', '2026-03-01', '1200.00'), receipt('b', '2026-03-28', '800.50')],
      'USD',
    );

    expect(months).toHaveLength(1);
    expect(months[0]?.total.toDecimalString()).toBe('2000.5000');
    expect(months[0]?.receiptCount).toBe(2);
  });

  it('rellena diciembre a enero sin saltarse el año', () => {
    const months = monthlyIncomeTotals(
      [receipt('a', '2025-11-05', '100.00'), receipt('b', '2026-02-05', '100.00')],
      'USD',
    );

    expect(months.map((one) => one.month)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('no le inventa ceros a quien acaba de empezar', () => {
    const months = monthlyIncomeTotals([receipt('a', '2026-08-05', '3000.00')], 'USD');
    expect(months).toHaveLength(1);
  });
});

describe('el percentil', () => {
  it('devuelve un mes que de verdad ocurrió, sin interpolar', () => {
    const values = ['1000.00', '2000.00', '3000.00', '4000.00'].map(usd);
    // Con cuatro meses, el p25 es el primero: rango 1.
    expect(percentileOf(values, 0.25)?.toDecimalString()).toBe('1000.0000');
    // Y el p50 el segundo, no el punto medio entre el segundo y el tercero.
    expect(percentileOf(values, 0.5)?.toDecimalString()).toBe('2000.0000');
  });

  it('no tiene percentil sin muestra', () => {
    expect(percentileOf([], 0.25)).toBeNull();
  });
});

describe('el piso contra el promedio', () => {
  it('es mucho más bajo que el promedio, que es todo el punto', () => {
    const floor = computeIncomeFloor({
      currency: 'USD',
      receipts: sixMonths,
      today: on('2026-09-09'),
    });

    // El promedio de los seis meses —incluido el cero— es $3,500.
    const total = Money.sum(
      sixMonths.map((one) => one.amount),
      'USD',
    );
    expect(total.divide(6).toDecimalString()).toBe('3500.0000');

    // Y el piso es el segundo mes más flaco de seis: el de $1,000. Comprometerse
    // a $3,500 con este historial es quedarse corto tres meses de seis.
    expect(floor.amount.toDecimalString()).toBe('1000.0000');
    expect(floor.source).toBe('measured');
    expect(floor.percentile).toBe(0.25);
    expect(floor.monthsObserved).toBe(6);
  });

  it('reporta el peor mes, el típico y el mejor sin confundirlos con el piso', () => {
    const floor = computeIncomeFloor({
      currency: 'USD',
      receipts: sixMonths,
      today: on('2026-09-09'),
    });

    expect(floor.worstMonth?.toDecimalString()).toBe('0.0000');
    expect(floor.bestMonth?.toDecimalString()).toBe('8000.0000');
    expect(floor.typicalMonth?.toDecimalString()).toBe('3000.0000');
    expect(floor.variation).toBeGreaterThan(0.5);
  });
});

describe('cuando todavía no hay historia', () => {
  it('usa el piso que declaró la persona y lo dice', () => {
    const floor = computeIncomeFloor({
      currency: 'USD',
      receipts: [receipt('a', '2026-08-10', '3000.00')],
      today: on('2026-09-09'),
      declared: usd('1500.00'),
    });

    expect(floor.amount.toDecimalString()).toBe('1500.0000');
    expect(floor.source).toBe('declared');
    expect(floor.percentile).toBeNull();
    expect(floor.hasMeasurableHistory).toBe(false);
    expect(floor.measured).toBeNull();
  });

  it('sin cobros y sin declaración no hay piso, que no es un piso de cero', () => {
    const floor = computeIncomeFloor({
      currency: 'USD',
      receipts: [],
      today: on('2026-09-09'),
    });

    expect(floor.source).toBe('unknown');
    expect(floor.monthsObserved).toBe(0);
    expect(floor.months).toEqual([]);
  });

  it('mide en cuanto hay seis meses, y ofrece la medición sin pisar lo declarado', () => {
    const floor = computeIncomeFloor({
      currency: 'USD',
      receipts: sixMonths,
      today: on('2026-09-09'),
      declared: usd('2500.00'),
    });

    // Medido manda cuando existe: es el dato, no la impresión.
    expect(floor.source).toBe('measured');
    expect(floor.measured?.toDecimalString()).toBe('1000.0000');
    expect(floor.hasMeasurableHistory).toBe(true);
  });
});

describe('la ventana de historia', () => {
  it('mira los últimos doce meses y no lo de hace tres años', () => {
    const long: IncomeReceipt[] = [];
    // Dos años: el primero de $9,000 al mes, el segundo de $1,000.
    for (let month = 1; month <= 12; month += 1) {
      long.push(receipt(`old-${String(month)}`, `2025-${String(month).padStart(2, '0')}-05`, '9000.00'));
    }
    for (let month = 1; month <= 12; month += 1) {
      long.push(receipt(`new-${String(month)}`, `2026-${String(month).padStart(2, '0')}-05`, '1000.00'));
    }

    const floor = computeIncomeFloor({ currency: 'USD', receipts: long, today: on('2026-12-31') });

    expect(floor.monthsObserved).toBe(12);
    expect(floor.amount.toDecimalString()).toBe('1000.0000');
    expect(floor.bestMonth?.toDecimalString()).toBe('1000.0000');
  });
});
