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

import { appSchema, categoryKind, recurrenceFrequency } from './app.js';
import { households, profiles } from './identity.js';
import { currencies } from './platform.js';

/**
 * The financial model, mirroring `20260806140000_financial_model.sql`.
 *
 * Two conventions run through all of it and are not negotiable:
 *
 *   - Money is `numeric(19,4)`, surfaced to TypeScript as a string. Drizzle
 *     would happily hand back a JS number, which is the float this whole system
 *     exists to avoid — so every monetary column is `mode: 'string'` and is
 *     parsed through `Money.fromDecimalString` at the boundary (ADR-005).
 *   - Financial dates are `date`, surfaced as a string. A `Date` here would
 *     reintroduce the timezone drift that moves a transaction between months
 *     (ADR-006).
 */

const money = (name: string) => numeric(name, { precision: 19, scale: 4, mode: 'string' });

export const accountType = pgEnum('account_type', [
  'checking',
  'savings',
  'credit_card',
  'loan',
  'mortgage',
  'investment',
  'cash',
  'digital_wallet',
  'business',
  'tax_reserve',
  'other_asset',
  'other_liability',
]);

export const accountStatus = pgEnum('account_status', ['active', 'closed', 'archived']);

export const financialScope = pgEnum('financial_scope', [
  'personal',
  'partner',
  'household',
  'business',
]);

export const transactionStatus = pgEnum('transaction_status', [
  'pending',
  'posted',
  'excluded',
  'transfer',
  'duplicate',
  'needs_review',
  'reconciled',
]);

export const transactionDirection = pgEnum('transaction_direction', ['inflow', 'outflow']);

export const provenance = pgEnum('provenance', [
  'system',
  'user',
  'ai',
  'accountant',
  'imported',
  'bank',
  'rule',
  'tax_rule',
]);

export const taxClassification = pgEnum('tax_classification', [
  'personal',
  'business',
  'mixed',
  'non_deductible',
  'potentially_deductible',
  'requires_review',
]);

export const debtStrategy = pgEnum('debt_strategy', ['avalanche', 'snowball', 'custom', 'hybrid']);
export const goalStatus = pgEnum('goal_status', ['active', 'reached', 'paused', 'abandoned']);
export const budgetPeriod = pgEnum('budget_period', ['weekly', 'monthly', 'annual', 'sinking']);

