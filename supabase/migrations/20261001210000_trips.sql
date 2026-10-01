-- Viajes: el módulo que presupuesta, acompaña y cierra un viaje de la familia.
--
-- Diseño en docs/viajes/01-diseno.md. Tres reglas que esta migración defiende:
--
--   1. **Un gasto de viaje es un movimiento.** No hay tabla de gastos: los
--      movimientos ganan columnas nulas que los atan a un viaje, un tramo y un
--      día. Una fila sin `trip_id` es exactamente lo que era antes.
--   2. **Todo es aditivo.** Ninguna columna existente cambia ni se borra.
--   3. **Un viaje no se mezcla con otro hogar.** Cada tabla hija repite
--      `household_id` y lo ata al del viaje con una llave compuesta, para que
--      ni una política mal escrita pueda colgar una fila de un viaje ajeno.
--
-- Las asignaciones del presupuesto no se guardan: las calcula el motor puro
-- (`@app/trip-engine`) en cada lectura. Aquí viven solo los insumos, que son
-- decisiones de la familia.

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------

create type app.trip_status as enum
  ('idea', 'planning', 'saving', 'booked', 'in_progress', 'completed', 'cancelled');
create type app.trip_profile as enum ('economy', 'balanced', 'comfort', 'custom');
create type app.trip_contingency as enum ('percent', 'fixed');
create type app.trip_rolling as enum ('rolling', 'fixed');
create type app.trip_cost_level as enum ('low', 'medium', 'high', 'very_high');
-- `undecided` es «todavía no sé dónde dormimos»: el motor aparta hospedaje del
-- fondo para esas noches. No es lo mismo que `none` (casa de familiares).
create type app.trip_lodging_mode as enum ('undecided', 'prepaid', 'pay_on_site', 'none');
create type app.trip_traveler_type as enum ('adult', 'child', 'infant');
create type app.trip_booking_type as enum
  ('flight', 'lodging', 'insurance', 'tour', 'transport', 'visa', 'other');
create type app.trip_payment_status as enum ('paid', 'deposit_paid', 'pay_later', 'pay_on_site');

-- ---------------------------------------------------------------------------
-- Monedas de destino
-- ---------------------------------------------------------------------------
--
-- Referencia, no capacidad: las cuentas y los movimientos siguen en USD o PAB.
-- Estas monedas solo aparecen como moneda local de un tramo, de una reserva o
-- como monto original de un gasto.

insert into platform.currencies (code, name_en, name_es, symbol, minor_units) values
  ('EUR', 'Euro', 'Euro', '€', 2),
  ('GBP', 'Pound sterling', 'Libra esterlina', '£', 2),
  ('CHF', 'Swiss franc', 'Franco suizo', 'CHF', 2),
  ('CAD', 'Canadian dollar', 'Dólar canadiense', 'CA$', 2),
  ('MXN', 'Mexican peso', 'Peso mexicano', 'MX$', 2),
  ('COP', 'Colombian peso', 'Peso colombiano', 'COL$', 2),
  ('CRC', 'Costa Rican colón', 'Colón costarricense', '₡', 2),
  ('GTQ', 'Guatemalan quetzal', 'Quetzal', 'Q', 2),
  ('DOP', 'Dominican peso', 'Peso dominicano', 'RD$', 2),
  ('PEN', 'Peruvian sol', 'Sol peruano', 'S/', 2),
  ('CLP', 'Chilean peso', 'Peso chileno', 'CLP$', 0),
  ('ARS', 'Argentine peso', 'Peso argentino', 'AR$', 2),
  ('BRL', 'Brazilian real', 'Real brasileño', 'R$', 2),
  ('JPY', 'Japanese yen', 'Yen japonés', '¥', 0)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Viajes
-- ---------------------------------------------------------------------------

