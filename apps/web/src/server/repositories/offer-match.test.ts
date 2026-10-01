import { describe, expect, it } from 'vitest';

import { matches } from './offer-match';

/**
 * El cruce entre una promoción y lo que la casa tiene con qué pagar.
 *
 * Lo que se prueba aquí no es aritmética: es la diferencia entre «no» y «no se
 * sabe». Una promoción que pide ConnectMiles frente a una tarjeta que no
 * declaró programa no es ni suya ni ajena, y las dos formas de resolverlo
 * mienten — descartarla esconde algo que quizá aplica, aceptarla afirma sobre
 * plata algo que nadie dijo.
 */

const visaBG = {
  type: 'credit_card',
  network: 'visa',
  program: null,
  issuerKey: 'banco_general',
} as const;

const cualquiera = {
  issuerKey: 'banco_general',
  cardTypes: [] as readonly string[],
  networks: [] as readonly string[],
  programs: [] as readonly string[],
};

describe('matches', () => {
  it('descarta lo de otro banco antes de mirar nada más', () => {
    expect(matches(visaBG, { ...cualquiera, issuerKey: 'bac' })).toBe('no');
  });

  it('deja pasar una tarjeta sin banco declarado como ajena, no como incierta', () => {
    // Sin emisor no hay nada que cruzar. Es distinto de «falta el programa»:
    // ahí sí encajaba todo lo demás.
    expect(matches({ ...visaBG, issuerKey: null }, cualquiera)).toBe('no');
  });

  it('un arreglo vacío significa «a todas»', () => {
    expect(matches(visaBG, cualquiera)).toBe('yes');
  });

  it('separa crédito de débito', () => {
    expect(matches(visaBG, { ...cualquiera, cardTypes: ['debit'] })).toBe('no');
    expect(matches(visaBG, { ...cualquiera, cardTypes: ['credit'] })).toBe('yes');
  });

  it('no le exige red a una cuenta de la que sale un débito', () => {
    // Descartarla por no declarar red sería descartar la mitad de las
    // promociones de Panamá.
    const cuenta = { type: 'checking', network: null, program: null, issuerKey: 'banco_general' };
    expect(matches(cuenta, { ...cualquiera, networks: ['visa'] })).toBe('yes');
  });

  it('sí le exige red a una tarjeta', () => {
    expect(matches(visaBG, { ...cualquiera, networks: ['mastercard'] })).toBe('no');
    expect(matches(visaBG, { ...cualquiera, networks: ['visa', 'mastercard'] })).toBe('yes');
  });

  it('acepta cuando el programa declarado es uno de los pedidos', () => {
    expect(
      matches({ ...visaBG, program: 'connectmiles' }, { ...cualquiera, programs: ['connectmiles'] }),
    ).toBe('yes');
  });

  it('descarta cuando el programa declarado es otro', () => {
    // Dos Visa Platinum del mismo banco: una acumula ConnectMiles y la otra
    // Estrellas, y «doble millas ConnectMiles» no le sirve a la segunda.
    expect(
      matches({ ...visaBG, program: 'estrellas' }, { ...cualquiera, programs: ['connectmiles'] }),
    ).toBe('no');
  });

  it('dice «no se sabe» cuando la promoción pide programa y la tarjeta no lo declaró', () => {
    expect(matches(visaBG, { ...cualquiera, programs: ['connectmiles'] })).toBe('maybe');
  });

  it('no convierte en incierta una promoción que no pide programa', () => {
    // El hueco sólo importa cuando alguien pregunta por él.
    expect(matches(visaBG, cualquiera)).toBe('yes');
  });

  it('el descarte por red gana sobre la incertidumbre del programa', () => {
    // Si ya se sabe que no aplica, no hay nada incierto que resolver, y
    // mandarla a la lista de «por confirmar» le pediría a la casa que
    // completara un dato que no cambiaría el resultado.
    expect(
      matches(visaBG, { ...cualquiera, networks: ['mastercard'], programs: ['connectmiles'] }),
    ).toBe('no');
  });
});
