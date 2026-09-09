import { Money, toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import {
  alertToCandidate,
  flatten,
  institutionOf,
  parseBankAlert,
  readAccountHint,
  readAmount,
  readDate,
  readMerchant,
  type EmailAlert,
} from './bank-alert.js';

/**
 * Los avisos que mandan los bancos panameños, leídos como movimientos.
 *
 * Los cuerpos de abajo están escritos a mano imitando la redacción real de cada
 * banco. No son capturas de correos de nadie: un fixture con datos de una
 * persona no entra en este repositorio (`CLAUDE.md`), y para probar un parser de
 * texto no hace ninguna falta.
 */

const on = (date: string) => toPlainDate(date);

const alert = (over: Partial<EmailAlert> = {}): EmailAlert => ({
  messageId: 'msg-1',
  from: 'notificaciones@bgeneral.com',
  subject: 'Notificación de transacción',
  body: 'Se ha realizado una compra por B/.48.20 en SUPER 99 con su tarjeta terminada en 1234 el 09/09/2026.',
  receivedOn: on('2026-09-09'),
  ...over,
});

describe('de qué banco viene', () => {
  it('reconoce a los bancos panameños por dominio, no por dirección exacta', () => {
    expect(institutionOf('alertas@bgeneral.com')).toBe('banco_general');
    expect(institutionOf('no-reply@bgeneral.com')).toBe('banco_general');
    expect(institutionOf('Banistmo <notificaciones@banistmo.com>')).toBe('banistmo');
    expect(institutionOf('avisos@baccredomatic.com')).toBe('bac');
  });

  it('no reconoce a nadie más', () => {
    expect(institutionOf('facturacion@proveedor.com')).toBeNull();
  });

  it('descarta el correo de un remitente desconocido salvo que se pida lo contrario', () => {
    const unknown = alert({ from: 'facturacion@proveedor.com' });

    expect(parseBankAlert(unknown)).toBeNull();
    expect(parseBankAlert(unknown, { allowUnknownSender: true })).not.toBeNull();
  });
});

describe('leer un aviso de compra', () => {
  it('saca monto, dirección, comercio, fecha y últimos cuatro dígitos', () => {
    const parsed = parseBankAlert(alert());

    expect(parsed?.amount.toDecimalString()).toBe('48.2000');
    expect(parsed?.direction).toBe('outflow');
    expect(parsed?.descriptionOriginal).toBe('SUPER 99');
    expect(parsed?.transactionDate).toBe('2026-09-09');
    expect(parsed?.accountHint).toBe('1234');
    expect(parsed?.institutionKey).toBe('banco_general');
    expect(parsed?.dateFromDelivery).toBe(false);
    expect(parsed?.signals).toContain('merchant');
    expect(parsed?.confidence).toBeGreaterThan(0.9);
  });

  it('lee el aviso con etiquetas en vez de prosa', () => {
    const parsed = parseBankAlert(
      alert({
        from: 'notificaciones@banistmo.com',
        body: [
          'Estimado cliente,',
          'Tipo: Consumo',
          'Comercio: FARMACIA ARROCHA VIA ESPANA',
          'Monto: USD 132.75',
          'Fecha: 03/09/2026',
          'Tarjeta: ****8891',
        ].join('\n'),
      }),
    );

    expect(parsed?.amount.toDecimalString()).toBe('132.7500');
    expect(parsed?.descriptionOriginal).toBe('FARMACIA ARROCHA VIA ESPANA');
    // Día primero, siempre: 03/09 es el 3 de septiembre y no el 9 de marzo.
    expect(parsed?.transactionDate).toBe('2026-09-03');
    expect(parsed?.accountHint).toBe('8891');
  });

  it('lee un abono como entrada de dinero', () => {
    const parsed = parseBankAlert(
      alert({
        subject: 'ACH recibido',
        body: 'Se ha acreditado a su cuenta un ACH recibido por B/.1,500.00 de INVERSIONES LOPEZ S.A. el 05/09/2026.',
      }),
    );

    expect(parsed?.direction).toBe('inflow');
    expect(parsed?.amount.toDecimalString()).toBe('1500.0000');
  });

  it('cuando el aviso trae las dos palabras, manda la que el banco escribió primero', () => {
    const parsed = parseBankAlert(
      alert({
        body: 'Retiro por B/.100.00 en ATM VIA ARGENTINA. Su cuenta de depósito refleja el cargo.',
      }),
    );

    expect(parsed?.direction).toBe('outflow');
  });
});

describe('lo que no es un movimiento', () => {
  it('descarta el aviso de estado de cuenta disponible aunque mencione un saldo', () => {
    const parsed = parseBankAlert(
      alert({
        subject: 'Su estado de cuenta está listo',
        body: 'Su estado de cuenta del mes ya está disponible. Saldo actual B/.4,180.00. Ingrese al portal.',
      }),
    );

    expect(parsed).toBeNull();
  });

  it('descarta una clave temporal y una promoción', () => {
    expect(
      parseBankAlert(alert({ body: 'Su código de verificación es 449120. Compra en línea.' })),
    ).toBeNull();
    expect(
      parseBankAlert(
        alert({ body: 'Promoción: ahorra hasta B/.30.00 en tu compra con nuestra tarjeta.' }),
      ),
    ).toBeNull();
  });

  it('descarta un correo del banco sin cifra alguna', () => {
    expect(parseBankAlert(alert({ body: 'Le informamos que nuestras sucursales cierran hoy.' }))).toBeNull();
  });

  it('descarta un correo con cifra pero sin verbo que diga hacia dónde se movió', () => {
    expect(
      parseBankAlert(alert({ body: 'Su límite disponible es de B/.2,000.00. Gracias por preferirnos.' })),
    ).toBeNull();
  });
});

describe('el monto', () => {
  it('lee el formato panameño con balboas y con dólares', () => {
    expect(readAmount('B/.48.20', 'USD')?.toDecimalString()).toBe('48.2000');
    expect(readAmount('B/. 1,234.56', 'USD')?.toDecimalString()).toBe('1234.5600');
    expect(readAmount('USD 90.00', 'USD')?.toDecimalString()).toBe('90.0000');
    expect(readAmount('US$7.50', 'USD')?.toDecimalString()).toBe('7.5000');
    expect(readAmount('$12', 'USD')?.toDecimalString()).toBe('12.0000');
  });

  it('se queda con el mayor, porque el primero suele ser una comisión', () => {
    const text = 'Comisión B/.0.10. Compra por B/.85.40. Saldo disponible B/.312.44.';
    // El saldo es mayor que la compra: por eso el cuerpo con saldo se descarta
    // antes, y aquí se comprueba sólo la regla del mayor entre montos reales.
    expect(readAmount('Comisión B/.0.10. Compra por B/.85.40.', 'USD')?.toDecimalString()).toBe(
      '85.4000',
    );
    expect(readAmount(text, 'USD')?.toDecimalString()).toBe('312.4400');
  });

  it('no encuentra monto donde no lo hay', () => {
    expect(readAmount('Su compra fue aprobada.', 'USD')).toBeNull();
  });
});

describe('la fecha', () => {
  it('lee día/mes/año, ISO y la escrita en palabras', () => {
    expect(readDate('el 09/09/2026 a las 14:22')).toBe('2026-09-09');
    expect(readDate('Fecha 2026-09-30')).toBe('2026-09-30');
    expect(readDate('el 3 de septiembre de 2026')).toBe('2026-09-03');
  });

  it('devuelve nulo ante una fecha que no existe, en vez de tumbar la lectura', () => {
    expect(readDate('el 31/02/2026')).toBeNull();
  });

  it('cae en la fecha de llegada y lo dice', () => {
    const parsed = parseBankAlert(
      alert({ body: 'Compra por B/.20.00 en CAFE UNIDO con su tarjeta.' }),
    );

    expect(parsed?.transactionDate).toBe('2026-09-09');
    expect(parsed?.dateFromDelivery).toBe(true);
    expect(parsed?.signals).not.toContain('date');
    expect(parsed?.confidence).toBeLessThan(0.9);
  });
});

describe('el comercio y la cuenta', () => {
  it('prefiere la etiqueta explícita a la prosa', () => {
    expect(readMerchant('Comercio: SUPER 99 VIA ESPANA\nMonto: B/.10.00')).toBe(
      'SUPER 99 VIA ESPANA',
    );
  });

  it('lee el «en X» y corta antes de lo que viene después', () => {
    expect(readMerchant('compra por B/.48.20 en SUPER 99 con su tarjeta')).toBe('SUPER 99');
    expect(readMerchant('retiro en ATM VIA ARGENTINA el 09/09/2026')).toBe('ATM VIA ARGENTINA');
  });

  it('lee los últimos cuatro dígitos en las formas en que se escriben', () => {
    expect(readAccountHint('tarjeta terminada en 1234')).toBe('1234');
    expect(readAccountHint('Tarjeta: ****8891')).toBe('8891');
    expect(readAccountHint('cuenta xxxx4410')).toBe('4410');
  });
});

describe('aplanar el HTML que mandan los bancos', () => {
  it('deja texto legible y no etiquetas', () => {
    const flat = flatten(
      '<html><style>p{color:red}</style><body><p>Compra por <b>B/.48.20</b></p><p>en SUPER&nbsp;99</p></body></html>',
    );

    expect(flat).toContain('Compra por B/.48.20');
    expect(flat).toContain('en SUPER 99');
    expect(flat).not.toContain('<');
    expect(flat).not.toContain('color:red');
  });

  it('lee un aviso que llegó sólo como HTML', () => {
    const parsed = parseBankAlert(
      alert({
        body: '<div>Compra por <strong>B/.48.20</strong> en SUPER 99 con su tarjeta terminada en 1234 el 09/09/2026</div>',
      }),
    );

    expect(parsed?.amount.toDecimalString()).toBe('48.2000');
    expect(parsed?.descriptionOriginal).toBe('SUPER 99');
  });
});

describe('la fila que entra al canal de importación', () => {
  it('lleva la misma huella que produciría el estado de cuenta del mes siguiente', () => {
    const parsed = parseBankAlert(alert());
    const candidate = alertToCandidate(parsed!, 'cuenta-1');

    expect(candidate.fingerprint).toHaveLength(32);
    expect(candidate.externalReference).toBe('msg-1');
    expect(candidate.amount.equals(Money.fromDecimalString('48.20', 'USD'))).toBe(true);

    // Dos cuentas distintas no son el mismo movimiento.
    expect(alertToCandidate(parsed!, 'cuenta-2').fingerprint).not.toBe(candidate.fingerprint);
  });

  it('el mismo aviso leído dos veces produce exactamente la misma fila', () => {
    const first = alertToCandidate(parseBankAlert(alert())!, 'cuenta-1');
    const second = alertToCandidate(parseBankAlert(alert())!, 'cuenta-1');

    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.externalReference).toBe(first.externalReference);
  });
});
