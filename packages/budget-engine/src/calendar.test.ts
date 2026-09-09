import { Money, toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import {
  buildCommitmentCalendar,
  escapeText,
  foldLine,
  type CalendarCommitment,
} from './calendar.js';

const usd = (value: string) => Money.fromDecimalString(value, 'USD');
const on = (date: string) => toPlainDate(date);
const NOW = new Date('2026-09-09T16:20:00.000Z');

const money = (amount: Money) => `$${amount.toCurrencyString()}`;

const commitment = (over: Partial<CalendarCommitment> & { id: string }): CalendarCommitment => ({
  label: 'Alquiler',
  due: on('2026-09-30'),
  amount: usd('700.00'),
  isEssential: true,
  ...over,
});

const build = (commitments: readonly CalendarCommitment[], over = {}) =>
  buildCommitmentCalendar(commitments, {
    name: 'Cifraapp · Compromisos',
    now: NOW,
    formatAmount: money,
    ...over,
  });

describe('la envoltura del calendario', () => {
  it('abre y cierra un VCALENDAR con lo que un cliente necesita para suscribirse', () => {
    const ics = build([]);
    const lines = ics.split('\r\n');

    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('METHOD:PUBLISH');
    expect(lines).toContain('X-WR-CALNAME:Cifraapp · Compromisos');
    expect(lines).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT240M');
    expect(lines).toContain('X-PUBLISHED-TTL:PT240M');
    expect(lines.at(-2)).toBe('END:VCALENDAR');
  });

  it('termina cada línea en CRLF, incluida la última', () => {
    const ics = build([commitment({ id: 'a' })]);

    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    // Ningún salto suelto: un LF sin CR delante rompe media docena de clientes.
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });
});

describe('cada compromiso como evento de día completo', () => {
  it('lo fecha con VALUE=DATE y cierra el día siguiente, que es lo que dice la norma', () => {
    const ics = build([commitment({ id: 'alquiler', due: on('2026-09-30') })]);

    expect(ics).toContain('DTSTART;VALUE=DATE:20260930');
    expect(ics).toContain('DTEND;VALUE=DATE:20261001');
    // Ninguna hora inventada: no hay DTSTART con T en el evento.
    expect(ics).not.toContain('DTSTART:2026');
  });

  it('cruza el fin de mes, el fin de año y el 29 de febrero sin salirse del calendario', () => {
    expect(build([commitment({ id: 'a', due: on('2026-12-31') })])).toContain(
      'DTEND;VALUE=DATE:20270101',
    );
    expect(build([commitment({ id: 'b', due: on('2028-02-28') })])).toContain(
      'DTEND;VALUE=DATE:20280229',
    );
    expect(build([commitment({ id: 'c', due: on('2026-02-28') })])).toContain(
      'DTEND;VALUE=DATE:20260301',
    );
  });

  it('mantiene el mismo UID entre lecturas para que no se dupliquen', () => {
    const first = build([commitment({ id: 'alquiler' })]);
    const second = build([commitment({ id: 'alquiler' })], { now: new Date('2026-09-10T08:00:00.000Z') });

    expect(first).toContain('UID:alquiler@cifraapp');
    expect(second).toContain('UID:alquiler@cifraapp');
  });

  it('no marca a nadie como ocupado por deber dinero', () => {
    expect(build([commitment({ id: 'a' })])).toContain('TRANSP:TRANSPARENT');
  });

  it('pone el monto delante del nombre, porque es lo que sobrevive al recorte', () => {
    const ics = build([commitment({ id: 'a', amount: usd('700.00'), label: 'Alquiler' })]);
    expect(ics).toContain('SUMMARY:$700.00 · Alquiler');
  });

  it('marca en el título lo condicional y lo descubierto', () => {
    expect(build([commitment({ id: 'a', coverage: 'conditional' })])).toContain(
      'SUMMARY:~ $700.00 · Alquiler',
    );
    expect(build([commitment({ id: 'b', coverage: 'uncovered' })])).toContain(
      'SUMMARY:⚠ $700.00 · Alquiler',
    );
  });
});

describe('la alarma', () => {
  it('avisa el día antes, cuando todavía se puede hacer algo', () => {
    const ics = build([commitment({ id: 'a' })]);

    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-P1D');
    expect(ics).toContain('ACTION:DISPLAY');
  });

  it('se puede apagar del todo', () => {
    expect(build([commitment({ id: 'a' })], { alarmDaysBefore: 0 })).not.toContain('BEGIN:VALARM');
  });
});

describe('el escapado que la norma exige', () => {
  it('escapa la contrabarra antes que nada, para no escapar las suyas', () => {
    expect(escapeText('a\\b')).toBe('a\\\\b');
  });

  it('escapa punto y coma, coma y salto de línea', () => {
    expect(escapeText('Luz; agua, gas')).toBe('Luz\\; agua\\, gas');
    expect(escapeText('uno\ndos')).toBe('uno\\ndos');
    expect(escapeText('uno\r\ndos')).toBe('uno\\ndos');
  });

  it('lo aplica a los nombres que la casa escribió', () => {
    const ics = build([commitment({ id: 'a', label: 'Luz, agua; gas' })]);
    expect(ics).toContain('SUMMARY:$700.00 · Luz\\, agua\\; gas');
  });
});

describe('el plegado a 75 octetos', () => {
  it('deja en paz lo que ya cabe', () => {
    expect(foldLine('SUMMARY:corto')).toBe('SUMMARY:corto');
  });

  it('parte lo largo y continúa con un espacio', () => {
    const folded = foldLine(`SUMMARY:${'a'.repeat(200)}`);
    const pieces = folded.split('\r\n');

    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.slice(1).every((piece) => piece.startsWith(' '))).toBe(true);
  });

  it('mide en octetos y no en caracteres, y no parte un acento por la mitad', () => {
    // Cada «é» son dos octetos: 60 caracteres son 120 octetos y tienen que
    // plegarse, aunque contando caracteres pareciera que caben.
    const folded = foldLine(`SUMMARY:${'é'.repeat(60)}`);
    const pieces = folded.split('\r\n');

    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(new TextEncoder().encode(piece).length).toBeLessThanOrEqual(75);
    }
    // Y lo plegado, sin las continuaciones, vuelve a ser el texto original.
    const rejoined = pieces.map((piece, at) => (at === 0 ? piece : piece.slice(1))).join('');
    expect(rejoined).toBe(`SUMMARY:${'é'.repeat(60)}`);
  });

  it('mantiene todas las líneas del calendario dentro del límite', () => {
    const ics = build([
      commitment({
        id: 'largo',
        label: 'Préstamo hipotecario del apartamento en Costa del Este, cuota mensual completa',
        note: 'Sale de la cuenta corriente de Banco General el mismo día del vencimiento.',
      }),
    ]);

    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});
