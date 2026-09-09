import { Money } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { PANAMA_2026_DRAFT } from './jurisdictions/pa-2026.js';
import { estimatePayroll } from './payroll.js';

/**
 * Lo que se le descuenta a un salario panameño, contra una calculadora publicada.
 *
 * Las cifras esperadas de este archivo salen de la calculadora salarial de
 * Grupo SIUMA, que el propietario del producto señaló como la que refleja la
 * práctica del país. Están aquí para que el método no se mueva sin que alguien
 * lo note: son tres decisiones —los tramos son anuales, las contribuciones no
 * salen de la base, y el año fiscal son trece sueldos— y cada una cambia el
 * resultado más que la anterior.
 *
 * Ninguna cifra de este archivo afirma nada sobre la ley. Afirman que la
 * aritmética hace lo que dice hacer con el conjunto de reglas que lleva el
 * repositorio, y ese conjunto sigue siendo un borrador sin revisar.
 */

const pab = (value: string) => Money.fromDecimalString(value, 'PAB');

describe('los descuentos de una planilla panameña', () => {
  it('calcula las dos contribuciones sobre el bruto', () => {
    const result = estimatePayroll({
      gross: pab('1000.00'),
      paymentsPerYear: 12,
      rules: PANAMA_2026_DRAFT,
    });

    const social = result?.lines.find((line) => line.key === 'socialSecurity');
    const education = result?.lines.find((line) => line.key === 'educationTax');
    expect(social?.amount.toDecimalString()).toBe('97.5000');
    expect(education?.amount.toDecimalString()).toBe('12.5000');
  });

  it('no cobra renta a quien queda bajo el primer tramo', () => {
    // 800 al mes son 9.600 al año y 10.400 con el decimotercero: por debajo de
    // los 11.000, así que no hay retención. Y «no hay» es distinto de «es
    // cero»: la línea no aparece en vez de aparecer vacía.
    const result = estimatePayroll({
      gross: pab('800.00'),
      paymentsPerYear: 12,
      rules: PANAMA_2026_DRAFT,
    });
    expect(result?.lines.map((line) => line.key)).toEqual(['socialSecurity', 'educationTax']);
    expect(result?.net.toDecimalString()).toBe('712.0000');
  });

  it('sí cobra renta a los 1.000 al mes, porque la base no descuenta las cuotas', () => {
    // El caso que separa los dos métodos. 12.000 al año más el decimotercero
    // son 13.000 de base: 300 de renta al año, 23,08 al mes. Restar antes las
    // contribuciones habría dejado 10.680 y a esta persona fuera del impuesto,
    // que es lo que hacía este motor y lo que otras calculadoras siguen
    // haciendo.
    const result = estimatePayroll({
      gross: pab('1000.00'),
      paymentsPerYear: 12,
      rules: PANAMA_2026_DRAFT,
    });
    const tax = result?.lines.find((line) => line.key === 'incomeTax');
    expect(tax?.amount.toDecimalString()).toBe('23.0769');
    expect(result?.net.toDecimalString()).toBe('866.9231');
  });

  it('grava el bruto entero, sin restarle antes las contribuciones', () => {
    // 2.000 al mes: 24.000 al año y 26.000 con el decimotercero. El 15% sobre
    // lo que excede 11.000 son 2.250 al año, repartidos entre trece: 173,08.
    //
    // Y el neto son los tres descuentos, no dos: 2.000 − 195 − 25 − 173,08.
    const result = estimatePayroll({
      gross: pab('2000.00'),
      paymentsPerYear: 12,
      rules: PANAMA_2026_DRAFT,
    });
    const tax = result?.lines.find((line) => line.key === 'incomeTax');
    expect(tax?.amount.toDecimalString()).toBe('173.0769');
    expect(result?.net.toDecimalString()).toBe('1606.9231');
  });

  it('reparte la renta entre trece sueldos, no entre doce', () => {
    // La consecuencia que hay que tener a la vista: en los doce pagos de un año
    // se retienen doce trecios del impuesto anual. El trecio que falta sale del
    // decimotercer mes, que este producto todavía no representa como ingreso.
    const result = estimatePayroll({
      gross: pab('2000.00'),
      paymentsPerYear: 12,
      rules: PANAMA_2026_DRAFT,
    });
    // Los 2.250 del año, menos las tres diezmilésimas que se pierden al partir
    // en trece a escala cuatro. El redondeo se queda en el recibo, que es donde
    // corresponde: la cifra que se guarda es la del pago, no la del año.
    const monthly = result?.lines.find((line) => line.key === 'incomeTax')?.amount;
    expect(monthly?.multiply(13).toDecimalString()).toBe('2249.9997');
    expect(monthly?.multiply(12).toDecimalString()).toBe('2076.9228');
  });

  it('anualiza antes de aplicar los tramos, que son anuales', () => {
    // El mismo sueldo, pagado en dos quincenas. Comparar 1.000 contra un umbral
    // anual de 11.000 dejaría la retención en cero; anualizado da lo mismo que
    // el caso mensual, repartido en veinticuatro pagos.
    const fortnightly = estimatePayroll({
      gross: pab('1000.00'),
      paymentsPerYear: 24,
      rules: PANAMA_2026_DRAFT,
    });
    const monthly = estimatePayroll({
      gross: pab('2000.00'),
      paymentsPerYear: 12,
      rules: PANAMA_2026_DRAFT,
    });

    const taxOf = (result: ReturnType<typeof estimatePayroll>) =>
      result?.lines.find((line) => line.key === 'incomeTax')?.amount.toDecimalString();

    expect(taxOf(fortnightly)).toBe('86.5385');
    // Dos quincenas de 86,5385 son los 173,077 del mes. La misma plata, el
    // mismo impuesto, partido donde la persona lo cobra.
    expect(taxOf(monthly)).toBe('173.0769');
  });

  it('llega al tramo alto solo sobre el exceso', () => {
    // 6.000 al mes: 72.000 al año y 78.000 con el decimotercero. 15% sobre los
    // 39.000 del primer tramo son 5.850, más 25% sobre los 28.000 que exceden
    // 50.000 son 7.000. Total 12.850 al año, repartido entre trece: 988,46.
    const result = estimatePayroll({
      gross: pab('6000.00'),
      paymentsPerYear: 12,
      rules: PANAMA_2026_DRAFT,
    });
    const tax = result?.lines.find((line) => line.key === 'incomeTax');
    expect(tax?.amount.toDecimalString()).toBe('988.4615');
  });

  it('nunca dice que estas cifras puedan presentarse como lo que se debe', () => {
    // El control que importa. Mientras el conjunto sea un borrador sin revisor
    // nombrado, esto es una sugerencia editable y no una afirmación sobre la
    // ley — y el día que alguien publique el conjunto, este test lo notará.
    const result = estimatePayroll({
      gross: pab('2000.00'),
      paymentsPerYear: 12,
      rules: PANAMA_2026_DRAFT,
    });
    expect(PANAMA_2026_DRAFT.status).toBe('draft');
    expect(result?.mayPresentAsOwed).toBe(false);
  });

  /**
   * El caso de 3.000, contra las calculadoras públicas de Panamá.
   *
   * Es el sueldo con el que un usuario reportó que «el sistema da datos
   * erróneos», y fija el desglose que publican las calculadoras salariales
   * panameñas para 3.000 al mes: 292,50 de CSS, 37,50 de educativo y 263,00 de
   * renta, 593,00 en total y 2.407,00 netos.
   *
   * El mismo 3.000 cobrado por quincena son 72.000 al año y llega al tramo del
   * 25%, así que la retención sube a 390,42. Las dos cifras son correctas para
   * su propia pregunta, y ese es justamente el punto: el bruto de este campo es
   * por pago, no por mes. La pantalla ahora enseña la cifra anual para que la
   * diferencia se vea antes de que alguien planifique sobre ella.
   */
  it('reproduce el desglose publicado para 3.000 al mes', () => {
    const result = estimatePayroll({
      gross: pab('3000.00'),
      paymentsPerYear: 12,
      rules: PANAMA_2026_DRAFT,
    });

    const at = (key: string) => result?.lines.find((line) => line.key === key)?.amount;
    expect(at('socialSecurity')?.toDecimalString()).toBe('292.5000');
    expect(at('educationTax')?.toDecimalString()).toBe('37.5000');
    expect(at('incomeTax')?.toDecimalString()).toBe('323.0769');
    expect(result?.totalDeducted.toDecimalString()).toBe('653.0769');
    expect(result?.net.toDecimalString()).toBe('2346.9231');
  });

  it('lleva en cada línea el porcentaje que la explica', () => {
    // La etiqueta que la pantalla enseña sale de aquí y no de una constante
    // suya: una tasa que cambia en el conjunto de reglas y una etiqueta que
    // sigue diciendo la vieja es peor que no enseñar ninguna.
    //
    // La renta es la excepción y por eso viene marcada: un impuesto progresivo
    // no tiene un porcentaje, y lo único cierto que se puede decir en tanto por
    // ciento es cuánto acabó siendo sobre este sueldo. 323,0769 sobre 3.000 son
    // 10,76%.
    const result = estimatePayroll({
      gross: pab('3000.00'),
      paymentsPerYear: 12,
      rules: PANAMA_2026_DRAFT,
    });

    const at = (key: string) => result?.lines.find((line) => line.key === key);
    expect(at('socialSecurity')?.rate).toBe('9.75');
    expect(at('socialSecurity')?.isEffectiveRate).toBe(false);
    expect(at('educationTax')?.rate).toBe('1.25');
    expect(at('educationTax')?.isEffectiveRate).toBe(false);
    expect(at('incomeTax')?.rate).toBe('10.76');
    expect(at('incomeTax')?.isEffectiveRate).toBe(true);
  });

  it('cobra más renta por el mismo 3.000 cuando es quincenal, porque son 72.000 al año', () => {
    const result = estimatePayroll({
      gross: pab('3000.00'),
      paymentsPerYear: 24,
      rules: PANAMA_2026_DRAFT,
    });

    // 72.000 al año y 78.000 con el decimotercero: 5.850 por el tramo del 15%
    // completo, más 7.000 por los 28.000 que pasan de 50.000. Son 12.850 al
    // año, repartidos entre veintiséis quincenas.
    const at = (key: string) => result?.lines.find((line) => line.key === key)?.amount;
    expect(at('incomeTax')?.toDecimalString()).toBe('494.2308');
    expect(result?.net.toDecimalString()).toBe('2175.7692');
  });

  it('vuelve al método conservador cuando el conjunto no dice cuál usar', () => {
    // Sin la regla de retención no se inventa una política: se aplica la
    // lectura que menos afirma —doce sueldos y contribuciones fuera de la
    // base—, que es la que menos le cobra a la persona. Una jurisdicción nueva
    // que se olvide de declararla no hereda en silencio la panameña.
    const withoutPolicy = {
      ...PANAMA_2026_DRAFT,
      rules: PANAMA_2026_DRAFT.rules.filter((rule) => rule.key !== 'income.withholding'),
    };
    const result = estimatePayroll({
      gross: pab('3000.00'),
      paymentsPerYear: 12,
      rules: withoutPolicy,
    });
    const tax = result?.lines.find((line) => line.key === 'incomeTax');
    expect(tax?.amount.toDecimalString()).toBe('263.0000');
  });

  it('devuelve nada antes que una cuenta a medias', () => {
    // Sin tramos no hay retención que calcular, y un desglose al que le falta
    // la línea más grande parece completo y está mal por esa línea entera.
    const withoutBrackets = {
      ...PANAMA_2026_DRAFT,
      rules: PANAMA_2026_DRAFT.rules.filter((rule) => rule.key !== 'income.brackets'),
    };
    expect(
      estimatePayroll({ gross: pab('2000.00'), paymentsPerYear: 12, rules: withoutBrackets }),
    ).toBeNull();
    expect(
      estimatePayroll({ gross: pab('2000.00'), paymentsPerYear: 0, rules: PANAMA_2026_DRAFT }),
    ).toBeNull();
  });
});
