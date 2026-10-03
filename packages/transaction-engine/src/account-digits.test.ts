import { describe, expect, it } from 'vitest';

import { digitsDisagree, findAccountDigits } from './account-digits.js';

describe('findAccountDigits', () => {
  it('reads a masked card number', () => {
    expect(findAccountDigits(['BANCO GENERAL', 'Tarjeta VISA XXXX-XXXX-XXXX-0209'])).toBe('0209');
    expect(findAccountDigits(['**** **** **** 5502'])).toBe('5502');
    expect(findAccountDigits(['Mastercard •••• 7710'])).toBe('7710');
  });

  it('reads «terminada en» and «ending in»', () => {
    expect(findAccountDigits(['Su tarjeta terminada en 4821'])).toBe('4821');
    expect(findAccountDigits(['Card ending in 0193'])).toBe('0193');
  });

  it('reads the last four of a labelled bank account number', () => {
    expect(findAccountDigits(['Cuenta de Ahorros', 'Cuenta No. 04-72-01-091783-1'])).toBe('7831');
    expect(findAccountDigits(['Account number: 0412345678'])).toBe('5678');
  });

  it('prefers a masked number over a labelled one', () => {
    expect(findAccountDigits(['Cuenta No. 04-72-01-091783-1', 'Tarjeta XXXX-XXXX-XXXX-0209'])).toBe(
      '0209',
    );
  });

  it('does not take a short figure after «cuenta» for an account', () => {
    expect(findAccountDigits(['Estado de cuenta 09/2026', 'Saldo 1,234.56'])).toBeNull();
  });

  it('ignores numbers in the body of the statement', () => {
    const lines = [...Array.from({ length: 60 }, () => 'header'), 'Tarjeta XXXX-XXXX-XXXX-9999'];
    expect(findAccountDigits(lines)).toBeNull();
  });

  it('answers null rather than guessing', () => {
    expect(findAccountDigits(['Movimientos del mes', '07/09 SUPER 99 12.40'])).toBeNull();
  });
});

describe('digitsDisagree', () => {
  it('flags two different sets of four digits', () => {
    expect(digitsDisagree('0209', '5502')).toBe(true);
  });

  it('does not flag when either side is missing', () => {
    expect(digitsDisagree(null, '5502')).toBe(false);
    expect(digitsDisagree('0209', null)).toBe(false);
    expect(digitsDisagree('0209', '')).toBe(false);
  });

  it('compares only the last four', () => {
    expect(digitsDisagree('7831', '04720109178 31'.replace(' ', ''))).toBe(false);
  });
});
