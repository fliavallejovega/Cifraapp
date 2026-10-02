import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { householdPeople } from './administration.js';
import { appSchema } from './app.js';
import { documents } from './documents.js';
import { accounts, goals, transactions } from './financial.js';
import { households, profiles } from './identity.js';
import { currencies, platformSchema } from './platform.js';

/**
 * Viajes, mirroring `20261001210000_trips.sql`.
 *
 * Money is `numeric(19,4)` surfaced as a string (ADR-005); trip dates are
 * calendar dates (ADR-006). The allocations are not here on purpose: the pure
 * engine in `@app/trip-engine` computes them on every read from these inputs.
 */

const money = (name: string) => numeric(name, { precision: 19, scale: 4, mode: 'string' });
const rate = (name: string) => numeric(name, { precision: 20, scale: 10, mode: 'string' });

export const tripStatus = pgEnum('trip_status', [
  'idea',
  'planning',
  'saving',
  'booked',
  'in_progress',
  'completed',
  'cancelled',
]);
export const tripProfile = pgEnum('trip_profile', ['economy', 'balanced', 'comfort', 'custom']);
export const tripContingency = pgEnum('trip_contingency', ['percent', 'fixed']);
export const tripRolling = pgEnum('trip_rolling', ['rolling', 'fixed']);
export const tripCostLevel = pgEnum('trip_cost_level', ['low', 'medium', 'high', 'very_high']);
export const tripLodgingMode = pgEnum('trip_lodging_mode', [
  'undecided',
  'prepaid',
  'pay_on_site',
  'none',
]);
export const tripTravelerType = pgEnum('trip_traveler_type', ['adult', 'child', 'infant']);
export const tripBookingType = pgEnum('trip_booking_type', [
  'flight',
  'lodging',
  'insurance',
  'tour',
  'transport',
  'visa',
  'other',
]);
export const tripPaymentStatus = pgEnum('trip_payment_status', [
  'paid',
  'deposit_paid',
  'pay_later',
  'pay_on_site',
]);

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`);
const stamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const trips = appSchema.table(
  'trips',
  {
    id: id(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: tripStatus('status').notNull().default('planning'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    baseCurrency: char('base_currency', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    totalBudget: money('total_budget').notNull().default('0'),
    alreadySaved: money('already_saved').notNull().default('0'),
    contingencyType: tripContingency('contingency_type').notNull().default('percent'),
    contingencyValue: money('contingency_value').notNull().default('10'),
    profile: tripProfile('profile').notNull().default('balanced'),
    /** Only for `custom`: basis points per category, summing to 10 000. */
    customShares: jsonb('custom_shares').$type<Record<string, number>>(),
    includeArrivalDay: boolean('include_arrival_day').notNull().default(true),
    includeDepartureDay: boolean('include_departure_day').notNull().default(true),
    partialDayWeight: numeric('partial_day_weight', { precision: 4, scale: 3, mode: 'string' })
      .notNull()
      .default('0.5'),
    rollingPolicy: tripRolling('rolling_policy').notNull().default('rolling'),
    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    fundingAccountId: uuid('funding_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    activeScenarioId: uuid('active_scenario_id'),
    /** Where local cash bought for this trip is held (20261002000000). */
    cashAccountId: uuid('cash_account_id').references(() => accounts.id, { onDelete: 'set null' }),
    reserveReleased: money('reserve_released').notNull().default('0'),
    /** `{ EUR: { rate: "1.0850", date: "2026-10-01" } }`: local units per base unit. */
    planningFx: jsonb('planning_fx')
      .$type<Record<string, { rate: string; date: string }>>()
      .notNull()
      .default({}),
    coverEmoji: text('cover_emoji'),
    notes: text('notes'),
    closingReport: jsonb('closing_report'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // Rumbo (20261002120000): how the trip is armed end to end.
    rumboGroundMode: text('rumbo_ground_mode').$type<'car' | 'train' | 'mixed'>(),
    rumboDrivingBudget: smallint('rumbo_driving_budget').notNull().default(360),
    rumboDepartureTime: text('rumbo_departure_time').notNull().default('09:00'),
    rumboLodgingCap: money('rumbo_lodging_cap'),
    rumboLodgingPrefs: jsonb('rumbo_lodging_prefs')
      .$type<{ breakfast?: boolean; parking?: boolean }>()
      .notNull()
      .default({}),
    rumboPlan: jsonb('rumbo_plan').$type<Record<string, unknown>>(),
    rumboComposedAt: timestamp('rumbo_composed_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    ...stamps,
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [index('trips_household_idx').on(table.householdId, table.startDate)],
);

export const tripLegs = appSchema.table(
  'trip_legs',
  {
    id: id(),
    householdId: uuid('household_id').notNull(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull().default(0),
    city: text('city').notNull(),
    countryCode: char('country_code', { length: 2 }),
    placeLabel: text('place_label'),
    arrivalDate: date('arrival_date').notNull(),
    departureDate: date('departure_date').notNull(),
    localCurrency: char('local_currency', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    costLevel: tripCostLevel('cost_level').notNull().default('medium'),
    costIndex: numeric('cost_index', { precision: 4, scale: 2, mode: 'string' })
      .notNull()
      .default('1.00'),
    timezone: text('timezone').notNull().default('America/Panama'),
    lodgingMode: tripLodgingMode('lodging_mode').notNull().default('undecided'),
    // Rumbo (20261002120000): the stay behind the leg and what the person pays for it.
    placeId: uuid('place_id'),
    stayOrigin: text('stay_origin').$type<'anchor' | 'wish' | 'catalog' | 'flight' | 'manual'>(),
    hosted: boolean('hosted').notNull().default(false),
    myLodgingPrice: money('my_lodging_price'),
    myLodgingCurrency: char('my_lodging_currency', { length: 3 }).references(() => currencies.code),
    chosenOptionId: uuid('chosen_option_id'),
    ...stamps,
  },
  (table) => [index('trip_legs_trip_idx').on(table.tripId, table.position)],
);

export const tripTravelers = appSchema.table(
  'trip_travelers',
  {
    id: id(),
    householdId: uuid('household_id').notNull(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').references(() => householdPeople.id, { onDelete: 'set null' }),
    displayName: text('display_name').notNull(),
    travelerType: tripTravelerType('traveler_type').notNull().default('adult'),
    weight: numeric('weight', { precision: 4, scale: 3, mode: 'string' }).notNull().default('1'),
    nationalities: char('nationalities', { length: 2 }).array().notNull().default([]),
    residence: char('residence', { length: 2 }),
    ...stamps,
  },
  (table) => [index('trip_travelers_trip_idx').on(table.tripId)],
);

export const tripScenarios = appSchema.table('trip_scenarios', {
  id: id(),
  householdId: uuid('household_id').notNull(),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
  position: smallint('position').notNull().default(0),
  ...stamps,
});

export const tripOverrides = appSchema.table('trip_overrides', {
  id: id(),
  householdId: uuid('household_id').notNull(),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  scenarioId: uuid('scenario_id').references(() => tripScenarios.id, { onDelete: 'cascade' }),
  legId: uuid('leg_id').references(() => tripLegs.id, { onDelete: 'cascade' }),
  tripDay: date('trip_day'),
  category: text('category').notNull(),
  amount: money('amount').notNull(),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  ...stamps,
});

export const tripBookings = appSchema.table(
  'trip_bookings',
  {
    id: id(),
    householdId: uuid('household_id').notNull(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    legId: uuid('leg_id').references(() => tripLegs.id, { onDelete: 'set null' }),
    bookingType: tripBookingType('booking_type').notNull(),
    provider: text('provider'),
    referenceCode: text('reference_code'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    amount: money('amount').notNull(),
    currency: char('currency', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    amountBase: money('amount_base').notNull(),
    fxRate: rate('fx_rate'),
    fxRateDate: date('fx_rate_date'),
    paymentStatus: tripPaymentStatus('payment_status').notNull().default('paid'),
    paidAmount: money('paid_amount').notNull().default('0'),
    dueDate: date('due_date'),
    transactionId: uuid('transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    ...stamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('trip_bookings_trip_idx').on(table.tripId)],
);

export const tripReserveReleases = appSchema.table('trip_reserve_releases', {
  id: id(),
  householdId: uuid('household_id').notNull(),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  tripDay: date('trip_day').notNull(),
  amount: money('amount').notNull(),
  note: text('note'),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tripChecklistItems = appSchema.table('trip_checklist_items', {
  id: id(),
  householdId: uuid('household_id').notNull(),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id').references(() => tripBookings.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  titleParams: jsonb('title_params').$type<Record<string, string>>().notNull().default({}),
  customTitle: text('custom_title'),
  dueOn: date('due_on'),
  doneAt: timestamp('done_at', { withTimezone: true }),
  doneBy: uuid('done_by').references(() => profiles.id, { onDelete: 'set null' }),
  ...stamps,
});

export const goalCredits = appSchema.table('goal_credits', {
  id: id(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  goalId: uuid('goal_id')
    .notNull()
    .references(() => goals.id, { onDelete: 'cascade' }),
  sourceKind: text('source_kind').notNull(),
  sourceId: uuid('source_id').notNull(),
  amount: money('amount').notNull(),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fxRates = platformSchema.table('fx_rates', {
  id: id(),
  base: char('base', { length: 3 })
    .notNull()
    .references(() => currencies.code),
  quote: char('quote', { length: 3 })
    .notNull()
    .references(() => currencies.code),
  rate: rate('rate').notNull(),
  rateDate: date('rate_date').notNull(),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