export const institutions = appSchema.table('institutions', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  name: text('name').notNull(),
  country: char('country', { length: 2 }).notNull().default('PA'),
  parserKey: text('parser_key').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = appSchema.table(
  'accounts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'set null' }),
    /**
     * The household member this belongs to, when it belongs to a person rather
     * than to the household — «Rosa's card». Distinct from `ownerId`, which is
     * the profile that administers it: most people a household names never get
     * a login of their own.
     */
    personId: uuid('person_id'),
    institutionId: uuid('institution_id').references(() => institutions.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    /** Last four digits at most. Full account numbers are never stored. */
    maskedNumber: text('masked_number'),
    accountType: accountType('account_type').notNull(),
    scope: financialScope('scope').notNull().default('household'),
    currency: char('currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),
    currentBalance: money('current_balance').notNull().default('0'),
    availableBalance: money('available_balance'),
    creditLimit: money('credit_limit'),
    /**
     * What the account earns, as a percentage: 3.250 is 3.25%.
     *
     * Asked, never assumed. A bank's rate changes, varies by product and by
     * balance tier, and this system has no source for it — seeding a plausible
     * figure would put a number nobody stated into a column that projections
     * read. Null means «not stated», which is not zero.
     */
    interestRate: numeric('interest_rate', { precision: 6, scale: 3, mode: 'string' }),
    status: accountStatus('status').notNull().default('active'),
    source: provenance('source').notNull().default('user'),
    lastImportedAt: timestamp('last_imported_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('accounts_household_idx').on(table.householdId)],
);

export const merchants = appSchema.table('merchants', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  /** The category this merchant's transactions have settled into (Phase 6). */
  defaultCategoryId: uuid('default_category_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const merchantAliases = appSchema.table('merchant_aliases', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  merchantId: uuid('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  pattern: text('pattern').notNull(),
  source: provenance('source').notNull().default('system'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const categories = appSchema.table(
  'categories',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    templateSlug: text('template_slug'),
    name: text('name').notNull(),
    kind: categoryKind('kind').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isSystem: boolean('is_system').notNull().default(false),
    /** Nombre estable del icono. El dibujo pertenece al sistema de diseño. */
    icon: text('icon'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('categories_household_idx').on(table.householdId)],
);

export const transactions = appSchema.table(
  'transactions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'set null' }),

    transactionDate: date('transaction_date').notNull(),
    postedDate: date('posted_date'),

    amount: money('amount').notNull(),
    currency: char('currency', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    direction: transactionDirection('direction').notNull(),

    /** Never destroyed. Normalization has to be reversible. */
    descriptionOriginal: text('description_original').notNull(),
    descriptionNormalized: text('description_normalized').notNull(),

    merchantId: uuid('merchant_id').references(() => merchants.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    categorySource: provenance('category_source'),
    categoryConfidence: numeric('category_confidence', { precision: 4, scale: 3, mode: 'string' }),

    scope: financialScope('scope').notNull().default('household'),
    taxClassification: taxClassification('tax_classification'),
    businessPercentage: numeric('business_percentage', { precision: 5, scale: 2, mode: 'string' }),

    status: transactionStatus('status').notNull().default('posted'),

    source: provenance('source').notNull().default('imported'),
    sourceDocumentId: uuid('source_document_id'),
    sourceImportId: uuid('source_import_id'),
    externalReference: text('external_reference'),
    fingerprint: text('fingerprint').notNull(),
    duplicateGroupId: uuid('duplicate_group_id'),

    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('transactions_household_date_idx').on(table.householdId, table.transactionDate),
    index('transactions_account_date_idx').on(table.accountId, table.transactionDate),
    index('transactions_fingerprint_idx').on(table.householdId, table.fingerprint),
  ],
);

export const transfers = appSchema.table('transfers', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  fromTransactionId: uuid('from_transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'cascade' }),
  toTransactionId: uuid('to_transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'cascade' }),
  amount: money('amount').notNull(),
  currency: char('currency', { length: 3 })
    .notNull()
    .references(() => currencies.code),
  /** The purchases behind this balance were already counted as spending. */
  isCardPayment: boolean('is_card_payment').notNull().default(false),
  confidence: numeric('confidence', { precision: 4, scale: 3, mode: 'string' }).notNull(),
  detectedBy: provenance('detected_by').notNull().default('system'),
  confirmedBy: uuid('confirmed_by').references(() => profiles.id, { onDelete: 'set null' }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const duplicateCandidates = appSchema.table('duplicate_candidates', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  existingTransactionId: uuid('existing_transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'cascade' }),
  incomingTransactionId: uuid('incoming_transaction_id').references(() => transactions.id, {
    onDelete: 'cascade',
  }),
  importId: uuid('import_id'),
  confidence: numeric('confidence', { precision: 4, scale: 3, mode: 'string' }).notNull(),
  /** Which rules fired, so the decision can be explained and audited. */
  matchedSignals: jsonb('matched_signals').notNull().default([]),
  resolution: text('resolution'),
  resolvedBy: uuid('resolved_by').references(() => profiles.id, { onDelete: 'set null' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const obligations = appSchema.table(
  'obligations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    merchantId: uuid('merchant_id').references(() => merchants.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    expectedAmount: money('expected_amount').notNull(),
    currency: char('currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),
    dueDate: date('due_date').notNull(),
    frequency: text('frequency'),
    /**
     * The calendar days a semimonthly obligation lands on, `31` meaning month
     * end. Null for every other cadence.
     *
     * The same meaning the column carries on `recurring_series`, and the field
     * that lets a payment exist in the fortnight of the 15th and not in the one
     * of the 30th — which is the whole reason those two fortnights feel
     * different to the household living in them.
     */
    anchorDays: smallint('anchor_days').array(),
    nextExpectedDate: date('next_expected_date'),
    isEssential: boolean('is_essential').notNull().default(true),
    /**
     * The income this payment comes out of.
     *
     * Says nothing about *when*. A household can pay the rent from one salary
     * without anybody deducting it from a payslip, and until these were two
     * columns saying so meant lying about the other half. This one exists so a
     * household can order itself — «esto sale del sueldo de Blei» — and so
     * advice can be about a person's own money rather than about an average.
     *
     * The foreign key onto `recurring_series` lives in the migration rather
     * than here, for the same reason `seriesId` above does: this module is
     * imported *by* `recurring.ts`.
     */
    paidFromSeriesId: uuid('paid_from_series_id'),
    /**
     * True when the money never reaches an account at all.
     *
     * Then it is owed and shown, but it is not a claim on any balance — the
     * stated salary is already net of it, and counting it again subtracts the
     * same deduction twice from «lo que de verdad te queda».
     */
    isDeductedAtSource: boolean('is_deducted_at_source').notNull().default(false),
    /**
     * One amount per anchor day, in the same order as `anchorDays`.
     *
     * Because a fortnight does not always pay what the other one pays. Null is
     * the ordinary case and means the same amount every time; a list of a
     * different length is refused by the schema rather than letting a screen
     * silently pick which day goes unpriced.
     */
    anchorAmounts: numeric('anchor_amounts', { precision: 19, scale: 4, mode: 'string' }).array(),
    /**
     * What paying this late costs, in whichever shape the contract states it.
     *
     * Two columns rather than one number and a unit, so a rate can never be
     * read as an amount: «5%» silently becoming «$5» on a two-thousand-dollar
     * rent is wrong by two orders of magnitude, in the direction that hurts.
     * At most one is ever set, which the schema enforces. Both null is the
     * ordinary case and means no penalty was stated — never that there is none.
     */
    lateFeeAmount: numeric('late_fee_amount', { precision: 19, scale: 4, mode: 'string' }),
    lateFeeRate: numeric('late_fee_rate', { precision: 6, scale: 3, mode: 'string' }),
    /** Days of grace after the due date. Zero is a real and common answer. */
    lateFeeAfterDays: smallint('late_fee_after_days'),
    confidence: numeric('confidence', { precision: 4, scale: 3, mode: 'string' }),
    detectedBy: provenance('detected_by').notNull().default('user'),
    /** The pattern that generated this claim, when one did (Phase 7). */
    seriesId: uuid('series_id'),
    /** Set once a real transaction settles it, so it stops being a claim. */
    settledTransactionId: uuid('settled_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('obligations_household_due_idx').on(table.householdId, table.dueDate)],
);

export const budgets = appSchema.table('budgets', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  period: budgetPeriod('period').notNull().default('monthly'),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on'),
  scope: financialScope('scope').notNull().default('household'),
  rollsOver: boolean('rolls_over').notNull().default(false),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const budgetLines = appSchema.table('budget_lines', {
  id: uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`),
  budgetId: uuid('budget_id')
    .notNull()
    .references(() => budgets.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  plannedAmount: money('planned_amount').notNull(),
  /** Carried in from the period before, when the budget rolls over (Phase 7). */
  rolloverIn: money('rollover_in').notNull().default('0'),
  currency: char('currency', { length: 3 })
    .notNull()
    .default('USD')
    .references(() => currencies.code),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const goals = appSchema.table(
  'goals',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    targetAmount: money('target_amount').notNull(),
    currentAmount: money('current_amount').notNull().default('0'),
    currency: char('currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),
    targetDate: date('target_date'),
    priority: integer('priority').notNull().default(100),
    /**
     * La casa dijo que esta va.
     *
     * Se declara, nunca se deduce de tener fecha: «algún día en diciembre» es
     * una fecha, y adivinar el compromiso sería mover el dinero de un hogar
     * porque alguien escribió un día en una casilla.
     */
    isCommitted: boolean('is_committed').notNull().default(false),
    scope: financialScope('scope').notNull().default('household'),
    status: goalStatus('status').notNull().default('active'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('goals_household_idx').on(table.householdId, table.priority)],
);

/** Una tarjeta no se parece a una hipoteca, y el formulario tiene que saberlo. */
export const debtKind = pgEnum('debt_kind', [
  'credit_card',
  'auto_loan',
  'mortgage',
  'personal_loan',
  'student_loan',
  'other',
]);

/**
 * Cómo se paga un crédito, que no es lo mismo que qué clase de crédito es.
 *
 * Una hipoteca y un préstamo entre amigos pueden pagarse igual, y una hipoteca
 * y una línea del mismo banco no. La forma decide qué preguntar y qué se puede
 * calcular: una cuota fija baja el capital cada mes, un préstamo de solo
 * intereses no lo baja hasta el final, y una tarjeta no termina.
 */
export const debtRepayment = pgEnum('debt_repayment', [
  'fixed_instalment',
  'declining_instalment',
  'interest_only',
  'single_payment',
  'no_interest_plan',
  'revolving',
]);

export const debts = appSchema.table(
  'debts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    principal: money('principal').notNull(),
    currentBalance: money('current_balance').notNull(),
    currency: char('currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),
    /** A percentage: 24.500 means 24.5%. */
    apr: numeric('apr', { precision: 6, scale: 3, mode: 'string' }).notNull(),
    minimumPayment: money('minimum_payment').notNull().default('0'),
    dueDay: smallint('due_day'),
    statementDay: smallint('statement_day'),
    creditLimit: money('credit_limit'),
    /**
     * Qué clase de deuda es.
     *
     * Una tarjeta tiene cupo y da vueltas; una hipoteca no tiene cupo y sí
     * tiene final. Sin esta distinción el formulario no sabe qué está mirando y
     * le pide a un préstamo un límite que no existe.
     */
    kind: debtKind('kind').notNull().default('other'),
    /** Cuántas cuotas en total. Nula en lo que por diseño no termina. */
    termMonths: smallint('term_months'),
    /** Cuántas van pagadas. «18 de 60» es lo que la gente sabe de su préstamo. */
    paidMonths: smallint('paid_months'),
    repayment: debtRepayment('repayment'),
    /**
     * Descuento directo: la cuota sale de la planilla antes de que el sueldo
     * llegue. Ese dinero nunca entra a la cuenta, así que no puede reclamar un
     * saldo que ya no lo tiene.
     */
    isPayrollDeducted: boolean('is_payroll_deducted').notNull().default(false),
    /** El día del mes en que se cobra la cuota, cuando la hay. */
    instalmentDay: smallint('instalment_day'),
    /**
     * Cada cuánto se cobra la cuota.
     *
     * Mensual es lo corriente, y una hipoteca con descuento directo muy a
     * menudo no lo es: se cobra por quincena, y guardarla como mensual es
     * correcto sobre el mes y falso sobre las dos mitades.
     */
    paymentFrequency: recurrenceFrequency('payment_frequency').notNull().default('monthly'),
    /** Los días en que cae. Uno para la mensual, dos para la quincenal. */
    anchorDays: smallint('anchor_days').array(),
    promotionalApr: numeric('promotional_apr', { precision: 6, scale: 3, mode: 'string' }),
    promotionalExpiresOn: date('promotional_expires_on'),
    strategyPriority: integer('strategy_priority'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('debts_household_idx').on(table.householdId)],
);

export const householdSettings = appSchema.table('household_settings', {
  householdId: uuid('household_id')
    .primaryKey()
    .references(() => households.id, { onDelete: 'cascade' }),
  /** The floor the household refuses to go below. The gauge's threshold mark. */
  bufferMinimum: money('buffer_minimum').notNull().default('0'),
  debtStrategy: debtStrategy('debt_strategy').notNull().default('avalanche'),
  taxReserveRate: numeric('tax_reserve_rate', { precision: 5, scale: 2, mode: 'string' }),
  /** People the income has to cover. Stated during setup, never inferred. */
  memberCount: smallint('member_count'),
  /** How many of those do not earn. A subset of `memberCount`. */
  dependentCount: smallint('dependent_count'),
  /** Null until the setup questionnaire is answered, so it is asked once. */
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accountRelations = relations(accounts, ({ many, one }) => ({
  transactions: many(transactions),
  household: one(households, {
    fields: [accounts.householdId],
    references: [households.id],
  }),
}));

export const transactionRelations = relations(transactions, ({ one }) => ({
  account: one(accounts, { fields: [transactions.accountId], references: [accounts.id] }),
  merchant: one(merchants, { fields: [transactions.merchantId], references: [merchants.id] }),
  category: one(categories, { fields: [transactions.categoryId], references: [categories.id] }),
}));

/**
 * The last quote per symbol, shared by every household.
 *
 * Reference data, not household data: it says what a market said, never what
 * anybody owns. `asOf` and `source` are not nullable on purpose — a price
 * without a moment is a lie by omission, and a price without a source is a
 * rumour.
 */
export const marketPrices = appSchema.table('market_prices', {
  symbol: text('symbol').primaryKey(),
  kind: text('kind').notNull(),
  displayName: text('display_name').notNull(),
  /** Eight decimals, and deliberately not `money`: a quote is not an amount. */
  price: numeric('price', { precision: 19, scale: 8, mode: 'string' }).notNull(),
  currency: char('currency', { length: 3 })
    .notNull()
    .references(() => currencies.code),
  previousClose: numeric('previous_close', { precision: 19, scale: 8, mode: 'string' }),
  source: text('source').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * What a household owns beyond cash.
 *
 * The quantity is stated by the household; the price it is valued at lives in
 * `marketPrices` and carries its own source and moment. Keeping them in
 * separate tables is what lets a screen say which half came from whom.
 */
export const holdings = appSchema.table(
  'holdings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`public.uuid_generate_v7()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Whose it is, when it belongs to a person rather than to the household. */
    personId: uuid('person_id'),
    kind: text('kind').notNull(),
    symbol: text('symbol').notNull(),
    /** What the household calls it. The provider's name is on the price row. */
    label: text('label').notNull(),
    /** Ten decimals: crypto divides far past a cent, and a quantity is not money. */
    quantity: numeric('quantity', { precision: 28, scale: 10, mode: 'string' }).notNull(),
    /** Optional: plenty of people do not know it, and inventing one turns an
        unknown gain into a stated one. */
    costBasis: money('cost_basis'),
    currency: char('currency', { length: 3 })
      .notNull()
      .default('USD')
      .references(() => currencies.code),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('holdings_household_idx').on(table.householdId)],
);
