import { describe, expect, it } from 'vitest';

import { readOcrRows, type OcrRow } from './ocr.js';

/**
 * El filtro entre lo que un modelo dijo que leyó y lo que entra al sistema.
 *
 * Estas pruebas no comprueban que la transcripción sea buena — eso depende del
 * escaneo y no se puede afirmar desde aquí. Comprueban lo otro, que es lo que
 * importa: que **nada llegue a la cola sin haber pasado por el mismo parser de
 * montos y fechas que usan las demás rutas**, y que lo que no pasa se enseñe en
 * vez de desaparecer.
 */

const options = { accountId: 'acc-1', currency: 'USD' } as const;

const row = (over: Partial<OcrRow> = {}): OcrRow => ({
  date: '07/09/2026',
  description: 'SUPER 99 VIA ESPANA',
  amount: '125.40',
  direction: 'debit',
  ...over,
});

describe('readOcrRows', () => {
  it('lee una línea corriente de un estado panameño', () => {
    const { transactions, rejected } = readOcrRows([row()], options);

    expect(rejected).toEqual([]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.transactionDate).toBe('2026-09-07');
    expect(transactions[0]?.amount.toDecimalString()).toBe('125.4000');
    expect(transactions[0]?.direction).toBe('outflow');
  });

  it('lee día primero, que es como escribe Panamá', () => {
    // `07/09` es 7 de setiembre, no 9 de julio. Al revés, el mes entero cae en
    // el trimestre equivocado.
    const { transactions } = readOcrRows([row({ date: '07/09/2026' })], options);
    expect(transactions[0]?.transactionDate).toBe('2026-09-07');
  });

  it('conserva los separadores de miles que el banco imprime', () => {
    const { transactions } = readOcrRows([row({ amount: 'B/. 1,234.56' })], options);
    expect(transactions[0]?.amount.toDecimalString()).toBe('1234.5600');
  });

  it('rechaza una fecha que no lo es, con su texto crudo', () => {
    const { transactions, rejected } = readOcrRows([row({ date: 'saldo anterior' })], options);

    expect(transactions).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBe('unreadable_date');
    // El texto viaja: una línea que no se pudo leer tiene que poder mirarse.
    expect(rejected[0]?.raw).toContain('saldo anterior');
  });

  it('rechaza un monto que el modelo no supo leer', () => {
    const { transactions, rejected } = readOcrRows([row({ amount: 'ilegible' })], options);

    expect(transactions).toEqual([]);
    expect(rejected[0]?.reason).toBe('unreadable_amount');
  });

  it('no acepta un monto sin concepto', () => {
    const { rejected } = readOcrRows([row({ description: '   ' })], options);
    expect(rejected[0]?.reason).toBe('missing_description');
  });

  it('rechaza un cero: un movimiento de cero no es un movimiento', () => {
    const { rejected } = readOcrRows([row({ amount: '0.00' })], options);
    expect(rejected[0]?.reason).toBe('zero_amount');
  });

  it('lee un abono cuando la página lo declara', () => {
    const { transactions } = readOcrRows(
      [row({ description: 'PAGO RECIBIDO', direction: 'credit' })],
      options,
    );
    expect(transactions[0]?.direction).toBe('inflow');
  });

  it('asume cargo cuando la página no declara dirección', () => {
    // El signo no desempata a propósito: un menos significa cosas opuestas en
    // un estado de banco y en uno de tarjeta.
    const { transactions } = readOcrRows([row({ direction: 'unknown', amount: '-40.00' })], options);
    expect(transactions[0]?.direction).toBe('outflow');
  });

  it('da la misma huella que daría el mismo movimiento leído de un CSV', () => {
    // Es lo que permite que el motor de duplicados reconozca como una sola cosa
    // el escaneo de hoy y el CSV que el banco publique mañana.
    const [uno] = readOcrRows([row()], options).transactions;
    const [otro] = readOcrRows([row({ amount: '125.40', direction: 'unknown' })], options)
      .transactions;

    expect(uno?.fingerprint).toBe(otro?.fingerprint);
    expect(uno?.fingerprint).toHaveLength(32);
  });

  it('corta una transcripción descarriada y lo dice', () => {
    // Un modelo repitiendo la misma línea no puede entrar como mil movimientos,
    // y el corte tiene que ser visible: una fila rechazada que lo anuncia.
    const many = Array.from({ length: 700 }, () => row());
    const { transactions, rejected } = readOcrRows(many, options);

    expect(transactions).toHaveLength(600);
    expect(rejected.some((one) => one.reason === 'too_many_rows')).toBe(true);
  });

  it('no se cae con una transcripción vacía', () => {
    const result = readOcrRows([], options);
    expect(result.transactions).toEqual([]);
    expect(result.rejected).toEqual([]);
  });
});
