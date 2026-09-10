#!/usr/bin/env node
/**
 * G12 — Un pago a una tarjeta baja esa tarjeta y no se cuenta como gasto.
 *
 * Se ejecuta el reconocedor real. El pago tiene que encontrar su deuda por los
 * últimos cuatro o por el nombre, y **no** encontrarla por monto ni por fecha:
 * dos deudas de la casa pueden coincidir en cuota y en día, y elegir una por
 * aritmética es elegirla al azar con cara de certeza.
 */
import { Money } from '../../packages/domain/dist/index.js';
import { proposeDebt } from '../../packages/transaction-engine/dist/debt-match.js';
import { readFileSync } from 'node:fs';

const problems = [];

const visa = {
  debtId: 'visa',
  label: 'Visa Blei BG',
  counterpartyNormalized: null,
  maskedNumber: '0209',
  isCard: true,
  outstanding: Money.fromDecimalString('2600.00', 'USD'),
};

const giovanni = {
  debtId: 'giovanni',
  label: 'Préstamo de Giovanni',
  counterpartyNormalized: 'giovanni cintione',
  maskedNumber: null,
  isCard: false,
  outstanding: Money.fromDecimalString('1800.00', 'USD'),
};

const out = (text) => ({ descriptionNormalized: text, direction: 'outflow' });

if (proposeDebt(out('pago tarjeta 0209'), [visa, giovanni])?.debtId !== 'visa') {
  problems.push('un pago a la tarjeta no reconoce su tarjeta por los últimos cuatro');
}
if (proposeDebt(out('pago a giovanni cintione'), [visa, giovanni])?.debtId !== 'giovanni') {
  problems.push('un pago a una persona no reconoce su deuda por el nombre');
}
if (proposeDebt(out('pago mensual'), [visa, giovanni]) !== null) {
  problems.push('propone una deuda sin que nada la nombre');
}
if (proposeDebt({ descriptionNormalized: 'pago tarjeta 0209', direction: 'inflow' }, [visa]) !== null) {
  problems.push('propone bajar una deuda con una entrada de dinero');
}

// Y que el reconocimiento llegue a la fila, y que confirmar lo aplique.
const strip = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const service = strip(readFileSync('apps/web/src/server/import-service.ts', 'utf8'));
if (!service.includes('proposeDebt(')) {
  problems.push('la importación no reconoce pagos a deudas');
}

const confirm = strip(readFileSync('apps/web/src/server/import-actions.ts', 'utf8'));
if (!confirm.includes('applyPaymentToDebt(')) {
  problems.push('confirmar no aplica el pago a la deuda');
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('CARD PAYMENT OK');
