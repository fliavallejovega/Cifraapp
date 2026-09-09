'use server';

import {
  accounts,
  debts,
  goals,
  holdings,
  householdPeople,
  householdSettings,
  households,
  incomeDeductions,
  institutions,
  obligations,
  receivables,
  recurringSeries,
} from '@app/database/schema';
import {
  addMonths,
  Money,
  plainDateFromParts,
  todayIn,
  type CurrencyCode,
  type PlainDate,
} from '@app/domain';
import { HOLDING_KINDS } from '@app/market-data';
import { and, eq, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { normalizeTypedAmount } from './amount';
import { loadSession, queryAsUser } from './session';

/**
 * Setup: what the household tells us before there is any data to read.
 *
 * The engines were all built to read rows — obligations, debts, goals, a buffer,
 * a household size — and nothing in the product ever created them. A person
 * could sign up, land on a plan screen and be told, correctly and uselessly,
 * that nothing claims their money. The questionnaire is what makes the first
 * plan real on day one, before a single statement has been imported.
 *
 * Everything it collects already had a home in the schema. An income is a
 * recurring series; a monthly commitment is an obligation with a due date; a
 * card is a debt with its rate and minimum; a plan for the future is a goal.
 * Nothing is stored as an answer to a question — it is stored as the financial
 * object it describes, so the engines read it without knowing where it came
 * from.
 *
 * Every figure is provenance-marked `user`: stated, not measured. When
 * statements arrive and the recurrence engine sees the real amounts, the
 * difference between what was said and what happened is a fact worth having,
 * and it only exists because the stated version was recorded honestly.
 */

export interface SetupResult {
  readonly error?: string;
  readonly ok?: true;
}

const amount = z.preprocess(
  normalizeTypedAmount,
  z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .refine((value) => (value.split('.')[0] ?? '').length <= 12),
);

const optionalAmount = z.preprocess(
  (value) => (value === '' || value === undefined || value === null ? undefined : value),
  amount.optional(),
);

const name = z.string().trim().min(1).max(120);

/**
 * The row this answer corrects, when there is one.
 *
 * Absent on a first pass and on anything added later, so absence means insert
 * and presence means update. Carrying it is what turns a second visit to the
 * questionnaire into a correction instead of a second helping — without it,
 * somebody fixing a mistyped salary would end up with both the wrong figure
 * and the right one, and the plan would add them together.
 */
const rowId = z.uuid().optional();

const dueDay = z.coerce.number().int().min(1).max(31);

const RELATIONSHIPS = ['self', 'partner', 'child', 'parent', 'sibling', 'other'] as const;

const setupInput = z.object({
  // Who lives here, by name. The counts below are derived from this list by the
  // form, so the figure the plan reads and the list a person can edit are the
  // same fact rather than two records of it.
  people: z
    .array(
      z.object({
        id: rowId,
        name,
        relationship: z.enum(RELATIONSHIPS),
        isDependent: z.boolean(),
        /**
         * Qué parte de los gastos comunes lleva, en porcentaje.
         *
         * Ausente cuando la casa no lo acordó, y entonces la pantalla reparte
         * en partes iguales. No se deduce de los sueldos: quien gana más suele
         * poner más, pero en qué proporción lo deciden ellos.
         */
        expenseShare: z.coerce.number().min(0).max(100).optional(),
      }),
    )
    .max(20)
    .default([]),
  memberCount: z.coerce.number().int().min(1).max(50),
  dependentCount: z.coerce.number().int().min(0).max(50),
  bufferMinimum: optionalAmount,
  incomes: z
    .array(
      z.object({
        id: rowId,
        name,
        amount,
        frequency: z.enum([
          'daily',
          'weekly',
          'biweekly',
          'semimonthly',
          'monthly',
          'quarterly',
          'annual',
        ]),
        /**
         * The two days of the month a twice-monthly income lands on.
         *
         * Asked rather than assumed, because «quincenal» is not one cadence:
         * the 15th and the 30th, the 5th and the 20th, and the 1st and the 16th
         * are three different calendars, and which one a household is on
         * decides which fortnight carries the rent. Empty for every other
         * cadence, and empty is a real answer — it means we fall back to
         * stepping fifteen days, which is an approximation and is treated as
         * one.
         */
        anchorDays: z.array(z.coerce.number().int().min(1).max(31)).max(2).optional(),
        // "About 2,400 in a good month" and "2,400 on the 15th" are different
        // claims, and a plan built on the first should not pretend otherwise.
        isApproximate: z.boolean(),
        /**
         * Lo que dice la ficha antes de los descuentos, y las líneas que el
         * hogar copió de ella.
         *
         * `amount` sigue siendo lo que llega, siempre: todo el sistema lo lee
         * como efectivo. El bruto y las líneas están para poder reconciliar —
         * un hogar que ve «$1.000» no puede cuadrarlo con un contrato que dice
         * $1.400 si no tiene los dos números y lo del medio delante.
         *
         * Ninguna tasa oficial entra por aquí. Son cifras que alguien leyó de
         * su propio recibo.
         */
        grossAmount: optionalAmount,
        deductions: z
          .array(
            z.object({
              label: z.string().trim().min(1).max(80),
              amount,
              /**
               * Los días en que se descuenta, cuando no son todos.
               *
               * El seguro social sale de cada pago porque es un porcentaje del
               * sueldo del período. La cuota de la cooperativa sale una vez al
               * mes, y una vez al mes es **una** de las dos quincenas. Ausente
               * significa «en todos los pagos», que es el caso corriente.
               */
              appliesToAnchors: z.array(z.coerce.number().int().min(1).max(31)).max(2).optional(),
              /**
               * La regla que la calculó, si la calculó alguna.
               *
               * Una línea con regla sale de cada pago por construcción, así que
               * los días que traiga se ignoran: la base lo prohíbe y aquí se
               * normaliza antes de llegar a ella.
               */
              ruleKey: z.string().trim().min(1).max(80).optional(),
            }),
          )
          .max(8)
          .default([]),
      }),
    )
    .max(20),
  /**
   * Lo que la familia va a cobrar, y cuándo.
   *
   * No es un ingreso recurrente y no entra al plan como dinero disponible: se
   * guarda para poder perseguirlo. La fecha puede faltar —«me deben 500 y no sé
   * cuándo» es una respuesta verdadera— y obligar a inventar una la convertiría
   * en un dato falso con aspecto de dato.
   */
  receivables: z
    .array(
      z.object({
        id: z.uuid().optional(),
        name: z.string().trim().min(1).max(120),
        source: z.string().trim().max(120).optional(),
        amount,
        expectedOn: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        confidence: z.enum(['confirmed', 'likely', 'estimated']).default('estimated'),
      }),
    )
    .max(20)
    .default([]),
  accounts: z
    .array(
      z.object({
        id: rowId,
        name,
        accountType: z.enum(['checking', 'savings', 'cash', 'digital_wallet']),
        balance: amount,
        /** The institution by name, matched against the seeded list. */
        institution: z.string().trim().max(120).optional(),
        /** What it pays annually, as the household's statement reports it. */
        interestRate: z.preprocess(
          (value) => (value === '' || value === undefined || value === null ? undefined : value),
          z
            .string()
            .regex(/^\d+(\.\d{1,3})?$/)
            .refine((value) => Number(value) <= 100)
            .optional(),
        ),
      }),
    )
    .max(20),
  /**
   * What the household owns that is not cash.
   *
   * The symbol and the quantity are the answer; `kind` and `currency` come
   * back from the lookup the form already did, and are re-derived on read
   * rather than trusted for anything that matters. The price is deliberately
   * absent: it belongs to whoever quoted it, it lives in `market_prices` with
   * its moment, and accepting it here would let a form state what a market
   * said.
   */
  holdings: z
    .array(
      z.object({
        id: rowId,
        symbol: z
          .string()
          .trim()
          .min(1)
          .max(20)
          .regex(/^[A-Za-z0-9.\-^=]+$/),
        label: name,
        quantity: z
          .string()
          .trim()
          .regex(/^\d+(\.\d{1,10})?$/)
          .refine((value) => Number(value) > 0),
        // Read from the market data package rather than retyped. Widening the
        // kinds there and leaving a copy of the old four here rejected the
        // whole payload — a household with one mutual fund could not finish
        // setup at all, and the error named nothing a person could act on.
        kind: z.enum(HOLDING_KINDS).default('other'),
        currency: z.enum(['USD', 'PAB']).default('USD'),
        personName: z.string().trim().max(120).optional(),
      }),
    )
    .max(40)
    .default([]),
  commitments: z
    .array(
      z.object({
        id: rowId,
        name,
        amount,
        dueDay,
        isEssential: z.boolean(),
        /**
         * The income this is taken out of before it arrives, when it is.
         *
         * Carried as the *position* of the income in the answers rather than
         * its id, because on a first pass the incomes do not have ids yet —
         * they are inserted in the same transaction as the commitments that
         * point at them. Resolved below, once the inserts have returned.
         */
        /**
         * De qué sueldo sale este pago, por su posición en las respuestas.
         *
         * Separado de si lo descuentan en planilla, porque no son la misma
         * pregunta: se puede pagar el alquiler del sueldo de uno sin que nadie
         * lo descuente. Solo la segunda cambia lo que reclama un saldo.
         */
        paidFromIncome: z.coerce.number().int().min(0).max(19).optional(),
        isDeductedAtSource: z.coerce.boolean().default(false),
        /** Un monto por cada día de anclaje, cuando la quincena no es pareja. */
        anchorAmounts: z.array(amount).max(2).optional(),
        categorySlug: z.string().trim().max(60).optional(),
        /**
         * What paying late costs, stated as one shape or the other.
         *
         * `lateFeeKind` decides which column the figure lands in. Sending a
         * rate into the amount column would turn «5%» into «$5», which on a
         * two-thousand-dollar rent is wrong by two orders of magnitude — so
         * the shape travels with the number rather than being inferred.
         */
        lateFeeKind: z.enum(['none', 'amount', 'rate']).default('none'),
        lateFee: optionalAmount,
        /**
         * How often this is paid, and on which days when it is twice a month.
         *
         * A monthly payment on the 5th already exists in one fortnight and not
         * the other — that falls out of the date. What could not be said before
         * is the rest: a fee charged every week, a loan taken twice a month, a
         * quota that lands on the 15th *and* the 30th. Monthly is the default
         * because it is what the previous version of this form silently
         * assumed, so nothing changes for anybody who does not touch it.
         */
        frequency: z
          .enum(['daily', 'weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'annual'])
          .default('monthly'),
        anchorDays: z.array(z.coerce.number().int().min(1).max(31)).max(2).optional(),
        lateFeeAfterDays: z.preprocess(
          (value) => (value === '' || value === undefined || value === null ? undefined : value),
          z.coerce.number().int().min(0).max(365).optional(),
        ),
      }),
    )
    .max(40),
  debts: z
    .array(
      z.object({
        id: rowId,
        name,
        balance: amount,
        /** Present when the debt is a credit card: what it can be spent up to. */
        creditLimit: optionalAmount,
        /**
         * Qué clase de deuda es. Lo que decide si tiene cupo o tiene cuotas —
         * una tarjeta no termina y una hipoteca no tiene límite.
         */
        kind: z
          .enum([
            'credit_card',
            'auto_loan',
            'mortgage',
            'personal_loan',
            'student_loan',
            'informal',
            'other',
          ])
          .default('other'),
        /** Cuántas cuotas tiene y cuántas van pagadas. Vacías en una tarjeta. */
        termMonths: z.coerce.number().int().min(1).max(600).optional(),
        paidMonths: z.coerce.number().int().min(0).max(600).optional(),
        /**
         * Cómo se paga. Es lo que decide si tiene cuotas o si da vueltas, y es
         * distinto de la clase: una hipoteca y un préstamo entre amigos pueden
         * pagarse igual.
         */
        repayment: z
          .enum([
            'fixed_instalment',
            'declining_instalment',
            'interest_only',
            'single_payment',
            'no_interest_plan',
            'revolving',
            'open',
          ])
          .default('fixed_instalment'),
        /** La cuota sale de la planilla antes de que el sueldo llegue. */
        isPayrollDeducted: z.boolean().default(false),
        /** Cada cuánto se cobra la cuota, y en qué días del mes cae. */
        paymentFrequency: z
          .enum(['daily', 'weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'annual'])
          .default('monthly'),
        anchorDays: z.array(z.coerce.number().int().min(1).max(31)).max(2).optional(),
        /** Whose card, by the name given on the first step. Empty is the household's. */
        personName: z.string().trim().max(120).optional(),
        // A percentage: "24.5" means 24.5%. Bounded because a rate past 200%
        // is a figure entered in the wrong field, not a loan.
        /**
         * La tasa, cuando se sabe.
         *
         * Opcional a propósito: el hint de la pantalla dice desde siempre «si
         * no la sabes, déjala en blanco», y hasta ahora eso descartaba la fila
         * entera al guardar. Una deuda sin tasa conocida sigue siendo una
         * deuda; lo que no se puede hacer con ella es ordenarla por costo, y
         * eso es una consecuencia que se explica, no una fila que se tira.
         */
        apr: z
          .preprocess(
            normalizeTypedAmount,
            z
              .string()
              .regex(/^\d+(\.\d{1,3})?$/)
              .refine((value) => Number(value) <= 200),
          )
          .optional(),
        /**
         * El mínimo, cuando lo hay.
         *
         * Lo que se le debe a un hermano o a un proveedor no tiene mínimo ni
         * fecha: se debe, y se paga cuando se pueda. Exigirlo obligaba a
         * inventar un cero que después el plan trata como una obligación de
         * cero, que es distinto de no tener obligación.
         */
        minimumPayment: optionalAmount,
      }),
    )
    .max(20),
  goals: z
    .array(
      z.object({
        id: rowId,
        name,
        targetAmount: amount,
        targetDate: z.string().optional(),
        /** Lo que el hogar ya apartó para ella. */
        currentAmount: optionalAmount,
        /**
         * La casa dijo que esta va. Se declara y no se deduce de tener fecha:
         * «algún día en diciembre» es una fecha, y una meta confirmada se llena
         * antes que todas las demás.
         */
        isCommitted: z.boolean().default(false),
      }),
    )
    .max(20),
});

export type SetupInput = z.infer<typeof setupInput>;

/**
 * The rows that must survive an archive sweep.
 *
 * Not «the ids the form sent» — that was the first version and it was wrong in
 * the worst possible way: on a first pass no row carries an id yet, so the
 * sweep that follows the inserts archived everything that had just been
 * inserted, and a household finished the questionnaire with nothing to show
 * for it. What survives is what the save touched, which means the ids updated
 * *and* the ids created, collected as the loop goes.
 *
 * The sentinel keeps `not in ()` from being empty, which Postgres would read
 * as «archive nothing» — the opposite mistake, and just as silent.
 */
const survivors = (ids: readonly string[]): string[] =>
  ids.length > 0 ? [...ids] : ['00000000-0000-0000-0000-000000000000'];

/**
 * Los días de un descuento, quedándose solo con los que el sueldo cobra.
 *
 * Un día que el ingreso no paga no puede descontar nada, y guardarlo sería
 * guardar una fecha que ningún cálculo va a encontrar. Si no queda ninguno
 * —porque el hogar cambió las quincenas después de elegir— vuelve a null, que
 * significa «en todos los pagos» y es la lectura que no se inventa una fecha.
 */
function onlyOn(
  chosen: readonly number[] | undefined,
  anchors: readonly number[] | null,
): number[] | null {
  if (!anchors || !chosen || chosen.length === 0) return null;
  const kept = [...new Set(chosen)].filter((day) => anchors.includes(day)).sort((a, b) => a - b);
  return kept.length > 0 && kept.length < anchors.length ? kept : null;
}

export async function completeSetup(
  _previous: SetupResult,
  formData: FormData,
): Promise<SetupResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const raw = formData.get('payload');
  if (typeof raw !== 'string') return { error: 'invalid' };

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { error: 'invalid' };
  }

  const parsed = setupInput.safeParse(decoded);
  if (!parsed.success) {
    // Which fields, never their values. A rejected answer set is a diagnostic
    // problem — «accounts.0.accountType» is the whole answer — and the values
    // are somebody's salary. This log exists because the first version of the
    // review returned a message about amounts when nothing was wrong with the
    // amounts, and there was no way to tell from the outside.
    console.error(
      '[setup] rejected fields:',
      parsed.error.issues.map((issue) => issue.path.join('.')).join(', '),
    );
    return { error: 'invalid' };
  }

  const answers = parsed.data;
  if (answers.dependentCount > answers.memberCount) return { error: 'dependentsExceedMembers' };

  const householdId = session.activeHouseholdId;

  try {
    await queryAsUser(session, async (tx) => {
      const [household] = await tx
        .select({ currency: households.baseCurrency, timeZone: households.timeZone })
        .from(households)
        .where(eq(households.id, householdId))
        .limit(1);

      const currency = (household?.currency.trim() ?? 'USD') as CurrencyCode;
      const today = todayIn(household?.timeZone ?? 'America/Panama');

      // One transaction for all of it. A setup that created the accounts and
      // then failed on the debts would leave a household in a state it never
      // described, and no screen would say so.
      await tx
        .insert(householdSettings)
        .values({
          householdId,
          memberCount: answers.memberCount,
          dependentCount: answers.dependentCount,
          onboardingCompletedAt: new Date(),
          ...(answers.bufferMinimum ? { bufferMinimum: answers.bufferMinimum } : {}),
        })
        .onConflictDoUpdate({
          target: householdSettings.householdId,
          set: {
            memberCount: answers.memberCount,
            dependentCount: answers.dependentCount,
            onboardingCompletedAt: new Date(),
            ...(answers.bufferMinimum ? { bufferMinimum: answers.bufferMinimum } : {}),
            updatedAt: new Date(),
          },
        });

      // The category tree, which no household had ever been given. Thirty-eight
      // templates sat in `category_templates` from the second migration and
      // nothing copied them in, so the classifier had nowhere to file anything
      // and every budget had nothing to budget.
      await tx.execute(sql`select app.seed_household_categories(${householdId})`);

      /**
       * What the person took out of the questionnaire is archived, never
       * deleted.
       *
       * A household that removes an account here may have transactions hanging
       * off it, and «archived on the 14th» and «never existed» are different
       * answers — the second is not available to a financial system. Written
       * per table rather than through one helper because the tables are not
       * interchangeable: goals have no `deleted_at` and are paused instead,
       * and income is archived by direction so an outflow series the
       * recurrence engine found — which this form never showed — is never
       * touched by it.
       */
      // People first: a card can name its holder, and the holder has to exist
      // before anything can point at them.
      // The seeded banks, by name, so an account can point at one without a
      // second round trip per row.
      const bankRows = await tx
        .select({ id: institutions.id, name: institutions.name })
        .from(institutions)
        .where(eq(institutions.country, 'PA'));
      const banksByName = new Map(bankRows.map((row) => [row.name, row.id]));

      const peopleByName = new Map<string, string>();
      const keptPeople: string[] = [];
      for (const person of answers.people) {
        const values = {
          displayName: person.name,
          relationship: person.relationship,
          isDependent: person.isDependent,
          // Un dependiente no lleva parte de los gastos comunes: un niño no
          // paga el alquiler, y la base rechaza lo contrario. Se normaliza aquí
          // para que marcar dependiente a alguien no reviente el guardado.
          expenseShare:
            person.isDependent || person.expenseShare === undefined
              ? null
              : person.expenseShare.toFixed(2),
        };
        if (person.id) {
          await tx
            .update(householdPeople)
            .set({ ...values, updatedAt: new Date() })
            .where(
              and(eq(householdPeople.id, person.id), eq(householdPeople.householdId, householdId)),
            );
          peopleByName.set(person.name, person.id);
          keptPeople.push(person.id);
        } else {
          const [created] = await tx
            .insert(householdPeople)
            .values({ householdId, createdBy: session.user.id, ...values })
            .returning({ id: householdPeople.id });
          if (created) {
            peopleByName.set(person.name, created.id);
            keptPeople.push(created.id);
          }
        }
      }
      await tx
        .update(householdPeople)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(householdPeople.householdId, householdId),
            isNull(householdPeople.deletedAt),
            notInArray(householdPeople.id, survivors(keptPeople)),
          ),
        );

      // Accounts. Cards are not in scope here — the questionnaire asks about
      // them on the debts step, and this sweep must not archive one it never
      // showed.
      const keptAccounts: string[] = [];
      for (const entry of answers.accounts) {
        const values = {
          name: entry.name,
          accountType: entry.accountType,
          currentBalance: entry.balance,
          institutionId: entry.institution ? (banksByName.get(entry.institution) ?? null) : null,
          // Null, not zero, when nothing was said. «Pays nothing» and «nobody
          // told us» are different facts and only one of them is a rate.
          interestRate: entry.interestRate ?? null,
        };
        if (entry.id) {
          await tx
            .update(accounts)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(accounts.id, entry.id), eq(accounts.householdId, householdId)));
          keptAccounts.push(entry.id);
        } else {
          const [created] = await tx
            .insert(accounts)
            .values({
              householdId,
              ownerId: session.user.id,
              createdBy: session.user.id,
              currency,
              status: 'active' as const,
              source: 'user' as const,
              ...values,
            })
            .returning({ id: accounts.id });
          if (created) keptAccounts.push(created.id);
        }
      }
      await tx
        .update(accounts)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(accounts.householdId, householdId),
            isNull(accounts.deletedAt),
            ne(accounts.accountType, 'credit_card'),
            notInArray(accounts.id, survivors(keptAccounts)),
          ),
        );

      // Income
      const keptIncomes: string[] = [];
      for (const entry of answers.incomes) {
        const anchors =
          entry.frequency === 'semimonthly' && entry.anchorDays && entry.anchorDays.length > 0
            ? [...new Set(entry.anchorDays)].sort((a, b) => a - b)
            : null;

        /**
         * Lo que llega, que ya no es siempre un solo número.
         *
         * Cuando el hogar declaró el bruto y las líneas, lo que llega es la
         * resta — guardar el bruto en su lugar haría que cada quincena
         * prometiera dinero que nunca entró. Y cuando alguna de esas líneas
         * sale de una sola quincena, la resta da distinto en cada una: un
         * préstamo que se paga el día 30 no se paga a medias el 15.
         *
         * `expectedAmount` guarda el promedio de las dos, que es lo que
         * mantiene correcto el total del mes en cada vista que no razona por
         * período. La verdad de cada quincena va en `anchorAmounts`, y el plan
         * la lee de ahí.
         */
        const gross = Money.fromDecimalString(entry.grossAmount ?? entry.amount, currency);
        const declared = entry.grossAmount !== undefined && entry.deductions.length > 0;

        const netOn = (day: number | null): Money => {
          const taken = entry.deductions.reduce((total, line) => {
            // La misma normalización que se guarda, para que el neto guardado y
            // las líneas guardadas no puedan contar historias distintas.
            const only = line.ruleKey === undefined ? onlyOn(line.appliesToAnchors, anchors) : null;
            // Sin días declarados, el descuento sale de todos los pagos. Con
            // ellos, solo del que nombran: preguntar y luego restarlo igual en
            // los dos habría sido preguntar por deporte.
            const applies = only === null || (day !== null && only.includes(day));
            return applies ? total.subtract(Money.fromDecimalString(line.amount, currency)) : total;
          }, gross);
          return taken.isNegative() ? Money.zero(currency) : taken;
        };

        const perAnchor = declared && anchors ? anchors.map((day) => netOn(day)) : null;
        // Desiguales o no vale la pena guardarlas: dos cifras idénticas en
        // `anchorAmounts` no dicen nada que `expectedAmount` no dijera ya, y
        // dejarlas ahí es dejar dos verdades esperando a divergir.
        const first = perAnchor?.[0];
        const uneven =
          perAnchor && first && perAnchor.some((one) => !one.equals(first))
            ? perAnchor.map((one) => one.toDecimalString())
            : null;

        const arrives = declared
          ? (perAnchor
              ? Money.sum(perAnchor, currency).divide(perAnchor.length)
              : netOn(null)
            ).toDecimalString()
          : entry.amount;

        const values = {
          name: entry.name,
          expectedAmount: arrives,
          grossAmount: entry.grossAmount ?? null,
          frequency: entry.frequency,
          // Explicitly null outside `semimonthly`, so switching a salary from
          // «quincenal» to «mensual» on a second pass does not leave two
          // anchor days behind to be projected onto a cadence that has none.
          anchorDays: anchors,
          anchorAmounts: uneven,
          amountVariation: entry.isApproximate ? '0.1500' : '0',
        };
        if (entry.id) {
          await tx
            .update(recurringSeries)
            .set({ ...values, updatedAt: new Date() })
            .where(
              and(eq(recurringSeries.id, entry.id), eq(recurringSeries.householdId, householdId)),
            );
          keptIncomes.push(entry.id);
        } else {
          const [created] = await tx
            .insert(recurringSeries)
            .values({
              householdId,
              ownerId: session.user.id,
              direction: 'inflow' as const,
              currency,
              lastSeenOn: today,
              nextExpectedDate: nextFor(today, entry.frequency, anchors ?? undefined),
              // Stated by a person, so confidence in the statement is total; what
              // is uncertain is the amount, and that is what the variation says.
              confidence: '1.000',
              occurrenceCount: 0,
              isEssential: true,
              isActive: true,
              detectedBy: 'user' as const,
              confirmedBy: session.user.id,
              confirmedAt: new Date(),
              ...values,
            })
            .returning({ id: recurringSeries.id });
          if (created) keptIncomes.push(created.id);
        }

        /**
         * Las líneas del recibo, reemplazadas enteras.
         *
         * Borrar y reinsertar en vez de conciliar fila por fila, porque una
         * ficha de pago se lee como un bloque: quien vuelve a este paso está
         * copiando su recibo otra vez, no editando la tercera línea. Conciliar
         * dejaría atrás una línea que la empresa quitó, y una deducción
         * fantasma resta de un neto que nadie puede cuadrar.
         */
        const seriesId = keptIncomes[keptIncomes.length - 1];
        if (seriesId) {
          await tx.delete(incomeDeductions).where(eq(incomeDeductions.seriesId, seriesId));
          if (entry.deductions.length > 0) {
            await tx.insert(incomeDeductions).values(
              entry.deductions.map((line, order) => ({
                householdId,
                seriesId,
                label: line.label,
                amount: line.amount,
                currency,
                sortOrder: order,
                // Solo los días que de verdad son de este ingreso. Un día que
                // el sueldo no cobra no puede descontar nada, y guardarlo sería
                // guardar una fecha que ningún cálculo va a encontrar.
                ruleKey: line.ruleKey ?? null,
                // Una línea de ley sale de todos los pagos, y guardarle días
                // sería guardar la respuesta a una pregunta que no se hizo.
                appliesToAnchors:
                  line.ruleKey === undefined ? onlyOn(line.appliesToAnchors, anchors) : null,
              })),
            );
          }
        }
      }
      // Only the household's stated income is in scope here. An outflow series
      // the recurrence engine found is not something this form ever showed, so
      // it is not something this form may archive.
      await tx
        .update(recurringSeries)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(recurringSeries.householdId, householdId),
            eq(recurringSeries.direction, 'inflow'),
            isNull(recurringSeries.deletedAt),
            notInArray(recurringSeries.id, survivors(keptIncomes)),
          ),
        );

      /**
       * Lo que está por cobrar.
       *
       * Se reescribe entero en cada envío, igual que el resto del cuestionario:
       * el formulario es la declaración completa de lo que el hogar espera
       * cobrar, y una lista que solo crece dejaría vivo lo que alguien acaba de
       * borrar. Lo ya cobrado queda fuera de esta poda —tiene `received_on` y no
       * es una promesa sino historia— pero el cuestionario tampoco lo muestra.
       */
      const keptReceivables: string[] = [];
      for (const entry of answers.receivables) {
        const values = {
          name: entry.name,
          source: entry.source ?? null,
          amount: entry.amount,
          currency,
          expectedOn: entry.expectedOn ?? null,
          confidence: entry.confidence,
        };
        if (entry.id) {
          await tx
            .update(receivables)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(receivables.id, entry.id), eq(receivables.householdId, householdId)));
          keptReceivables.push(entry.id);
        } else {
          const [created] = await tx
            .insert(receivables)
            .values({ householdId, ...values })
            .returning({ id: receivables.id });
          if (created) keptReceivables.push(created.id);
        }
      }
      await tx
        .update(receivables)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(receivables.householdId, householdId),
            isNull(receivables.deletedAt),
            isNull(receivables.receivedOn),
            notInArray(receivables.id, survivors(keptReceivables)),
          ),
        );

      /**
       * Monthly commitments.
       *
       * `keptIncomes` is in the order the incomes were answered and now holds
       * a real id for every one of them, inserted or updated a few lines
       * above. That is what lets a commitment point at «the second salary»
       * before that salary had an id to point at.
       */
      const keptCommitments: string[] = [];
      for (const entry of answers.commitments) {
        const due = nextDueOn(today, entry.dueDay);
        const paidFrom =
          entry.paidFromIncome === undefined ? null : (keptIncomes[entry.paidFromIncome] ?? null);
        const commitmentAnchors =
          entry.frequency === 'semimonthly' && entry.anchorDays && entry.anchorDays.length > 0
            ? [...new Set(entry.anchorDays)].sort((a, b) => a - b)
            : null;

        const values = {
          name: entry.name,
          expectedAmount: entry.amount,
          dueDate: due,
          nextExpectedDate: addMonths(due, 1),
          frequency: entry.frequency,
          anchorDays: commitmentAnchors,
          isEssential: entry.isEssential,
          // Explicitly null rather than omitted, so clearing the answer on a
          // second pass clears the row instead of leaving the old one in place.
          paidFromSeriesId: paidFrom,
          // A deduction at source only means anything against an income: «se
          // descuenta» with no salary named is not a fact anybody can use.
          isDeductedAtSource: paidFrom !== null && entry.isDeductedAtSource,
          // Un monto por cada día, o ninguno. Una lista más corta que la de
          // días es un pago que nadie puede calcular, y la base lo rechaza.
          anchorAmounts:
            entry.frequency === 'semimonthly' &&
            entry.anchorAmounts?.length === commitmentAnchors?.length
              ? (entry.anchorAmounts ?? null)
              : null,
          // A fee with no figure is not a fee, and a figure with no shape is
          // not a number anybody can use — so both have to be present, and the
          // shape decides which of the two columns receives it. The other is
          // set to null on purpose: the schema allows at most one, and a
          // correction from «porcentaje» to «monto» has to clear the old one.
          lateFeeAmount:
            entry.lateFeeKind === 'amount' && entry.lateFee !== undefined ? entry.lateFee : null,
          lateFeeRate:
            entry.lateFeeKind === 'rate' && entry.lateFee !== undefined ? entry.lateFee : null,
          lateFeeAfterDays: entry.lateFeeKind === 'none' ? null : (entry.lateFeeAfterDays ?? 0),
        };
        if (entry.id) {
          await tx
            .update(obligations)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(obligations.id, entry.id), eq(obligations.householdId, householdId)));
          keptCommitments.push(entry.id);
        } else {
          const [created] = await tx
            .insert(obligations)
            .values({
              householdId,
              currency,
              detectedBy: 'user' as const,
              ...values,
            })
            .returning({ id: obligations.id });
          if (created) keptCommitments.push(created.id);
        }
      }
      await tx
        .update(obligations)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(obligations.householdId, householdId),
            isNull(obligations.deletedAt),
            notInArray(obligations.id, survivors(keptCommitments)),
          ),
        );

      /**
       * Debts, and the cards among them.
       *
       * A credit card is two facts and the product needs both: what is owed,
       * which drives the payoff plan, and what is still available on it, which
       * is a spending limit the position has to know about. So a debt with a
       * limit also gets an account of type `credit_card` and the debt points at
       * it. Without that, a card entered during setup was a debt with no card
       * behind it, and «how much room is left on it» had no answer anywhere.
       *
       * The balance is stored positive on the debt, which is what is owed, and
       * negative on the account, which is what the account holds. Both are the
       * same fact from the two directions the system reads it from.
       */
      const keptDebts: string[] = [];
      for (const entry of answers.debts) {
        // La clase manda, no la presencia del cupo. Una tarjeta sin límite
        // declarado sigue siendo una tarjeta, y un préstamo con un límite
        // escrito por error no se convierte en una.
        const isCard = entry.kind === 'credit_card';
        const holder = entry.personName?.trim()
          ? (peopleByName.get(entry.personName.trim()) ?? null)
          : null;

        const values = {
          name: entry.name,
          currentBalance: entry.balance,
          // Sin tasa declarada, cero: es lo que la columna admite y lo que el
          // orden de ataque lee como «no se puede ordenar por costo». No es
          // una tasa de cero por ciento afirmada sobre nada.
          apr: entry.apr ?? '0',
          minimumPayment: entry.minimumPayment ?? '0',
          kind: entry.kind,
          repayment: entry.repayment,
          isPayrollDeducted: entry.isPayrollDeducted,
          paymentFrequency: entry.paymentFrequency,
          // Lo revolvente y lo abierto no tienen cuota que fechar: una tarjeta
          // tiene corte y pago en sus propias columnas, y lo que se le debe a
          // un hermano no tiene día.
          anchorDays:
            entry.repayment === 'revolving' ||
            entry.repayment === 'open' ||
            !entry.anchorDays ||
            entry.anchorDays.length === 0
              ? null
              : [...new Set(entry.anchorDays)].sort((a, b) => a - b),
          // El cupo solo en una tarjeta y las cuotas solo fuera de ella: la
          // base rechaza lo contrario, y normalizarlo aquí evita que un cambio
          // de clase reviente el guardado al final con un error de esquema.
          creditLimit: isCard ? (entry.creditLimit ?? null) : null,
          // Lo revolvente no tiene cuotas, y la base lo rechaza. Se normaliza
          // aquí para que cambiar de forma no reviente el guardado al final.
          termMonths:
            entry.repayment === 'revolving' || entry.repayment === 'open'
              ? null
              : (entry.termMonths ?? null),
          paidMonths:
            entry.repayment === 'revolving' || entry.repayment === 'open'
              ? null
              : (entry.paidMonths ?? null),
        };

        let debtId = entry.id;
        if (debtId) {
          await tx
            .update(debts)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(debts.id, debtId), eq(debts.householdId, householdId)));
        } else {
          const [created] = await tx
            .insert(debts)
            .values({
              householdId,
              currency,
              // Nothing here knows the original amount borrowed, and inventing
              // one would put a number nobody stated into a financial column.
              principal: entry.balance,
              ...values,
            })
            .returning({ id: debts.id });
          debtId = created?.id;
        }
        if (debtId) keptDebts.push(debtId);

        if (!isCard || !debtId) continue;

        const [existing] = await tx
          .select({ id: accounts.id })
          .from(debts)
          .innerJoin(accounts, eq(accounts.id, debts.accountId))
          .where(and(eq(debts.id, debtId), isNull(accounts.deletedAt)))
          .limit(1);

        const cardValues = {
          name: entry.name,
          accountType: 'credit_card' as const,
          // What the account holds, which for a card is what is owed on it.
          currentBalance: `-${entry.balance}`,
          creditLimit: entry.creditLimit ?? null,
          personId: holder,
        };

        if (existing) {
          await tx
            .update(accounts)
            .set({ ...cardValues, updatedAt: new Date() })
            .where(eq(accounts.id, existing.id));
        } else {
          const [card] = await tx
            .insert(accounts)
            .values({
              householdId,
              ownerId: session.user.id,
              createdBy: session.user.id,
              currency,
              status: 'active' as const,
              source: 'user' as const,
              ...cardValues,
            })
            .returning({ id: accounts.id });
          if (card) {
            await tx.update(debts).set({ accountId: card.id }).where(eq(debts.id, debtId));
          }
        }
      }
      await tx
        .update(debts)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(debts.householdId, householdId),
            isNull(debts.deletedAt),
            notInArray(debts.id, survivors(keptDebts)),
          ),
        );

      // Goals. No `deleted_at` here — a goal that is set aside is paused, which
      // is a state the goal screen already understands and can undo.
      /**
       * Holdings.
       *
       * The symbol and the quantity are written; the price is not. It lives in
       * `app.market_prices` with the source that said it and the moment it was
       * said, put there by the lookup the form ran while somebody typed. A
       * holding that carried its own price would be a household asserting what
       * a market did.
       */
      const keptHoldings: string[] = [];
      for (const entry of answers.holdings) {
        const holder = entry.personName?.trim()
          ? (peopleByName.get(entry.personName.trim()) ?? null)
          : null;
        const values = {
          symbol: entry.symbol.toUpperCase(),
          label: entry.label,
          quantity: entry.quantity,
          kind: entry.kind,
          currency: entry.currency,
          personId: holder,
        };
        if (entry.id) {
          await tx
            .update(holdings)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(holdings.id, entry.id), eq(holdings.householdId, householdId)));
          keptHoldings.push(entry.id);
        } else {
          const [created] = await tx
            .insert(holdings)
            .values({ householdId, createdBy: session.user.id, ...values })
            .returning({ id: holdings.id });
          if (created) keptHoldings.push(created.id);
        }
      }
      await tx
        .update(holdings)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(holdings.householdId, householdId),
            isNull(holdings.deletedAt),
            notInArray(holdings.id, survivors(keptHoldings)),
          ),
        );

      const keptGoals: string[] = [];
      for (const [index, entry] of answers.goals.entries()) {
        const values = {
          name: entry.name,
          targetAmount: entry.targetAmount,
          // The order they were written in is the order they matter in, until
          // the person says otherwise.
          priority: 100 + index,
          // Lo ya apartado. Sin decirlo, cero: una meta empieza vacía y suponer
          // un avance que nadie declaró sería regalarle dinero en el papel.
          currentAmount: entry.currentAmount ?? '0',
          // Confirmarla es una afirmación de la casa; el reparto la usa para
          // ponerla por delante. Una meta que no está activa no puede estar
          // confirmada y la base lo rechaza.
          isCommitted: entry.isCommitted,
          ...(isPlainDateString(entry.targetDate) ? { targetDate: entry.targetDate } : {}),
        };
        if (entry.id) {
          await tx
            .update(goals)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(goals.id, entry.id), eq(goals.householdId, householdId)));
          keptGoals.push(entry.id);
        } else {
          const [created] = await tx
            .insert(goals)
            .values({
              householdId,
              createdBy: session.user.id,
              currency,
              status: 'active' as const,
              ...values,
            })
            .returning({ id: goals.id });
          if (created) keptGoals.push(created.id);
        }
      }
      await tx
        .update(goals)
        .set({ status: 'paused' as const, updatedAt: new Date() })
        .where(
          and(
            eq(goals.householdId, householdId),
            eq(goals.status, 'active'),
            notInArray(goals.id, survivors(keptGoals)),
          ),
        );
    });
  } catch (error) {
    // Logged, not shown. The household gets a sentence they can act on; the
    // reason the database gave belongs in the server log, where it can name a
    // constraint without naming somebody's money.
    console.error('[setup] save failed:', error instanceof Error ? error.message : error);
    return { error: 'saveFailed' };
  }

  const locale = formData.get('locale') === 'en' ? 'en' : 'es';
  for (const path of [
    'overview',
    'plan',
    'advice',
    'alerts',
    'reports',
    'accounts',
    'categories',
    'people',
    'documents',
    'welcome',
  ]) {
    revalidatePath(`/${locale}/${path}`);
  }

  // Straight to the advice, because a plan of action is what the questions
  // were for. It is the same figures the plan screen renders, put in the order
  // they should be acted on, and it links through to the line-by-line detail.
  // Landing back on the position would show a balance and hide the answer.
  // `redirect` throws, so the revalidations above have to come first.
  redirect(`/${locale}/advice`);
}

