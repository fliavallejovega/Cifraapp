import { Money, toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import {
  computeCoverage,
  type CoverageCommitment,
  type ExpectedReceipt,
} from './coverage.js';

const usd = (value: string) => Money.fromDecimalString(value, 'USD');
const on = (date: string) => toPlainDate(date);

const owed = (over: Partial<CoverageCommitment> & { id: string }): CoverageCommitment => ({
  label: 'Algo',
  due: on('2026-09-20'),
  amount: usd('500.00'),
  isEssential: true,
  ...over,
});

const coming = (over: Partial<ExpectedReceipt> & { id: string }): ExpectedReceipt => ({
  label: 'Factura',
  amount: usd('1000.00'),
  from: on('2026-09-10'),
  to: on('2026-09-15'),
  confidence: 'confirmed',
  ...over,
});

describe('lo que el efectivo cubre solo', () => {
  it('marca cubierto lo que se paga con lo que hay, y dice hasta qué día llega', () => {
    const result = computeCoverage({
      currency: 'USD',
      today: on('2026-09-09'),
      cash: usd('900.00'),
      commitments: [
        owed({ id: 'luz', due: on('2026-09-12'), amount: usd('400.00') }),
        owed({ id: 'internet', due: on('2026-09-14'), amount: usd('500.00') }),
        owed({ id: 'alquiler', due: on('2026-09-30'), amount: usd('700.00') }),
      ],
      expected: [],
    });

    expect(result.commitments.map((one) => one.verdict)).toEqual([
      'covered',
      'covered',
      'uncovered',
    ]);
    expect(result.coveredThrough).toBe('2026-09-14');
    expect(result.mustArrive.toDecimalString()).toBe('700.0000');
    expect(result.mustArriveBy).toBe('2026-09-30');
    expect(result.totalCommitted.toDecimalString()).toBe('1600.0000');
  });

  it('no cubre hasta ningún día cuando el primer compromiso ya no alcanza', () => {
    const result = computeCoverage({
      currency: 'USD',
      today: on('2026-09-09'),
      cash: usd('100.00'),
      commitments: [owed({ id: 'alquiler', amount: usd('700.00') })],
      expected: [],
    });

    expect(result.coveredThrough).toBeNull();
    expect(result.commitments[0]?.fromCash.toDecimalString()).toBe('100.0000');
    expect(result.commitments[0]?.shortfall.toDecimalString()).toBe('600.0000');
  });

  it('deja fuera lo que vence después del horizonte', () => {
    const result = computeCoverage({
      currency: 'USD',
      today: on('2026-09-09'),
      cash: usd('0'),
      commitments: [owed({ id: 'lejos', due: on('2026-12-01'), amount: usd('900.00') })],
      expected: [],
    });

    expect(result.commitments).toHaveLength(0);
    expect(result.horizon).toBe('2026-10-09');
  });
});

describe('un cobro sólo sirve si su ventana cierra antes del vencimiento', () => {
  it('vuelve condicional lo que un cobro que llega a tiempo puede pagar', () => {
    const result = computeCoverage({
      currency: 'USD',
      today: on('2026-09-09'),
      cash: usd('0'),
      commitments: [owed({ id: 'alquiler', due: on('2026-09-20'), amount: usd('700.00') })],
      expected: [coming({ id: 'f1', to: on('2026-09-15'), amount: usd('1000.00') })],
    });

    const line = result.commitments[0];
    expect(line?.verdict).toBe('conditional');
    expect(line?.fromExpected.toDecimalString()).toBe('700.0000');
    expect(line?.shortfall.isZero()).toBe(true);
    expect(line?.dependsOn[0]?.receiptId).toBe('f1');
    expect(line?.dependsOn[0]?.by).toBe('2026-09-20');
    expect(line?.weakestDependency).toBe('confirmed');
  });

  it('descarta el cobro cuya ventana puede cerrar después de la fecha', () => {
    const result = computeCoverage({
      currency: 'USD',
      today: on('2026-09-09'),
      cash: usd('0'),
      commitments: [owed({ id: 'alquiler', due: on('2026-09-25'), amount: usd('700.00') })],
      // «Entre el 20 y el 30». Puede que sí y puede que no: no paga el 25.
      expected: [coming({ id: 'f1', from: on('2026-09-20'), to: on('2026-09-30') })],
    });

    expect(result.commitments[0]?.verdict).toBe('uncovered');
    expect(result.commitments[0]?.dependsOn).toEqual([]);
    expect(result.uncovered.toDecimalString()).toBe('700.0000');
    expect(result.hasUncovered).toBe(true);
  });

  it('ignora el cobro sin ventana: «no sé cuándo» no financia una fecha', () => {
    const result = computeCoverage({
      currency: 'USD',
      today: on('2026-09-09'),
      cash: usd('0'),
      commitments: [owed({ id: 'alquiler', amount: usd('700.00') })],
      expected: [coming({ id: 'f1', from: null, to: null })],
    });

    expect(result.commitments[0]?.verdict).toBe('uncovered');
    expect(result.expectedInHorizon.isZero()).toBe(true);
  });

  it('no gasta el mismo cobro dos veces', () => {
    const result = computeCoverage({
      currency: 'USD',
      today: on('2026-09-09'),
      cash: usd('0'),
      commitments: [
        owed({ id: 'a', due: on('2026-09-20'), amount: usd('600.00') }),
        owed({ id: 'b', due: on('2026-09-22'), amount: usd('600.00') }),
      ],
      expected: [coming({ id: 'f1', to: on('2026-09-15'), amount: usd('1000.00') })],
    });

    expect(result.commitments[0]?.fromExpected.toDecimalString()).toBe('600.0000');
    expect(result.commitments[1]?.fromExpected.toDecimalString()).toBe('400.0000');
    expect(result.commitments[1]?.verdict).toBe('uncovered');
    expect(result.commitments[1]?.shortfall.toDecimalString()).toBe('200.0000');
  });
});

describe('el orden en que se reparten los cobros', () => {
  it('apoya primero en lo confirmado y deja lo flojo para lo de más adelante', () => {
    const result = computeCoverage({
      currency: 'USD',
      today: on('2026-09-09'),
      cash: usd('0'),
      commitments: [
        owed({ id: 'temprano', due: on('2026-09-20'), amount: usd('500.00') }),
        owed({ id: 'tarde', due: on('2026-09-28'), amount: usd('500.00') }),
      ],
      expected: [
        coming({ id: 'charla', to: on('2026-09-12'), amount: usd('500.00'), confidence: 'estimated' }),
        coming({ id: 'firmada', to: on('2026-09-14'), amount: usd('500.00'), confidence: 'confirmed' }),
      ],
    });

    expect(result.commitments[0]?.dependsOn[0]?.receiptId).toBe('firmada');
    expect(result.commitments[0]?.weakestDependency).toBe('confirmed');
    expect(result.commitments[1]?.dependsOn[0]?.receiptId).toBe('charla');
    expect(result.commitments[1]?.weakestDependency).toBe('estimated');
  });

  it('reporta el grado más flojo cuando un compromiso se apoya en varios', () => {
    const result = computeCoverage({
      currency: 'USD',
      today: on('2026-09-09'),
      cash: usd('0'),
      commitments: [owed({ id: 'alquiler', due: on('2026-09-25'), amount: usd('900.00') })],
      expected: [
        coming({ id: 'firmada', to: on('2026-09-14'), amount: usd('500.00'), confidence: 'confirmed' }),
        coming({ id: 'acordada', to: on('2026-09-18'), amount: usd('500.00'), confidence: 'likely' }),
      ],
    });

    expect(result.commitments[0]?.verdict).toBe('conditional');
    expect(result.commitments[0]?.dependsOn).toHaveLength(2);
    expect(result.commitments[0]?.weakestDependency).toBe('likely');
  });
});

describe('la frase completa que la pantalla tiene que poder decir', () => {
  it('junta compromisos, día cubierto, cuánto falta, para cuándo y de qué certeza', () => {
    const result = computeCoverage({
      currency: 'USD',
      today: on('2026-09-09'),
      cash: usd('596.00'),
      commitments: [
        owed({ id: 'luz', due: on('2026-09-14'), amount: usd('596.00') }),
        owed({ id: 'alquiler', due: on('2026-09-30'), amount: usd('1240.00') }),
      ],
      expected: [
        coming({ id: 'f1', to: on('2026-09-26'), amount: usd('1900.00'), confidence: 'confirmed' }),
        coming({ id: 'f2', to: on('2026-10-05'), amount: usd('1500.00'), confidence: 'estimated' }),
      ],
    });

    expect(result.totalCommitted.toDecimalString()).toBe('1836.0000');
    expect(result.coveredThrough).toBe('2026-09-14');
    expect(result.mustArrive.toDecimalString()).toBe('1240.0000');
    expect(result.mustArriveBy).toBe('2026-09-30');
    expect(result.expectedInHorizon.toDecimalString()).toBe('3400.0000');
    expect(result.confirmedInHorizon.toDecimalString()).toBe('1900.0000');
    expect(result.commitments[1]?.verdict).toBe('conditional');
    expect(result.hasUncovered).toBe(false);
  });
});