create table app.trips (
  id                    uuid primary key default public.uuid_generate_v7(),
  household_id          uuid not null references app.households (id) on delete cascade,

  name                  text not null check (length(btrim(name)) between 1 and 120),
  status                app.trip_status not null default 'planning',

  -- Fechas de calendario en la zona del destino principal (ADR-006).
  start_date            date not null,
  end_date              date not null,

  base_currency         char(3) not null references platform.currencies (code),
  -- Todo el dinero que la familia destina al viaje, en moneda base.
  total_budget          numeric(19, 4) not null default 0 check (total_budget >= 0),
  -- Lo que ya tenían apartado al crearlo. Sirve para la meta, no para el motor.
  already_saved         numeric(19, 4) not null default 0 check (already_saved >= 0),

  contingency_type      app.trip_contingency not null default 'percent',
  -- Porcentaje (10.0000 = 10 %) o monto fijo en moneda base, según el tipo.
  contingency_value     numeric(19, 4) not null default 10 check (contingency_value >= 0),

  profile               app.trip_profile not null default 'balanced',
  -- Solo para `custom`: {categoría: puntos básicos}, que suman 10 000.
  custom_shares         jsonb,

  include_arrival_day   boolean not null default true,
  include_departure_day boolean not null default true,
  partial_day_weight    numeric(4, 3) not null default 0.5
                        check (partial_day_weight between 0 and 1),
  rolling_policy        app.trip_rolling not null default 'rolling',

  goal_id               uuid references app.goals (id) on delete set null,
  funding_account_id    uuid references app.accounts (id) on delete set null,
  active_scenario_id    uuid,

  -- Suma de `trip_reserve_releases`, mantenida en la misma transacción.
  reserve_released      numeric(19, 4) not null default 0 check (reserve_released >= 0),

  -- Tasa de planificación por moneda: {"EUR": {"rate": "1.0850", "date": "2026-10-01"}}.
  -- Unidades de moneda local por una de la base. Se fija al planear.
  planning_fx           jsonb not null default '{}'::jsonb,

  cover_emoji           text check (cover_emoji is null or length(cover_emoji) <= 16),
  notes                 text check (notes is null or length(notes) <= 2000),

  -- El resultado del cierre, congelado: el pasado no cambia si el motor cambia.
  closing_report        jsonb,
  completed_at          timestamptz,

  created_by            uuid references app.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,

  constraint trips_dates check (end_date >= start_date),
  -- Llave para que las tablas hijas aten su hogar al del viaje.
  constraint trips_id_household unique (id, household_id)
);

comment on table app.trips is
  'A household trip: dates, travellers, money set aside and how it is spread. Allocations are computed by @app/trip-engine on read, never stored.';

create index trips_household_idx on app.trips (household_id, start_date desc)
  where archived_at is null;

create trigger set_updated_at before update on app.trips
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tramos
-- ---------------------------------------------------------------------------

create table app.trip_legs (
  id              uuid primary key default public.uuid_generate_v7(),
  household_id    uuid not null,
  trip_id         uuid not null,

  position        smallint not null default 0,
  city            text not null check (length(btrim(city)) between 1 and 120),
  country_code    char(2) check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  place_label     text check (place_label is null or length(place_label) <= 120),

  arrival_date    date not null,
  departure_date  date not null,

  local_currency  char(3) not null references platform.currencies (code),
  cost_level      app.trip_cost_level not null default 'medium',
  -- 1.00 es la referencia. Editable: la familia sabe mejor que nadie cuánto
  -- cuesta su destino.
  cost_index      numeric(4, 2) not null default 1.00 check (cost_index > 0 and cost_index <= 5),
  timezone        text not null default 'America/Panama'
                  check (length(timezone) between 1 and 64),
  lodging_mode    app.trip_lodging_mode not null default 'undecided',

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint trip_legs_dates check (departure_date >= arrival_date),
  constraint trip_legs_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade,
  constraint trip_legs_id_trip unique (id, trip_id)
);

create index trip_legs_trip_idx on app.trip_legs (trip_id, position);

create trigger set_updated_at before update on app.trip_legs
  for each row execute function public.set_updated_at();

/**
 * Un tramo vive dentro de su viaje y no pisa a otro tramo, salvo el día de
 * transición: el día en que se sale de Madrid es el mismo en que se llega a
 * París, y ese solape de un día es correcto.
 *
 * Diferido al final de la transacción, para que reordenar o mover dos tramos
 * a la vez no falle en el estado intermedio.
 */
create or replace function app.check_trip_legs() returns trigger
language plpgsql
set search_path = app, public, pg_temp
as $$
declare
  t record;
