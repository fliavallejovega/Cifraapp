import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { appSchema, recurrenceFrequency } from './app.js';
import {
  accounts,
  categories,
  financialScope,
  merchants,
  provenance,
  transactionDirection,
} from './financial.js';
import { households, profiles } from './identity.js';

// Reexportado desde aquí, que es donde vivía: moverlo a `app.ts` fue para
// romper un ciclo entre este módulo y `financial.ts`, no para cambiarle la casa
// a quien ya lo importaba.
export { recurrenceFrequency };
import { currencies } from './platform.js';

/**
 * Recurring series, mirroring `20260807060000_recurring.sql`.
 *
 * A series is the pattern; `app.obligations` holds the individual claims it
 * generates. Keeping them separate is what lets an obligation be settled by a
 * transaction while the pattern that produced it carries on.
 */

/**
 * Si el monto declarado de un ingreso ya trae descontado lo que se descuenta.
 *
 * `net` es lo que la gente escribe, porque es lo que ve en el banco, y es el
 * lado conservador: sobreestimar el ingreso de alguien es el error que hace
 * daño. Con `gross`, los compromisos marcados «se descuenta de la planilla» y
 * atados a este ingreso se restan antes de que ningún motor lo use.
 */
export const incomeBasis = pgEnum('income_basis', ['net', 'gross']);

export const recurringSeries = appSchema.table(
  'recurring_series',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    merchantId: uuid('merchant_id').references(() => merchants.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'set null' }),

    name: text('name').notNull(),
    direction: transactionDirection('direction').notNull().default('outflow'),
    scope: financialScope('scope').notNull().default('household'),

    /**
     * Si el monto ya trae descontado lo que sale de la planilla.
     *
     * Decide una cifra financiera y por eso se pregunta en vez de suponerse: con
     * `gross`, un hogar que declara $3,347 y tiene $700 de descuentos atados a
     * ese sueldo dispone de $2,647 y no de $3,347.
     */
    statedBasis: incomeBasis('stated_basis').notNull().default('net'),

    /** A median, so one unusual month does not move it. */
    expectedAmount: numeric('expected_amount', {
      precision: 19,
      scale: 4,
      mode: 'string',
    }).notNull(),
    currency: char('currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),

    /**
     * What the payslip says before deductions, when the household stated it.
     *
     * `expectedAmount` above always stays what actually arrives, because every
     * plan, period and projection reads it as cash. This one is for
     * reconciling: a household that sees «$1,000» cannot square it with a
     * contract that says $1,400 unless both figures are on the screen.
     */
    grossAmount: numeric('gross_amount', { precision: 19, scale: 4, mode: 'string' }),

    frequency: recurrenceFrequency('frequency').notNull(),
    /** Calendar days a semimonthly series lands on; 31 means month end. */
    anchorDays: smallint('anchor_days').array(),

    /**
     * What arrives on each anchor day, when the two are not the same.
     *
     * A deduction taken once a month lands on one fortnight, not half on each,
     * so a salary of $1,500 gross can arrive as $1,203.50 on the 15th and
     * $1,053.50 on the 30th. Averaging those to $1,128.50 is right about the
     * month and wrong about both halves — and the fortnight view exists for
     * exactly the half that runs short.
     *
     * `expectedAmount` stays the average, because everything that does not
     * reason by period reads it as the month's cash. Null means the same figure
     * every time, which is the ordinary case.
     */
    anchorAmounts: numeric('anchor_amounts', { precision: 19, scale: 4, mode: 'string' }).array(),

    lastSeenOn: date('last_seen_on').notNull(),
    nextExpectedDate: date('next_expected_date').notNull(),

    confidence: numeric('confidence', { precision: 4, scale: 3, mode: 'string' }).notNull(),
    amountVariation: numeric('amount_variation', { precision: 6, scale: 4, mode: 'string' })
      .notNull()
      .default('0'),
    occurrenceCount: integer('occurrence_count').notNull(),

    isEssential: boolean('is_essential').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),

    detectedBy: provenance('detected_by').notNull().default('system'),
    confirmedBy: uuid('confirmed_by').references(() => profiles.id, { onDelete: 'set null' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('recurring_series_household_idx').on(table.householdId, table.nextExpectedDate),
    index('recurring_series_merchant_idx').on(table.householdId, table.merchantId),
  ],
);

export const recurringSeriesRelations = relations(recurringSeries, ({ one }) => ({
  merchant: one(merchants, { fields: [recurringSeries.merchantId], references: [merchants.id] }),
  category: one(categories, { fields: [recurringSeries.categoryId], references: [categories.id] }),
  account: one(accounts, { fields: [recurringSeries.accountId], references: [accounts.id] }),
}));

/**
 * What is taken out of an income before it arrives, as the household reads it
 * off their own payslip.
 *
 * Deliberately not a rate table. Panama's contribution and withholding rates
 * live —or will live— in `platform.tax_rules`, versioned, sourced, and behind a
 * gate that refuses to show a household any figure nobody qualified has
 * reviewed. These rows are the other thing entirely: amounts a person copied
 * from a piece of paper. The product does arithmetic on them and asserts
 * nothing about what the law says they should be.
 */
