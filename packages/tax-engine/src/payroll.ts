import { Money, type CurrencyCode } from '@app/domain';

import { applyBrackets } from './estimate.js';
import { findRule } from './rules.js';
import type { TaxRuleSet } from './types.js';

/**
 * What comes off a salary before it is paid, computed from the rule set.
 *
 * ## What this is for, and what it is not for
 *
 * It exists so a household does not have to transcribe three numbers off a
 * payslip by hand. It fills the fields; the person confirms them against the
 * paper in front of them and corrects whatever does not match. That
 * confirmation is the whole design: the figure that ends up stored is the
 * household's statement about their own pay, and this function's job is to make
 * that statement quick to produce rather than to replace it.
 *
 * It is **not** a filing figure and it is not what anybody owes. The rule set
 * it reads is a draft nobody qualified has reviewed, `mayPresent()` is false
 * for it, and none of that changes here. A caller that shows these numbers as
 * settled tax is misusing them, which is why they come back labelled as an
 * estimate with the rule keys they came from attached.
 *
 * ## The order of operations, which is where this goes wrong
 *
 * The bands are annual, so a fortnightly salary has to be annualised, taxed and
 * divided back down: applying an annual threshold to a fortnight would exempt
 * almost everybody from a tax they actually pay. That part is arithmetic and is
 * true everywhere.
 *
 * What is *not* arithmetic — and what two public Panamanian calculators answer
 * differently — is whether the social contributions come out of the base before
 * the bands apply, and how many salaries make up the fiscal year where a
 * thirteenth month exists. Both are policy, both change the result by more than
 * the bands do, and both are read from the rule set here rather than decided in
 * this file. See `income.withholding` in the Panamanian set for which way it was
 * answered and on whose authority.
 */

export interface PayrollLine {
  /** The rule this came from, so a screen can cite it. */
  readonly ruleKey: string;
  /** A stable key the app maps to its own translated label. */
  readonly key: 'socialSecurity' | 'educationTax' | 'incomeTax';
  readonly amount: Money;
  /**
   * El porcentaje que explica esta línea, para que la etiqueta pueda decirlo.
   *
   * Sale del conjunto de reglas y no de una constante en la pantalla: una tasa
   * que cambia y una etiqueta que no la sigue es peor que no mostrar ninguna.
   * Con hasta dos decimales, que es como se cita.
   */
  readonly rate: string;
  /**
   * Si esa tasa es la de la ley o la que le tocó a esta persona.
   *
   * La renta es progresiva: no tiene un porcentaje, tiene una tabla. Lo que se
   * puede decir de ella es cuánto acabó siendo sobre este sueldo en concreto, y
   * llamarlo «9,75%» como a las otras dos sería afirmar una tasa que no existe.
   */
  readonly isEffectiveRate: boolean;
}

export interface PayrollEstimate {
  readonly gross: Money;
  readonly lines: readonly PayrollLine[];
  readonly totalDeducted: Money;
  /** Gross minus everything above. What actually reaches an account. */
  readonly net: Money;
  /**
   * False when the rule set has not been reviewed, which is every set today.
   *
   * Carried so the caller cannot forget: it decides whether these numbers may
   * be *presented* as owed, and the answer is no. Prefilling an editable field
   * is a different act and stays allowed.
   */
  readonly mayPresentAsOwed: boolean;
}

export interface PayrollInput {
  readonly gross: Money;
  /**
   * How many times a year this salary is paid.
   *
   * Needed because the tax bands are annual. Twenty-four for a twice-monthly
   * salary, twelve for a monthly one, twenty-six for a fortnightly one.
   */
  readonly paymentsPerYear: number;
  readonly rules: TaxRuleSet;
}

/**
 * Una tasa como se cita, sin ceros de relleno. `9.750` → `9.75`, `7.000` → `7`.
 *
 * El conjunto de reglas las guarda con tres decimales porque una tasa puede
 * tenerlos; una etiqueta que dice «Seguro social (9.750%)» se lee como un error
 * del sistema.
 */
const asPercent = (rate: string): string => String(Number(rate));

/**
 * Lo que la renta acabó siendo sobre este sueldo, en porcentaje.
 *
 * No es una tasa de la ley: es el cociente entre lo retenido y el bruto, que es
 * la única cifra en porcentaje que se puede decir con verdad de un impuesto
 * progresivo. Dos decimales, y cero cuando no hay bruto contra el que dividir.
 */
