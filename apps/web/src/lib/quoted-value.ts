import { formatMoney, Money, type CurrencyCode, type MoneyLocale } from '@app/domain';

/**
 * Cuánto vale lo que se está tecleando, al precio de mercado de ahora.
 *
 * Es tranquilidad mientras se escribe: ver «0.5 × $78,490 = $39,245» al lado
 * del campo es lo que confirma que la cantidad significa lo que la persona
 * cree. Sin eso, un cero de más en una cripto no se nota hasta que el total de
 * la cartera está mal.
 *
 * ## Aritmética exacta, no flotante
 *
 * Un precio de ocho decimales por una cantidad de diez no cabe en un `number`
 * sin perder centavos, y `CLAUDE.md` lo prohíbe con todas sus letras. Se
 * multiplica en enteros escalados y sólo al final se convierte a `Money`, que
 * es exactamente lo que hace `valueOf` en el paquete de datos de mercado.
 *
 * Que sea la misma aritmética importa más que la exactitud en sí: la vista
 * previa del formulario y el total que la cartera enseña después salen del
 * mismo cálculo, así que no pueden discrepar por un centavo y dejar a alguien
 * preguntándose cuál de las dos miente.
 */

/** Doce decimales de precisión intermedia: ocho del precio más diez de la cantidad. */
const SCALE = 10n ** 12n;

/** Una cadena decimal a enteros escalados, sin pasar por un flotante. */
function toScaled(value: string): bigint {
  const clean = value.trim();
  if (!/^\d*(\.\d*)?$/.test(clean) || clean === '' || clean === '.') return 0n;

  const [whole = '0', fraction = ''] = clean.split('.');
  // Truncar y no redondear: lo que sobra de doce decimales no es dinero de
  // nadie, y redondear hacia arriba inventaría una fracción de centavo.
  const padded = fraction.padEnd(12, '0').slice(0, 12);
  return BigInt(whole || '0') * SCALE + BigInt(padded || '0');
}

/** Vuelve a decimal con cuatro cifras, que es la escala en que este sistema guarda dinero. */
function toMoneyString(units: bigint): string {
  const divisor = SCALE * SCALE;
  const whole = units / divisor;
  const remainder = units % divisor;
  const fraction = (remainder * 10_000n) / divisor;
  return `${whole.toString()}.${fraction.toString().padStart(4, '0')}`;
}

/**
 * El valor de una cantidad a un precio, ya formateado — o nulo.
 *
 * Nulo cuando falta la cantidad o el precio, o cuando lo tecleado todavía no es
 * un número. Devolver «$0.00» mientras alguien escribe es peor que no decir
 * nada: parece una respuesta.
 */
export function quotedValue(
  quantity: string,
  price: string,
  currency: string,
  locale: MoneyLocale = 'es-PA',
): string | null {
  const units = toScaled(quantity) * toScaled(price);
  if (units === 0n) return null;

  return formatMoney(Money.fromDecimalString(toMoneyString(units), currency as CurrencyCode), {
    locale,
    showCode: true,
  });
}

/**
 * Un precio como lo lee una persona.
 *
 * Los ceros de la derecha se van —un precio de `316.22000000` es `316.22`— pero
 * nunca por debajo de dos decimales, porque `78490.0` se lee como una cifra
 * truncada y `78,490.00` como un precio.
 */
export function readablePrice(price: string): string {
  const trimmed = price.includes('.') ? price.replace(/0+$/, '').replace(/\.$/, '') : price;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return `${Number(whole).toLocaleString('en-US')}.${fraction.padEnd(2, '0')}`;
}
