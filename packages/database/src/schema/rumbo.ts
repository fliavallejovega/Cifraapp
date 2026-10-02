import { sql } from 'drizzle-orm';
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

import { appSchema } from './app.js';
import { documents } from './documents.js';
import { currencies, platformSchema } from './platform.js';
import { tripBookings, tripLegs, trips } from './trips.js';

/**
 * Rumbo, mirroring `20261002120000_rumbo.sql`: the places, fixed points,
 * wishes, flights, routed drives, lodging options and purchases that arm a
 * trip end to end. The day-by-day itinerary is not stored: `@app/itinerary`
 * computes it on every read from these inputs.
 */

const money = (name: string) => numeric(name, { precision: 19, scale: 4, mode: 'string' });
const coord = (name: string) => numeric(name, { precision: 9, scale: 6, mode: 'string' });

export const rumboCertainty = pgEnum('rumbo_certainty', ['confirmed', 'estimated', 'unverified']);
export const rumboAnchorKind = pgEnum('rumbo_anchor_kind', [
  'stay',
  'event',
  'friends',
  'car_pickup',
  'car_return',
]);
export const rumboTodoStatus = pgEnum('rumbo_todo_status', ['pending', 'bought', 'dismissed']);
export const entryStatus = platformSchema.enum('entry_status', [
  'visa_free',
  'evisa',
  'eta',
  'visa_required',
  'unknown',
]);

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`public.uuid_generate_v7()`);
const stamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};
const tripRef = () =>
  uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' });
const source = {
  certainty: rumboCertainty('certainty').notNull().default('estimated'),
  sourceName: text('source_name'),
  checkedOn: date('checked_on'),
};

export const tripPlaces = appSchema.table('trip_places', {
  id: id(),
  householdId: uuid('household_id').notNull(),
  tripId: tripRef(),
  catalogId: text('catalog_id'),
  name: text('name').notNull(),
  countryCode: char('country_code', { length: 2 }).notNull(),
  lat: coord('lat').notNull(),
  lon: coord('lon').notNull(),
  timeZone: text('time_zone').notNull(),
  kind: text('kind')
    .$type<'city' | 'town' | 'pass' | 'poi' | 'airport' | 'port' | 'market'>()
    .notNull(),
  altitudeM: integer('altitude_m'),
  ...source,
  sourceUrl: text('source_url'),
  ...stamps,
});

export const tripAnchors = appSchema.table(
  'trip_anchors',
  {
    id: id(),
    householdId: uuid('household_id').notNull(),
    tripId: tripRef(),
    kind: rumboAnchorKind('kind').notNull(),
    placeId: uuid('place_id')
      .notNull()
      .references(() => tripPlaces.id, { onDelete: 'cascade' }),
    fromDate: date('from_date').notNull(),
    toDate: date('to_date').notNull(),
    minNights: smallint('min_nights'),
    maxNights: smallint('max_nights'),
    hosted: boolean('hosted').notNull().default(false),
    paid: boolean('paid').notNull().default(false),
    label: text('label'),
    certainty: rumboCertainty('certainty').notNull().default('confirmed'),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    bookingId: uuid('booking_id').references(() => tripBookings.id, { onDelete: 'set null' }),
    ...stamps,
  },
  (table) => [index('trip_anchors_trip_idx').on(table.tripId, table.fromDate)],
);

export const tripWishes = appSchema.table('trip_wishes', {
  id: id(),
  householdId: uuid('household_id').notNull(),
  tripId: tripRef(),
  body: text('body').notNull(),
  tags: text('tags').array().notNull().default([]),
  position: smallint('position').notNull().default(0),
  ...stamps,
});