const effectiveRate = (tax: Money, gross: Money): string => {
  if (!gross.isPositive()) return '0';
  // En unidades enteras, como el resto del paquete: dividir dos importes en
  // coma flotante para enseñar un porcentaje es la puerta de atrás por la que
  // vuelve la aritmética que este proyecto no usa con dinero.
  const hundredths = (tax.scaledUnits * 10_000n) / gross.scaledUnits;
  return String(Number(hundredths) / 100);
};

/** A rate rule, or null when the set does not carry one. */
function flatRate(set: TaxRuleSet, key: string): string | null {
  const rule = findRule(set, key);
  return rule?.kind === 'flat_rate' ? rule.rate : null;
}

/**
 * The deductions on one paycheck.
 *
 * Returns null when the rule set is missing something it needs, rather than
 * computing around the gap. A withholding estimate that silently skipped income
 * tax because the brackets were absent would look complete and be wrong by the
 * largest line on the slip.
 */
export function estimatePayroll(input: PayrollInput): PayrollEstimate | null {
  const { gross, rules, paymentsPerYear } = input;
  if (!Number.isInteger(paymentsPerYear) || paymentsPerYear <= 0) return null;
  if (gross.isNegative()) return null;

  const socialRate = flatRate(rules, 'social_security.employee');
  const educationRate = flatRate(rules, 'social_security.education_employee');
  const bracketRule = findRule(rules, 'income.brackets');
  if (!socialRate || !educationRate || bracketRule?.kind !== 'brackets') return null;

  const currency: CurrencyCode = gross.currency;
  const zero = Money.zero(currency);

  const social = gross.percentage(socialRate);
  const education = gross.percentage(educationRate);

  /**
   * The tax, computed on the year and brought back to the paycheck.
   *
   * The annual round trip is not optional: the first band is an annual
   * threshold, and testing a fortnight against it would put almost every salary
   * in Panama at zero.
   *
   * The two policy questions — whether the contributions come out of the base,
   * and how many salaries make up the fiscal year — are read from the rule set
   * rather than decided here. Panama's answer is «no» and «thirteen», and a
   * jurisdiction that says otherwise gets the other arithmetic without this file
   * changing. Absent the rule, the conservative reading applies: twelve
   * salaries, contributions deducted.
   */
  const policy = findRule(rules, 'income.withholding');
  const withholding =
    policy?.kind === 'withholding'
      ? policy
      : { basePeriodsPerYear: 12, salaryPeriodsPerYear: 12, deductsContributions: true };
  if (withholding.basePeriodsPerYear <= 0 || withholding.salaryPeriodsPerYear <= 0) return null;

  const perYear = (value: Money) => value.multiply(paymentsPerYear);
  const salaryYear = perYear(gross);
  const contributions = withholding.deductsContributions
    ? perYear(social).add(perYear(education))
    : zero;
  /**
   * La base, estirada a los sueldos que componen el año fiscal.
   *
   * Trece en Panamá, porque el decimotercer mes es renta del año igual que los
   * otros doce. Multiplicar por trece doceavos es exactamente eso y no un
   * recargo: el mismo sueldo, contado las veces que se cobra.
   */
  const taxableYear = salaryYear
    .subtract(contributions)
    .multiply(withholding.basePeriodsPerYear)
    .divide(withholding.salaryPeriodsPerYear);
  const { tax: annualTax } = applyBrackets(
    taxableYear.isPositive() ? taxableYear : zero,
    bracketRule.brackets,
    bracketRule.key,
  );
  /**
   * Y de vuelta al recibo, repartida entre los mismos trece.
   *
   * De donde se sigue que en los doce pagos ordinarios se retienen doce trecios
   * del impuesto del año: el trecio que falta sale del decimotercer mes, que
   * este producto todavía no representa como un ingreso propio.
   */
  const perPeriodDivisor =
    (paymentsPerYear * withholding.basePeriodsPerYear) / withholding.salaryPeriodsPerYear;
  const incomeTax = annualTax.isPositive() ? annualTax.divide(perPeriodDivisor) : zero;

  // Solo las líneas con monto. Una retención de cero no es una línea del
  // recibo: es la ausencia de una, y mostrarla vacía sugiere que se cobró algo.
  const lines: PayrollLine[] = (
    [
      {
        key: 'socialSecurity',
        ruleKey: 'social_security.employee',
        amount: social,
        rate: asPercent(socialRate),
        isEffectiveRate: false,
      },
      {
        key: 'educationTax',
        ruleKey: 'social_security.education_employee',
        amount: education,
        rate: asPercent(educationRate),
        isEffectiveRate: false,
      },
      {
        key: 'incomeTax',
        ruleKey: bracketRule.key,
        amount: incomeTax,
        rate: effectiveRate(incomeTax, gross),
        isEffectiveRate: true,
      },
    ] as const satisfies readonly PayrollLine[]
  ).filter((line) => line.amount.isPositive());

  const totalDeducted = Money.sum(
    lines.map((line) => line.amount),
    currency,
  );
  const net = gross.subtract(totalDeducted);

  return {
    gross,
    lines,
    totalDeducted,
    // Never true while the set is a draft, which is every set today. Kept as a
    // field rather than a comment so a caller has to look at it.
    net: net.isPositive() ? net : zero,
    mayPresentAsOwed: rules.status === 'published',
  };
}

