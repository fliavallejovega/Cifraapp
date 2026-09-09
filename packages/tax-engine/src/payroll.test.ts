import { Money } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { PANAMA_2026_DRAFT } from './jurisdictions/pa-2026.js';
import { estimatePayroll } from './payroll.js';

/**
 * Lo que se le descuenta a un salario, y los dos errores que arruinan la cuenta.
 *
 * El primero es aplicar la renta sobre el bruto en vez de sobre lo que queda
 * después de las contribuciones: sobreestima la retención en todos los sueldos
 * y más cuanto más alto es. El segundo es comparar una quincena contra un tramo
 * anual, que dejaría a casi todo Panamá en cero de un impuesto que sí paga.
 *
 * Ninguna cifra de este archivo afirma nada sobre la ley. Afirman que la
 * aritmética hace lo que dice hacer con las tasas que el conjunto de reglas
 * lleva, y el conjunto sigue siendo un borrador sin revisar.
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
    // 1.000 al mes son 12.000 al año, menos 1.320 de contribuciones son 10.680
    // gravables — por debajo del umbral, así que no hay retención. Y «no hay»
    // es distinto de «es cero»: la línea no aparece en vez de aparecer vacía.
    const result = estimatePayroll({
      gross: pab('1000.00'),
      paymentsPerYear: 12,
      rules: PANAMA_2026_DRAFT,
    });
    expect(result?.lines.map((line) => line.key)).toEqual(['socialSecurity', 'educationTax']);
    expect(result?.net.toDecimalString()).toBe('890.0000');
  });

  it('grava lo que queda después de las contribuciones, no el bruto', () => {
    // 2.000 al mes: 24.000 al año, menos 2.340 de CSS y 300 de educativo son
    // 21.360 gravables. El 15% sobre lo que excede 11.000 son 1.554 al año,
    // 129,50 al mes. Sobre el bruto habrían sido 1.950 al año — un 25% más de
    // retención por hacer la resta en el orden equivocado.
    //
    // Y el neto son los tres descuentos, no dos: 2.000 − 195 − 25 − 129,50.
    const result = estimatePayroll({
      gross: pab('2000.00'),
      paymentsPerYear: 12,
      rules: PANAMA_2026_DRAFT,
    });
    const tax = result?.lines.find((line) => line.key === 'incomeTax');
    expect(tax?.amount.toDecimalString()).toBe('129.5000');
    expect(result?.net.toDecimalString()).toBe('1650.5000');
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

    expect(taxOf(fortnightly)).toBe('64.7500');
    // Dos quincenas de 64,75 son los 129,50 del mes. La misma plata, el mismo
    // impuesto, partido donde la persona lo cobra.
    expect(taxOf(monthly)).toBe('129.5000');
  });

  it('llega al tramo alto solo sobre el exceso', () => {
    // 6.000 al mes: 72.000 al año, menos 7.020 de CSS y 900 de educativo son
    // 64.080 gravables. 15% sobre los 39.000 del primer tramo son 5.850, más
    // 25% sobre los 14.080 que exceden 50.000 son 3.520. Total 9.370 al año,
    // 780,83 al mes.
    const result = estimatePayroll({
      gross: pab('6000.00'),
      paymentsPerYear: 12,
      rules: PANAMA_2026_DRAFT,
    });
    const tax = result?.lines.find((line) => line.key === 'incomeTax');
    expect(tax?.amount.toDecimalString()).toBe('780.8333');
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
    expect(at('incomeTax')?.toDecimalString()).toBe('263.0000');
    expect(result?.totalDeducted.toDecimalString()).toBe('593.0000');
    expect(result?.net.toDecimalString()).toBe('2407.0000');
  });

  it('cobra más renta por el mismo 3.000 cuando es quincenal, porque son 72.000 al año', () => {
    const result = estimatePayroll({
      gross: pab('3000.00'),
      paymentsPerYear: 24,
      rules: PANAMA_2026_DRAFT,
    });

    // 72.000 menos 7.020 de CSS y 900 de educativo son 64.080 gravables: 5.850
    // por el tramo del 15% completo, más 3.520 por los 14.080 que pasan de
    // 50.000. Son 9.370 al año, 390,4166… por quincena.
    const at = (key: string) => result?.lines.find((line) => line.key === key)?.amount;
    expect(at('incomeTax')?.toDecimalString()).toBe('390.4167');
    expect(result?.net.toDecimalString()).toBe('2279.5833');
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