/** The next time a monthly claim falls due, clamped into a short month. */
function nextDueOn(today: PlainDate, day: number): PlainDate {
  const [year = '0', month = '1'] = today.split('-');
  const lastDayThisMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const candidate = plainDateFromParts(
    Number(year),
    Number(month),
    Math.min(day, lastDayThisMonth),
  );
  // Today still counts as due: a rent payment due today is not next month's
  // problem, and hiding it would overstate what is available right now.
  return candidate >= today ? candidate : addMonths(candidate, 1);
}

const FREQUENCY_MONTHS = {
  daily: 0,
  weekly: 0,
  biweekly: 0,
  semimonthly: 0,
  monthly: 1,
  quarterly: 3,
  annual: 12,
} as const;

const FREQUENCY_DAYS = { daily: 1, weekly: 7, biweekly: 14, semimonthly: 15 } as const;

/**
 * The next day a twice-monthly income actually lands on.
 *
 * Not «fifteen days from today», which is what the generic step does and which
 * is wrong for exactly the households this matters most to: a salary paid on
 * the 5th and the 20th, first seen on the 12th, would be projected onto the
 * 27th and every fortnight after it would be off by a week. The whole point of
 * asking for the two days is to stop approximating them.
 */
function nextAnchorDay(today: PlainDate, anchors: readonly number[]): PlainDate {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  const sorted = [...anchors].sort((a, b) => a - b);

  const lastOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  for (const anchor of sorted) {
    const clamped = Math.min(anchor, lastOf(year, month));
    if (clamped > day) return plainDateFromParts(year, month, clamped);
  }

  // Every anchor is behind us: the first one of next month.
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const first = sorted[0] ?? 15;
  return plainDateFromParts(nextYear, nextMonth, Math.min(first, lastOf(nextYear, nextMonth)));
}

function nextFor(
  today: PlainDate,
  frequency: keyof typeof FREQUENCY_MONTHS,
  anchors?: readonly number[],
): PlainDate {
  if (frequency === 'semimonthly' && anchors && anchors.length > 0) {
    return nextAnchorDay(today, anchors);
  }

  const months = FREQUENCY_MONTHS[frequency];
  if (months > 0) return addMonths(today, months);

  const days = FREQUENCY_DAYS[frequency as keyof typeof FREQUENCY_DAYS];
  const millis = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10)) + days,
  );
  return new Date(millis).toISOString().slice(0, 10) as PlainDate;
}

function isPlainDateString(value: string | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