begin
  select start_date, end_date into t from app.trips where id = new.trip_id;
  if not found then
    return null;
  end if;

  if new.arrival_date < t.start_date or new.departure_date > t.end_date then
    raise exception 'A leg must fall within its trip''s dates.'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from app.trip_legs o
     where o.trip_id = new.trip_id
       and o.id <> new.id
       and o.arrival_date < new.departure_date
       and new.arrival_date < o.departure_date
  ) then
    raise exception 'Two legs of a trip may share only their transition day.'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger trip_legs_fit
  after insert or update on app.trip_legs
  deferrable initially deferred
  for each row execute function app.check_trip_legs();

-- ---------------------------------------------------------------------------
-- Viajeros
-- ---------------------------------------------------------------------------

create table app.trip_travelers (
  id              uuid primary key default public.uuid_generate_v7(),
  household_id    uuid not null,
  trip_id         uuid not null,

  -- Una persona de la casa, con cuenta o sin ella. Nulo para quien viaja con
  -- la familia sin ser parte de ella.
  person_id       uuid references app.household_people (id) on delete set null,
  display_name    text not null check (length(btrim(display_name)) between 1 and 120),
  traveler_type   app.trip_traveler_type not null default 'adult',
  -- Cuánto «pesa» en el gasto: adulto 1, niño 0,6, infante 0,2 por defecto.
  weight          numeric(4, 3) not null default 1 check (weight >= 0 and weight <= 5),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint trip_travelers_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade
);

create index trip_travelers_trip_idx on app.trip_travelers (trip_id);

create trigger set_updated_at before update on app.trip_travelers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Escenarios
-- ---------------------------------------------------------------------------

create table app.trip_scenarios (
  id              uuid primary key default public.uuid_generate_v7(),
  household_id    uuid not null,
  trip_id         uuid not null,

  name            text not null check (length(btrim(name)) between 1 and 80),
  -- Lo que el escenario cambia: fondo, reserva, perfil, porcentajes, tasas.
  params          jsonb not null default '{}'::jsonb,
  position        smallint not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint trip_scenarios_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade
);

create index trip_scenarios_trip_idx on app.trip_scenarios (trip_id, position);

create trigger set_updated_at before update on app.trip_scenarios
  for each row execute function public.set_updated_at();