/**
 * Las cifras con las que se explica una planilla, sacadas del conjunto de reglas.
 *
 * Existe para que una pantalla pueda decir *por qué* sale cada monto sin
 * escribir «9,75%» ni «11.000» en su propio texto. Una tasa citada en una
 * plantilla es una tasa que dejará de coincidir con la que se aplica el día que
 * el conjunto cambie, y ese día nadie se entera: la cuenta seguiría bien y la
 * explicación empezaría a mentir.
 *
 * Devuelve null cuando al conjunto le falta algo, igual que el cálculo. Una
 * leyenda a medias explica mal, que es peor que no explicar.
 */
export interface PayrollReference {
  /** Tasas como se citan, sin ceros de relleno: `9.75`. */
  readonly socialRate: string;
  readonly educationRate: string;
  /** Los tramos, en importes decimales y con la tasa de cada uno. */
  readonly bands: readonly {
    readonly from: string;
    readonly upTo: string | null;
    readonly rate: string;
  }[];
  readonly basePeriodsPerYear: number;
  readonly salaryPeriodsPerYear: number;
  readonly deductsContributions: boolean;
  /** De dónde salió el método, para poder citarlo. */
  readonly source: string;
}

export function payrollReference(rules: TaxRuleSet): PayrollReference | null {
  const socialRate = flatRate(rules, 'social_security.employee');
  const educationRate = flatRate(rules, 'social_security.education_employee');
  const bracketRule = findRule(rules, 'income.brackets');
  if (!socialRate || !educationRate || bracketRule?.kind !== 'brackets') return null;

  const policy = findRule(rules, 'income.withholding');
  const withholding =
    policy?.kind === 'withholding'
      ? policy
      : { basePeriodsPerYear: 12, salaryPeriodsPerYear: 12, deductsContributions: true };

  return {
    socialRate: asPercent(socialRate),
    educationRate: asPercent(educationRate),
    bands: bracketRule.brackets.map((band) => ({
      from: band.from.toDecimalString(),
      upTo: band.upTo ? band.upTo.toDecimalString() : null,
      rate: asPercent(band.rate),
    })),
    basePeriodsPerYear: withholding.basePeriodsPerYear,
    salaryPeriodsPerYear: withholding.salaryPeriodsPerYear,
    deductsContributions: withholding.deductsContributions,
    source: (policy ?? bracketRule).provenance.sourceReference,
  };
}

/** Una partida del decimotercer mes: cuándo cae y cuánto es. */
export interface ThirteenthInstalment {
  /** `YYYY-MM-DD`, ya resuelta al año que se pregunta. */
  readonly on: string;
  readonly amount: Money;
}

/**
 * El decimotercer mes, repartido en las fechas en que la ley lo paga.
 *
 * Tres partidas iguales —abril, agosto y diciembre— de un tercio de un sueldo
 * mensual cada una. Las fechas y la fracción salen del conjunto de reglas y no
 * de aquí: son política de la jurisdicción, cambian por ley y no por
 * despliegue.
 *
 * **Es una sugerencia editable, no lo que se debe.** Para quien gana fijo el
 * tercio es exacto; para quien gana variable la ley manda sobre lo devengado en
 * el cuatrimestre, y eso este conjunto no lo modela. Devolver un número
 * parecido y llamarlo definitivo sería peor que no devolver ninguno.
 *
 * Null cuando el conjunto no lleva la regla: no se inventan fechas de pago.
 */
export function thirteenthMonth(input: {
  readonly monthlySalary: Money;
  readonly year: number;
  readonly rules: TaxRuleSet;
}): readonly ThirteenthInstalment[] | null {
  const rule = findRule(input.rules, 'thirteenth_month');
  if (rule?.kind !== 'payment_schedule') return null;
  if (input.monthlySalary.isNegative()) return null;

  const share = input.monthlySalary.percentage(rule.sharePerInstalment);
  return rule.monthDays.map((monthDay) => ({
    on: `${String(input.year)}-${monthDay}`,
    amount: share,
  }));
}
