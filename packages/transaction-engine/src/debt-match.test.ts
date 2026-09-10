import { Money } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { proposeDebt, type DebtTarget } from './debt-match.js';

/**
 * Lo que se prueba aquí es sobre todo cuándo **no** se propone.
 *
 * Equivocarse de deuda mueve plata de un saldo a otro sin que nadie lo note. Una
 * propuesta de más se desmarca en un segundo; una propuesta equivocada que
 * alguien confirma sin mirar deja dos saldos mal y ningún rastro de por qué.
 */

const giovanni: DebtTarget = {
  debtId: 'debt-giovanni',
  label: 'Préstamo de Giovanni',
  counterpartyNormalized: 'giovanni cintione',
  maskedNumber: null,
  isCard: false,
  outstanding: Money.fromDecimalString('1800.00', 'USD'),
};

const visa: DebtTarget = {
  debtId: 'debt-visa',
  label: 'Visa Blei BG',
  counterpartyNormalized: null,
  maskedNumber: '0209',
  isCard: true,
  outstanding: Money.fromDecimalString('2600.00', 'USD'),
};

const out = (descriptionNormalized: string) =>
  ({ descriptionNormalized, direction: 'outflow' }) as const;

describe('proposeDebt', () => {
  it('reconoce a la contraparte nombrada en el concepto', () => {
    const proposal = proposeDebt(out('pago a giovanni cintione'), [giovanni, visa]);

    expect(proposal?.debtId).toBe('debt-giovanni');
    expect(proposal?.because).toBe('counterparty_named');
  });

  it('la reconoce con la basura que los bancos meten en el medio', () => {
    // «GIOVANNI C CINTIONE REF 8891» es como se ve de verdad.
    const proposal = proposeDebt(out('transf giovanni c cintione ref 8891'), [giovanni]);
    expect(proposal?.debtId).toBe('debt-giovanni');
  });

  it('no la reconoce cuando falta parte del nombre', () => {
    // «giovanni» solo puede ser otro Giovanni. Sin el apellido no se propone, y
    // la fila llega a la revisión sin deuda preseleccionada en vez de con la
    // equivocada.
    expect(proposeDebt(out('pago a giovanni'), [giovanni])).toBeNull();
  });

  it('reconoce una tarjeta por sus últimos cuatro', () => {
    const proposal = proposeDebt(out('pago tarjeta 0209'), [giovanni, visa]);

    expect(proposal?.debtId).toBe('debt-visa');
    expect(proposal?.because).toBe('card_digits');
  });

  it('no confunde cuatro dígitos dentro de un número más largo', () => {
    // Una referencia de transferencia trae dígitos todo el tiempo.
    expect(proposeDebt(out('transf ref 902094411'), [visa])).toBeNull();
  });

  it('no propone una deuda que no es tarjeta por cuatro dígitos sueltos', () => {
    const suelta: DebtTarget = { ...giovanni, maskedNumber: '0209', isCard: false };
    expect(proposeDebt(out('pago 0209'), [suelta])).toBeNull();
  });

  it('reconoce una tarjeta por el nombre que la casa le puso', () => {
    const proposal = proposeDebt(out('pago visa blei bg'), [visa]);
    expect(proposal?.because).toBe('card_named');
  });

  it('NUNCA propone sobre una entrada de dinero', () => {
    // Una entrada no baja una deuda: la sube, o es otra cosa. En los dos casos
    // no es esto.
    expect(
      proposeDebt(
        { descriptionNormalized: 'pago a giovanni cintione', direction: 'inflow' },
        [giovanni],
      ),
    ).toBeNull();
  });

  it('no propone por monto ni por fecha', () => {
    // Dos deudas de la casa pueden coincidir en cuota y en día; elegir una por
    // aritmética es elegirla al azar con cara de certeza. Sin el nombre en el
    // texto, nada.
    expect(proposeDebt(out('pago mensual'), [giovanni, visa])).toBeNull();
  });

  it('exige un nombre de largo suficiente', () => {
    // «Ana» aparecería dentro de media docena de comercios.
    const ana: DebtTarget = { ...giovanni, counterpartyNormalized: 'ana', debtId: 'd-ana' };
    expect(proposeDebt(out('compra en anaranjado'), [ana])).toBeNull();
  });

  it('compara palabras completas y no fragmentos', () => {
    const store: DebtTarget = { ...giovanni, counterpartyNormalized: 'giovanni' };
    expect(proposeDebt(out('compra en giovannistore'), [store])).toBeNull();
  });

  it('la contraparte gana sobre la tarjeta cuando las dos aparecen', () => {
    // La deuda con nombre propio es la que menos formas tiene de aparecer en un
    // estado de cuenta; cuando aparece, es la señal más fuerte.
    const proposal = proposeDebt(out('pago giovanni cintione con visa blei bg'), [visa, giovanni]);
    expect(proposal?.debtId).toBe('debt-giovanni');
  });

  it('no se cae sin deudas ni con descripción vacía', () => {
    expect(proposeDebt(out('cualquier cosa'), [])).toBeNull();
    expect(proposeDebt(out('   '), [giovanni])).toBeNull();
  });
});