alter table app.trips
  add constraint trips_active_scenario
  foreign key (active_scenario_id) references app.trip_scenarios (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Ajustes manuales
-- ---------------------------------------------------------------------------

create table app.trip_overrides (
  id              uuid primary key default public.uuid_generate_v7(),
  household_id    uuid not null,
  trip_id         uuid not null,

  scenario_id     uuid references app.trip_scenarios (id) on delete cascade,
  leg_id          uuid references app.trip_legs (id) on delete cascade,
  trip_day        date,
  category        text not null check (category in
                    ('lodging', 'food', 'local_transport', 'activities', 'shopping', 'other')),
  amount          numeric(19, 4) not null check (amount >= 0),

  created_by      uuid references app.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint trip_overrides_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade
);

create unique index trip_overrides_unique on app.trip_overrides (
  trip_id,
  coalesce(scenario_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(leg_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(trip_day, '0001-01-01'::date),
  category
);

create trigger set_updated_at before update on app.trip_overrides
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Reservas y compromisos
-- ---------------------------------------------------------------------------

create table app.trip_bookings (
  id                  uuid primary key default public.uuid_generate_v7(),
  household_id        uuid not null,
  trip_id             uuid not null,
  leg_id              uuid references app.trip_legs (id) on delete set null,

  booking_type        app.trip_booking_type not null,
  provider            text check (provider is null or length(provider) <= 120),
  reference_code      text check (reference_code is null or length(reference_code) <= 60),

  -- Horarios de itinerario, no fechas financieras: un vuelo sale a una hora.
  starts_at           timestamptz,
  ends_at             timestamptz,

  -- En la moneda en que se pagó, y su equivalente en la base del viaje.
  amount              numeric(19, 4) not null check (amount >= 0),
  currency            char(3) not null references platform.currencies (code),
  amount_base         numeric(19, 4) not null check (amount_base >= 0),
  fx_rate             numeric(20, 10) check (fx_rate is null or fx_rate > 0),
  fx_rate_date        date,

  payment_status      app.trip_payment_status not null default 'paid',
  paid_amount         numeric(19, 4) not null default 0 check (paid_amount >= 0),
  due_date            date,

  transaction_id      uuid references app.transactions (id) on delete set null,
  document_id         uuid references app.documents (id) on delete set null,

  -- Forma por tipo (segmentos de vuelo, noches de hotel…). Validada en el
  -- servidor; nunca lleva números de tarjeta ni de pasaporte.
  details             jsonb not null default '{}'::jsonb,

  created_by          uuid references app.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  constraint trip_bookings_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade,
  constraint trip_bookings_times check (ends_at is null or starts_at is null or ends_at >= starts_at),
  constraint trip_bookings_paid_le_amount check (paid_amount <= amount)
);

create index trip_bookings_trip_idx on app.trip_bookings (trip_id) where deleted_at is null;
create index trip_bookings_due_idx on app.trip_bookings (household_id, due_date)
  where deleted_at is null and due_date is not null;

create trigger set_updated_at before update on app.trip_bookings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Usos de la reserva de imprevistos
-- ---------------------------------------------------------------------------

create table app.trip_reserve_releases (
  id              uuid primary key default public.uuid_generate_v7(),
  household_id    uuid not null,
  trip_id         uuid not null,
  trip_day        date not null,
  amount          numeric(19, 4) not null check (amount > 0),
  note            text check (note is null or length(note) <= 300),
  created_by      uuid references app.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint trip_reserve_releases_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade
);

create index trip_reserve_releases_trip_idx on app.trip_reserve_releases (trip_id);

-- ---------------------------------------------------------------------------
-- Pendientes financieros
-- ---------------------------------------------------------------------------

create table app.trip_checklist_items (
  id              uuid primary key default public.uuid_generate_v7(),
  household_id    uuid not null,
  trip_id         uuid not null,
  booking_id      uuid references app.trip_bookings (id) on delete cascade,

  -- El texto sale del catálogo i18n (`trips.checklist.<kind>`), no de la fila.
  kind            text not null check (kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  title_params    jsonb not null default '{}'::jsonb,
  -- Para lo que la familia escribe a mano.
  custom_title    text check (custom_title is null or length(custom_title) <= 160),
  due_on          date,
  done_at         timestamptz,
  done_by         uuid references app.profiles (id) on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint trip_checklist_items_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade
);

create unique index trip_checklist_items_booking_kind
  on app.trip_checklist_items (booking_id, kind) where booking_id is not null;
create index trip_checklist_items_trip_idx on app.trip_checklist_items (trip_id, due_on);

create trigger set_updated_at before update on app.trip_checklist_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Avance automático de una meta
-- ---------------------------------------------------------------------------
--
-- `goals.current_amount` se escribe a mano. Cuando la familia paga los pasajes
-- con la meta del viaje en marcha, ese pago es avance: se suma a la meta y
-- queda aquí de dónde vino, para poder deshacerlo si la reserva se borra.

create table app.goal_credits (
  id              uuid primary key default public.uuid_generate_v7(),
  household_id    uuid not null references app.households (id) on delete cascade,
  goal_id         uuid not null references app.goals (id) on delete cascade,
  source_kind     text not null check (source_kind in ('trip_booking')),
  source_id       uuid not null,
  amount          numeric(19, 4) not null check (amount > 0),
  created_by      uuid references app.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint goal_credits_once unique (goal_id, source_kind, source_id)
);

comment on table app.goal_credits is
  'Automatic progress credited to a goal, with its source, so it can be reversed. goals.current_amount includes these amounts.';

create index goal_credits_source_idx on app.goal_credits (source_kind, source_id);

-- ---------------------------------------------------------------------------
-- Movimientos: las columnas del viaje
-- ---------------------------------------------------------------------------

alter table app.transactions
  add column trip_id             uuid references app.trips (id) on delete set null,
  add column trip_leg_id         uuid references app.trip_legs (id) on delete set null,
  add column trip_category       text check (trip_category is null or trip_category in (
    'lodging', 'food', 'local_transport', 'activities', 'shopping', 'other',
    'flights', 'insurance', 'visas', 'long_transport')),
  -- El día del viaje, en la zona del tramo; no el de la base de datos.
  add column trip_day            date,
  add column paid_by_traveler_id uuid references app.trip_travelers (id) on delete set null,
  -- El monto tal como se pagó en destino, con el mismo signo que `amount`.
  add column original_amount     numeric(19, 4),
  add column original_currency   char(3) references platform.currencies (code),
  -- Unidades de moneda local por una de la base. Inmutable salvo edición.
  add column fx_rate             numeric(20, 10) check (fx_rate is null or fx_rate > 0),
  add column fx_rate_date        date,
  add column fx_source           text check (fx_source is null or fx_source in ('ecb', 'manual', 'card_statement')),
  -- Idempotencia: un gasto registrado sin conexión o con doble toque llega una vez.
  add column client_ref          uuid,
  add constraint transactions_original_currency_complete check (
    (original_amount is null and original_currency is null and fx_rate is null
       and fx_rate_date is null and fx_source is null)
    or (original_amount is not null and original_currency is not null and fx_rate is not null
       and fx_rate_date is not null and fx_source is not null)
  ),
  add constraint transactions_trip_parts_need_trip check (
    trip_id is not null
    or (trip_leg_id is null and trip_category is null and trip_day is null
        and paid_by_traveler_id is null)
  );

create index transactions_trip_day_idx on app.transactions (trip_id, trip_day)
  where trip_id is not null and deleted_at is null;

create unique index transactions_client_ref_unique on app.transactions (household_id, client_ref)
  where client_ref is not null;

/**
 * Un movimiento solo se ata a un viaje de su propio hogar, y su tramo y su
 * viajero tienen que ser de ese viaje. La llave foránea simple no lo garantiza.
 */
create or replace function app.check_transaction_trip() returns trigger
language plpgsql
set search_path = app, public, pg_temp
as $$
begin
  if new.trip_id is null then
    return new;
  end if;

  if not exists (select 1 from app.trips where id = new.trip_id and household_id = new.household_id) then
    raise exception 'A transaction can only belong to a trip of its own household.'
      using errcode = '23514';
  end if;

  if new.trip_leg_id is not null
     and not exists (select 1 from app.trip_legs where id = new.trip_leg_id and trip_id = new.trip_id) then
    raise exception 'The leg must belong to the transaction''s trip.'
      using errcode = '23514';
  end if;

  if new.paid_by_traveler_id is not null
     and not exists (select 1 from app.trip_travelers where id = new.paid_by_traveler_id and trip_id = new.trip_id) then
    raise exception 'The traveller must belong to the transaction''s trip.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger transactions_trip_consistent
  before insert or update of trip_id, trip_leg_id, paid_by_traveler_id, household_id
  on app.transactions
  for each row execute function app.check_transaction_trip();

-- Lo mismo para reservas, ajustes y pendientes que apuntan a un tramo o reserva.
create or replace function app.check_trip_child_refs() returns trigger
language plpgsql
set search_path = app, public, pg_temp
as $$
declare
  leg uuid := new.leg_id;
begin
  if leg is not null
     and not exists (select 1 from app.trip_legs where id = leg and trip_id = new.trip_id) then
    raise exception 'The leg must belong to the same trip.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trip_bookings_refs before insert or update on app.trip_bookings
  for each row execute function app.check_trip_child_refs();
create trigger trip_overrides_refs before insert or update on app.trip_overrides
  for each row execute function app.check_trip_child_refs();

-- ---------------------------------------------------------------------------
-- Documentos de viaje
-- ---------------------------------------------------------------------------

alter type app.document_kind add value if not exists 'flight_itinerary';
alter type app.document_kind add value if not exists 'boarding_pass';
alter type app.document_kind add value if not exists 'lodging_confirmation';
alter type app.document_kind add value if not exists 'ticket';
alter type app.document_kind add value if not exists 'insurance_policy';

alter table app.documents
  add column trip_id uuid references app.trips (id) on delete set null;

create index documents_trip_idx on app.documents (trip_id) where trip_id is not null;

alter type app.ai_feature add value if not exists 'trip_document_extract';
alter type app.ai_feature add value if not exists 'trip_quick_create';

-- ---------------------------------------------------------------------------
-- Tasas de cambio
-- ---------------------------------------------------------------------------

create table platform.fx_rates (
  id          uuid primary key default public.uuid_generate_v7(),
  base        char(3) not null references platform.currencies (code),
  quote       char(3) not null references platform.currencies (code),
  -- Unidades de `quote` por una de `base`.
  rate        numeric(20, 10) not null check (rate > 0),
  rate_date   date not null,
  source      text not null check (source in ('ecb', 'manual')),
  created_at  timestamptz not null default now(),

  constraint fx_rates_distinct check (base <> quote),
  constraint fx_rates_unique unique (base, quote, rate_date, source)
);

comment on table platform.fx_rates is
  'Daily reference exchange rates (ECB via Frankfurter). Reference data; a transaction keeps the rate it actually used.';

create index fx_rates_lookup_idx on platform.fx_rates (base, quote, rate_date desc);

-- ---------------------------------------------------------------------------
-- Categorías de viaje
-- ---------------------------------------------------------------------------

-- El padre existe desde la semilla; se asegura aquí para que la migración
-- aplique igual sobre una base vacía.
insert into app.category_templates (slug, parent_slug, name_en, name_es, kind, sort_order, icon)
values ('travel', null, 'Travel', 'Viajes', 'expense', 38, 'plane')
on conflict (slug) do nothing;

insert into app.category_templates (slug, parent_slug, name_en, name_es, kind, sort_order, icon) values
  ('travel-lodging',         'travel', 'Lodging',               'Hospedaje',                 'expense', 1, 'home'),
  ('travel-food',            'travel', 'Food while travelling', 'Comida en viaje',           'expense', 2, 'cutlery'),
  ('travel-local-transport', 'travel', 'Local transport',       'Transporte local',          'expense', 3, 'bus'),
  ('travel-activities',      'travel', 'Activities and tickets', 'Actividades y entradas',   'expense', 4, 'play'),
  ('travel-shopping',        'travel', 'Shopping and souvenirs', 'Compras y recuerdos',      'expense', 5, 'bag'),
  ('travel-other',           'travel', 'Other travel costs',    'Otros del viaje',           'expense', 6, 'tag'),
  ('travel-flights',         'travel', 'Flights',               'Vuelos',                    'expense', 7, 'plane'),
  ('travel-insurance',       'travel', 'Travel insurance',      'Seguro de viaje',           'expense', 8, 'shield'),
  ('travel-visas',           'travel', 'Visas and documents',   'Visas y documentos',        'expense', 9, 'book'),
  ('travel-long-transport',  'travel', 'Trains, buses and car rental', 'Trenes, buses y auto', 'expense', 10, 'car')
on conflict (slug) do update
  set parent_slug = excluded.parent_slug,
      name_en = excluded.name_en,
      name_es = excluded.name_es,
      kind = excluded.kind,
      sort_order = excluded.sort_order,
      icon = excluded.icon;

do $$
declare
  target uuid;
begin
  for target in select id from app.households loop
    perform app.seed_household_categories(target);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- El flag
-- ---------------------------------------------------------------------------

insert into platform.feature_flags (key, description, default_enabled)
values ('trips_module', 'Viajes: presupuesto, ahorro, modo en viaje y cierre de un viaje.', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'trips', 'trip_legs', 'trip_travelers', 'trip_scenarios', 'trip_overrides',
    'trip_bookings', 'trip_reserve_releases', 'trip_checklist_items', 'goal_credits'
  ] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
    execute format('drop policy if exists %I on app.%I', t || '_household_access', t);
    execute format(
      'create policy %I on app.%I for all to authenticated
         using (app.is_household_member(household_id))
         with check (app.is_household_member(household_id))',
      t || '_household_access', t);
    execute format('drop policy if exists %I on app.%I', t || '_readable_by_accountant', t);
    execute format(
      'create policy %I on app.%I for select to authenticated
         using (app.has_accountant_access(household_id, ''read''))',
      t || '_readable_by_accountant', t);
    execute format('grant select, insert, update, delete on app.%I to authenticated', t);
  end loop;
end;
$$;

alter table platform.fx_rates enable row level security;
alter table platform.fx_rates force row level security;
create policy fx_rates_readable on platform.fx_rates for select to authenticated using (true);
grant select on platform.fx_rates to authenticated;