export const incomeDeductions = appSchema.table(
  'income_deductions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id').notNull(),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => recurringSeries.id, { onDelete: 'cascade' }),
    /** As the payslip words it — «S.S.», «Caja de Seguro Social», «ISR». */
    label: text('label').notNull(),
    amount: numeric('amount', { precision: 19, scale: 4, mode: 'string' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    /** The order they appear on the payslip, so the screen reads like the paper. */
    sortOrder: smallint('sort_order').notNull().default(0),

    /**
     * The days this deduction is actually taken on, when it is not every one.
     *
     * Social security, education tax and income tax come off every payment —
     * they are a percentage of that period's salary and have no other shape.
     * A co-op subscription or a loan instalment comes off once a month, which
     * means one of the two fortnights. Null is «every payment», the ordinary
     * case and what every row stored before this column existed meant.
     */
    appliesToAnchors: smallint('applies_to_anchors').array(),

    /**
     * La regla que produjo esta línea, cuando se calculó en vez de escribirse.
     *
     * Una línea calculada sale de cada pago por construcción —es un porcentaje
     * del sueldo del período— y por eso nunca lleva `appliesToAnchors`: la
     * pregunta «¿en qué quincena?» no tiene respuesta para el seguro social.
     * Nulo es lo que alguien leyó de su propio papel, que es lo que significaba
     * cada fila antes de que esta columna existiera.
     */
    ruleKey: text('rule_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('income_deductions_series_idx').on(table.seriesId, table.sortOrder)],
);

/**
 * El cuestionario a medio contestar, del hogar y no del navegador.
 *
 * Una fila por hogar, y cualquier miembro la continúa: quien arranca la
 * descripción de la casa suele ser quien tiene tiempo esa tarde, y quien sabe
 * el saldo de la cuenta es la otra persona. Guardarlo en el navegador las
 * obligaba a terminar en el mismo dispositivo.
 *
 * `answers` es opaco a propósito. No es un hogar descrito: son campos vacíos y
 * filas a medio llenar, y nada de eso cuenta como dato financiero hasta que se
 * envía entero, en una transacción, a las tablas que sí tienen forma.
 */
export const setupDrafts = appSchema.table('setup_drafts', {
  householdId: uuid('household_id')
    .primaryKey()
    .references(() => households.id, { onDelete: 'cascade' }),
  answers: jsonb('answers').notNull(),
  /** En qué paso se quedó, para no repetir pantallas ya contestadas. */
  step: smallint('step').notNull().default(0),
  /** Quién lo dejó así, para poder decirlo al retomar. */
  updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Cobrado o por cobrar, según lo diga el hogar. No lo calcula el producto. */
/**
 * Cuán seguro es un cobro, en los tres grados que un independiente distingue.
 *
 *   confirmed  facturado y aceptado; el cliente dijo que paga
 *   likely     acordado de palabra, sin factura emitida
 *   estimated  en conversación; puede no ocurrir
 *
 * Ninguno suma a «disponible para gastar». El grado decide cuánto peso tiene en
 * el calendario del plan y con qué fuerza se muestra, nunca si el dinero está.
 */
export const receivableConfidence = pgEnum('receivable_confidence', [
  'confirmed',
  'likely',
  'estimated',
]);

/**
 * Lo que la familia va a cobrar, y cuándo.
 *
 * Una factura del mes que viene, un préstamo que devuelven, el décimo tercer
 * mes. Nada de eso es una cadencia —no se repite, tiene fecha propia— y por eso
 * no cabe en `recurringSeries`, que existe para lo que vuelve a pasar.
 *
 * **No es dinero disponible y el plan no lo reparte.** Un cobro tratado como
 * cierto es la cifra optimista que arruina un presupuesto: el cliente paga
 * tarde, el hermano no paga, y la casa ya gastó contra eso. El plan se hace con
 * lo que entró; esto se enseña al lado, para poder perseguirlo.
 */
export const receivables = appSchema.table(
  'receivables',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** De quién viene. Un cobro sin origen no se puede reclamar. */
    source: text('source'),
    amount: numeric('amount', { precision: 19, scale: 4, mode: 'string' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    /** Nula cuando no se sabe: «me deben 500 y no sé cuándo» es una respuesta. */
    expectedOn: date('expected_on'),
    /**
     * La ventana en que se espera, para lo que llega seguro pero no en un día
     * fijo.
     *
     * Un independiente sabe que esa factura entra en la primera quincena. No
     * saber el día no es no saber nada, y tratarlo como si lo fuera dejaba
     * fuera del calendario la mitad del ingreso de una casa que vive de vender.
     * Con fecha exacta, ambas son ese mismo día.
     *
     * Tener ventana no lo vuelve disponible para gastar: eso sigue siendo sólo
     * lo que está en la cuenta.
     */
    expectedFrom: date('expected_from'),
    expectedTo: date('expected_to'),
    confidence: receivableConfidence('confidence').notNull().default('estimated'),
    /** Cobrado. No se borra: un cobro que entró es historia del hogar. */
    receivedOn: date('received_on'),
    /**
     * El movimiento importado que lo cobró, cuando se concilió contra uno.
     *
     * Es lo que hace comprobable «esto ya me lo pagaron» meses después, en vez
     * de una afirmación. Nulo mientras sea sólo expectativa, y nulo también
     * cuando el hogar lo dio por recibido a mano sin haber importado nada.
     */
    receivedTransactionId: uuid('received_transaction_id'),
    /**
     * Lo que se apartó para impuesto en el momento de cobrar esto.
     *
     * Congelado: subir la tasa en junio no cambia lo que marzo reservó. Un
     * porcentaje aplicado hacia atrás reescribe la historia del hogar.
     */
    taxReserved: numeric('tax_reserved', { precision: 19, scale: 4, mode: 'string' })
      .notNull()
      .default('0'),
    /** La tasa que lo produjo, para que la cifra siga siendo explicable. */
    taxReservedRate: numeric('tax_reserved_rate', { precision: 5, scale: 2, mode: 'string' }),
    /** Cuándo dejó de ser un reclamo, porque el impuesto se pagó. */
    taxReleasedOn: date('tax_released_on'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('receivables_household_idx').on(table.householdId, table.expectedOn)],
);
