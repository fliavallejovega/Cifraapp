import { toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { compareCards, readRate, type CardOffer } from './card-compare.js';

const on = (date: string) => toPlainDate(date);
const TODAY = on('2026-09-10');

const offer = (over: Partial<CardOffer> & { cardId: string }): CardOffer => ({
  cardName: 'Una tarjeta',
  issuerName: 'Banco',
  network: 'visa',
  headline: '1% de devolución',
  detail: null,
  kind: 'cashback',
  isVerified: true,
  capturedOn: on('2026-09-01'),
  validUntil: null,
  isOwned: true,
  ...over,
});

describe('leer la cifra de una frase', () => {
  it('lee un porcentaje escrito de las formas en que se escribe', () => {
    expect(readRate('5% de devolución')).toBe(5);
    expect(readRate('hasta 7 % mensual')).toBe(7);
    expect(readRate('2,5% en farmacias')).toBe(2.5);
    expect(readRate('50% de descuento en el total')).toBe(50);
  });

  it('entiende que un 2x1 es medio precio', () => {
    expect(readRate('2x1 en Friday’s')).toBe(50);
    expect(readRate('2 X 1')).toBe(50);
  });

  it('se niega ante lo que no declara una cifra comparable', () => {
    // Cuánto vale una milla depende de a dónde vuele la persona, no de este código.
    expect(readRate('millas dobles de bienvenida')).toBeNull();
    expect(readRate('acceso a salas VIP')).toBeNull();
    expect(readRate('3 puntos por cada dólar')).toBeNull();
  });

  it('descarta una cifra que no puede ser un descuento', () => {
    expect(readRate('10,000 puntos de bienvenida')).toBeNull();
    expect(readRate('120% de algo')).toBeNull();
    expect(readRate('0% de devolución')).toBeNull();
  });
});

describe('ordenar por lo que la fuente dijo', () => {
  it('pone delante la cifra más alta', () => {
    const result = compareCards(
      [
        offer({ cardId: 'a', cardName: 'Uno por ciento', headline: '1% de devolución' }),
        offer({ cardId: 'b', cardName: 'Cinco por ciento', headline: '5% en supermercados' }),
        offer({ cardId: 'c', cardName: 'Dos por ciento', headline: '2% en todo' }),
      ],
      'supermercados',
      TODAY,
    );

    expect(result.ranked.map((one) => one.cardName)).toEqual([
      'Cinco por ciento',
      'Dos por ciento',
      'Uno por ciento',
    ]);
    expect(result.best?.cardName).toBe('Cinco por ciento');
    expect(result.ranked[0]?.position).toBe(1);
  });

  it('a igual cifra, gana lo que una persona confirmó', () => {
    const result = compareCards(
      [
        offer({ cardId: 'a', cardName: 'Leída por el barrido', isVerified: false }),
        offer({ cardId: 'b', cardName: 'Confirmada', isVerified: true }),
      ],
      'restaurantes',
      TODAY,
    );

    expect(result.ranked[0]?.cardName).toBe('Confirmada');
  });

  it('y después, la que la casa ya tiene', () => {
    const result = compareCards(
      [
        offer({ cardId: 'a', cardName: 'De otro banco', isOwned: false }),
        offer({ cardId: 'b', cardName: 'Mía', isOwned: true }),
      ],
      'restaurantes',
      TODAY,
    );

    expect(result.ranked[0]?.cardName).toBe('Mía');
  });
});

describe('lo que se niega a ordenar', () => {
  it('no entierra como perdedora una tarjeta sin cifra', () => {
    const result = compareCards(
      [
        offer({ cardId: 'a', cardName: 'Con cifra', headline: '1% de devolución' }),
        offer({ cardId: 'b', cardName: 'Sin cifra', headline: 'Millas por cada compra' }),
      ],
      'viajes',
      TODAY,
    );

    // La sin cifra no está detrás de la del 1%: está en otro grupo, porque
    // «no se sabe» y «da menos» son cosas distintas.
    expect(result.ranked.map((one) => one.cardName)).toEqual(['Con cifra']);
    expect(result.unquantified.map((one) => one.cardName)).toEqual(['Sin cifra']);
    expect(result.unquantified[0]?.reason).toBe('unquantified');
  });

  it('aparta lo vencido en vez de compararlo', () => {
    const result = compareCards(
      [
        offer({ cardId: 'a', headline: '50% de descuento', validUntil: on('2026-08-31') }),
        offer({ cardId: 'b', headline: '1% de devolución' }),
      ],
      'restaurantes',
      TODAY,
    );

    expect(result.expired).toHaveLength(1);
    expect(result.expired[0]?.reason).toBe('expired');
    // Y el 50% vencido no gana la comparación por ser el número más grande.
    expect(result.best?.rate).toBe(1);
  });

  it('no corona a nadie cuando ninguna cifra lo sostiene', () => {
    const result = compareCards(
      [offer({ cardId: 'a', headline: 'Acceso a salas VIP' })],
      'viajes',
      TODAY,
    );

    expect(result.best).toBeNull();
    expect(result.ranked).toEqual([]);
    expect(result.isEmpty).toBe(false);
  });

  it('dice cuando no hay nada que comparar', () => {
    const result = compareCards([], 'salud', TODAY);
    expect(result.isEmpty).toBe(true);
    expect(result.best).toBeNull();
  });
});