export const tripFlightSegments = appSchema.table(
  'trip_flight_segments',
  {
    id: id(),
    householdId: uuid('household_id').notNull(),
    tripId: tripRef(),
    bookingId: uuid('booking_id').references(() => tripBookings.id, { onDelete: 'set null' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    position: smallint('position').notNull().default(0),
    carrier: text('carrier'),
    flightNumber: text('flight_number'),
    fromIata: char('from_iata', { length: 3 }).notNull(),
    toIata: char('to_iata', { length: 3 }).notNull(),
    /** Wall-clock time at the airport, never converted on write. */
    departsLocal: timestamp('departs_local', { mode: 'string' }).notNull(),
    departsTz: text('departs_tz').notNull(),
    departsCertainty: rumboCertainty('departs_certainty').notNull(),
    arrivesLocal: timestamp('arrives_local', { mode: 'string' }).notNull(),
    arrivesTz: text('arrives_tz').notNull(),
    arrivesCertainty: rumboCertainty('arrives_certainty').notNull(),
    recordLocator: text('record_locator'),
    baggage: text('baggage'),
    ...stamps,
  },
  (table) => [index('trip_flight_segments_trip_idx').on(table.tripId, table.departsLocal)],
);

export interface DriveLegRow {
  readonly from: string;
  readonly to: string;
  readonly distanceM: number;
  readonly durationS: number;
  readonly ascentM?: number;
  readonly maxElevationM?: number;
}

export const tripDrives = appSchema.table(
  'trip_drives',
  {
    id: id(),
    householdId: uuid('household_id').notNull(),
    tripId: tripRef(),
    driveDate: date('drive_date').notNull(),
    position: smallint('position').notNull().default(0),
    purpose: text('purpose').$type<'move' | 'day_trip'>().notNull(),
    points: text('points').array().notNull(),
    mode: text('mode').$type<'car' | 'ferry' | 'train' | 'transfer'>().notNull(),
    legs: jsonb('legs').$type<DriveLegRow[]>().notNull().default([]),
    geometry: jsonb('geometry').$type<[number, number, number][]>(),
    requestHash: text('request_hash').notNull(),
    status: text('status').$type<'pending' | 'routed' | 'failed'>().notNull().default('pending'),
    failure: text('failure'),
    sourceName: text('source_name'),
    sourceUrl: text('source_url'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    ...stamps,
  },
  (table) => [index('trip_drives_trip_idx').on(table.tripId, table.driveDate, table.position)],
);

export const tripLodgingOptions = appSchema.table(
  'trip_lodging_options',
  {
    id: id(),
    householdId: uuid('household_id').notNull(),
    tripId: tripRef(),
    legId: uuid('leg_id')
      .notNull()
      .references(() => tripLegs.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<'airbnb' | 'booking' | 'other'>().notNull(),
    listingId: text('listing_id'),
    name: text('name').notNull(),
    kind: text('kind'),
    rating: numeric('rating', { precision: 3, scale: 2, mode: 'string' }),
    reviews: integer('reviews'),
    totalPrice: money('total_price'),
    currency: char('currency', { length: 3 }).references(() => currencies.code),
    url: text('url'),
    recommended: boolean('recommended').notNull().default(false),
    breakfast: boolean('breakfast'),
    parking: boolean('parking'),
    position: smallint('position').notNull().default(0),
    certainty: rumboCertainty('certainty').notNull().default('unverified'),
    sourceName: text('source_name'),
    checkedOn: date('checked_on'),
    ...stamps,
  },
  (table) => [index('trip_lodging_options_leg_idx').on(table.legId, table.position)],
);

export const tripTodos = appSchema.table('trip_todos', {
  id: id(),
  householdId: uuid('household_id').notNull(),
  tripId: tripRef(),
  todoKey: text('todo_key').notNull(),
  kind: text('kind').notNull(),
  titleParams: jsonb('title_params').$type<Record<string, string>>().notNull().default({}),
  countryCode: char('country_code', { length: 2 }),
  url: text('url'),
  dueOn: date('due_on'),
  saleOpensOn: date('sale_opens_on'),
  status: rumboTodoStatus('status').notNull().default('pending'),
  confirmationCode: text('confirmation_code'),
  boughtAt: timestamp('bought_at', { withTimezone: true }),
  orphanedAt: timestamp('orphaned_at', { withTimezone: true }),
  ...source,
  sourceUrl: text('source_url'),
  ...stamps,
});

export const entryRules = platformSchema.table('entry_rules', {
  id: id(),
  passportCountry: char('passport_country', { length: 2 }).notNull(),
  zone: text('zone').notNull(),
  status: entryStatus('status').notNull(),
  maxStayDays: smallint('max_stay_days'),
  windowDays: smallint('window_days'),
  conditions: jsonb('conditions').$type<Record<string, unknown>>().notNull().default({}),
  sourceName: text('source_name').notNull(),
  sourceUrl: text('source_url').notNull(),
  checkedOn: date('checked_on').notNull(),
  validFrom: date('valid_from'),
  validTo: date('valid_to'),
  ...stamps,
});

export const borderSystems = platformSchema.table('border_systems', {
  id: text('id').$type<'ees' | 'etias'>().primaryKey(),
  zone: text('zone').notNull(),
  startsOn: date('starts_on'),
  exempt: char('exempt', { length: 2 }).array().notNull().default([]),
  sourceName: text('source_name').notNull(),
  sourceUrl: text('source_url').notNull(),
  checkedOn: date('checked_on').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
