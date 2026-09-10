import { describe, expect, it } from 'vitest';

import { optionalPlainDate, optionalText, optionalUuid } from './record-input';

/**
 * Lo que pasa cuando un formulario simplemente no trae un campo.
 *
 * `formData.get('notes')` devuelve `null`, no `undefined` ni `''`. Un validador
 * que sólo contempla la cadena vacía rechaza el `null`, y como los campos
 * opcionales no están en el mapa de errores de ningún formulario, la persona ve
 * «Falta algo o hay un dato que no entendimos» sin nada marcado — el peor error
 * posible, porque no dice qué arreglar.
 *
 * Pasó de verdad: el formulario de pago dentro de una tarjeta no tiene campo de
 * notas, y por eso no se podía guardar ningún pago.
 */

const OMITTED = [null, undefined, '', '   '];

describe('campos opcionales', () => {
  it('optionalText acepta un campo que no vino', () => {
    for (const value of OMITTED) {
      const parsed = optionalText.safeParse(value);
      expect(parsed.success, `falló con ${JSON.stringify(value)}`).toBe(true);
      if (parsed.success) expect(parsed.data).toBeUndefined();
    }
  });

  it('optionalUuid acepta un campo que no vino', () => {
    for (const value of OMITTED.slice(0, 3)) {
      expect(optionalUuid.safeParse(value).success).toBe(true);
    }
  });

  it('optionalPlainDate acepta un campo que no vino', () => {
    for (const value of OMITTED.slice(0, 3)) {
      expect(optionalPlainDate.safeParse(value).success).toBe(true);
    }
  });

  it('sigue aceptando un valor de verdad', () => {
    const parsed = optionalText.safeParse('  el taxi al aeropuerto  ');
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe('el taxi al aeropuerto');
  });

  it('sigue rechazando lo que no es texto', () => {
    expect(optionalText.safeParse(42).success).toBe(false);
    expect(optionalUuid.safeParse('no-soy-un-uuid').success).toBe(false);
  });
});
