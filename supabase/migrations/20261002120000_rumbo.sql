-- Rumbo: la parte de Viajes que arma el viaje de punta a punta.
--
-- Diseño en docs/viajes/rumbo/. Las reglas que esta migración defiende son las
-- mismas de Viajes, más dos:
--
--   1. **Cada dato dice cuán seguro es.** `certainty` vale `confirmed` (lo dice
--      un boleto, una reserva o una fuente oficial), `estimated` (calculado) o
--      `unverified` (nadie lo ha confirmado). La pantalla muestra la diferencia.
--   2. **Lo que vence lleva fuente y fecha.** Rutas, reglas de entrada, precios
--      y requisitos guardan de dónde salieron y cuándo se consultaron.
--
-- Las estadías del itinerario son los mismos `trip_legs` del presupuesto: un
-- tramo que Rumbo crea queda marcado con su origen, y el presupuesto lo ve
-- como cualquier otro. El itinerario día por día no se guarda: lo calcula el
-- motor puro (`@app/itinerary`) en cada lectura.

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------

create type app.rumbo_certainty as enum ('confirmed', 'estimated', 'unverified');
create type app.rumbo_anchor_kind as enum ('stay', 'event', 'friends', 'car_pickup', 'car_return');
create type app.rumbo_ground_mode as enum ('car', 'train', 'mixed');
create type app.rumbo_todo_status as enum ('pending', 'bought', 'dismissed');
create type platform.entry_status as enum ('visa_free', 'evisa', 'eta', 'visa_required', 'unknown');

-- ---------------------------------------------------------------------------
-- Viaje y viajeros
-- ---------------------------------------------------------------------------

alter table app.trips
  add column rumbo_ground_mode      app.rumbo_ground_mode,
  -- Minutos al volante por día antes de avisar. 360 = 6 h.
  add column rumbo_driving_budget   smallint not null default 360
                                    check (rumbo_driving_budget between 60 and 900),
  -- Hora de salida por defecto en días de manejo, `HH:MM`.
  add column rumbo_departure_time   text not null default '09:00'
                                    check (rumbo_departure_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- Tope por noche de hospedaje, en moneda base.
  add column rumbo_lodging_cap      numeric(19, 4) check (rumbo_lodging_cap is null or rumbo_lodging_cap >= 0),
  -- {"breakfast": true, "parking": true}
  add column rumbo_lodging_prefs    jsonb not null default '{}'::jsonb,
  -- La última composición: corredores, sacrificios, deseos, versión del motor.
  add column rumbo_plan             jsonb,
  add column rumbo_composed_at      timestamptz;

alter table app.trip_travelers
  -- Todos los pasaportes que la persona puede presentar (ISO 3166-1 alfa-2).
  add column nationalities char(2)[] not null default '{}'
    check (array_position(nationalities, null) is null),
  add column residence     char(2) check (residence is null or residence ~ '^[A-Z]{2}$');

-- ---------------------------------------------------------------------------
-- Lugares
-- ---------------------------------------------------------------------------

create table app.trip_places (
  id              uuid primary key default public.uuid_generate_v7(),
  household_id    uuid not null,
  trip_id         uuid not null,

  -- El id del catálogo del motor, si el lugar viene de ahí.
  catalog_id      text check (catalog_id is null or catalog_id ~ '^[a-z0-9_-]{1,40}$'),
  name            text not null check (length(btrim(name)) between 1 and 160),
  country_code    char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  lat             numeric(9, 6) not null check (lat between -90 and 90),
  lon             numeric(9, 6) not null check (lon between -180 and 180),
  time_zone       text not null check (length(time_zone) between 1 and 64),
  kind            text not null check (kind in ('city', 'town', 'pass', 'poi', 'airport', 'port', 'market')),
  altitude_m      integer,

  certainty       app.rumbo_certainty not null default 'estimated',
  source_name     text check (source_name is null or length(source_name) <= 160),
  source_url      text check (source_url is null or source_url ~ '^https://'),
  checked_on      date,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint trip_places_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade,
  constraint trip_places_id_trip unique (id, trip_id)
);

create unique index trip_places_catalog on app.trip_places (trip_id, catalog_id)
  where catalog_id is not null;

create trigger set_updated_at before update on app.trip_places
  for each row execute function public.set_updated_at();

-- Las estadías son tramos: Rumbo los crea y los marca.
alter table app.trip_legs
  add column place_id          uuid,
  -- Quién creó el tramo. Nulo: la familia, a mano, desde Viajes.
  add column stay_origin       text check (stay_origin is null or stay_origin in
                                 ('anchor', 'wish', 'catalog', 'flight', 'manual')),
  -- Casa de amigos o familia: la noche vale cero.
  add column hosted            boolean not null default false,
  -- El precio total de la estadía que la persona escribió, en su moneda.
  add column my_lodging_price  numeric(19, 4) check (my_lodging_price is null or my_lodging_price >= 0),
  add column my_lodging_currency char(3) references platform.currencies (code),
  add column chosen_option_id  uuid,
  add constraint trip_legs_place foreign key (place_id, trip_id)
    references app.trip_places (id, trip_id) on delete set null (place_id),
  add constraint trip_legs_my_price_currency check (
    (my_lodging_price is null) = (my_lodging_currency is null)
  );

-- ---------------------------------------------------------------------------
-- Anclas y deseos
-- ---------------------------------------------------------------------------

create table app.trip_anchors (
  id              uuid primary key default public.uuid_generate_v7(),
  household_id    uuid not null,
  trip_id         uuid not null,

  kind            app.rumbo_anchor_kind not null,
  place_id        uuid not null,
  -- Primera y última noche (estadía, amigos) o el día mismo (evento, carro).
  from_date       date not null,
  to_date         date not null,
  min_nights      smallint check (min_nights is null or min_nights between 0 and 60),
  max_nights      smallint check (max_nights is null or max_nights between 0 and 60),
  hosted          boolean not null default false,
  paid            boolean not null default false,
  label           text check (label is null or length(label) <= 120),
  certainty       app.rumbo_certainty not null default 'confirmed',

  -- De dónde salió: un documento confirmado o una reserva del presupuesto.
  document_id     uuid references app.documents (id) on delete set null,
  booking_id      uuid references app.trip_bookings (id) on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint trip_anchors_dates check (to_date >= from_date),
  constraint trip_anchors_nights check (max_nights is null or min_nights is null or max_nights >= min_nights),
  constraint trip_anchors_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade,
  constraint trip_anchors_place foreign key (place_id, trip_id)
    references app.trip_places (id, trip_id) on delete cascade
);

create index trip_anchors_trip_idx on app.trip_anchors (trip_id, from_date);

create trigger set_updated_at before update on app.trip_anchors
  for each row execute function public.set_updated_at();

create table app.trip_wishes (
  id              uuid primary key default public.uuid_generate_v7(),
  household_id    uuid not null,
  trip_id         uuid not null,

  -- En palabras de la persona: «mi esposa quiere ir a las Dolomitas».
  body            text not null check (length(btrim(body)) between 1 and 300),
  tags            text[] not null default '{}',
  position        smallint not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint trip_wishes_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade
);

create index trip_wishes_trip_idx on app.trip_wishes (trip_id, position);

create trigger set_updated_at before update on app.trip_wishes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Vuelos
-- ---------------------------------------------------------------------------

create table app.trip_flight_segments (
  id                  uuid primary key default public.uuid_generate_v7(),
  household_id        uuid not null,
  trip_id             uuid not null,
  booking_id          uuid references app.trip_bookings (id) on delete set null,
  document_id         uuid references app.documents (id) on delete set null,

  position            smallint not null default 0,
  carrier             text check (carrier is null or length(carrier) <= 60),
  flight_number       text check (flight_number is null or flight_number ~ '^[A-Z0-9]{2,3}\s?[0-9]{1,5}[A-Z]?$'),
  from_iata           char(3) not null check (from_iata ~ '^[A-Z]{3}$'),
  to_iata             char(3) not null check (to_iata ~ '^[A-Z]{3}$'),

  -- Hora de pared en la zona del aeropuerto: nunca se convierte al guardar.
  departs_local       timestamp not null,
  departs_tz          text not null check (length(departs_tz) between 1 and 64),
  departs_certainty   app.rumbo_certainty not null,
  arrives_local       timestamp not null,
  arrives_tz          text not null check (length(arrives_tz) between 1 and 64),
  arrives_certainty   app.rumbo_certainty not null,

  record_locator      text check (record_locator is null or record_locator ~ '^[A-Z0-9]{5,8}$'),
  baggage             text check (baggage is null or length(baggage) <= 300),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint trip_flight_segments_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade
);

create index trip_flight_segments_trip_idx on app.trip_flight_segments (trip_id, departs_local);

create trigger set_updated_at before update on app.trip_flight_segments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Manejos: la caché de rutas
-- ---------------------------------------------------------------------------
--
-- Lo que el servicio de rutas devolvió para una lista de puntos, con su fuente
-- y su fecha. Un manejo no se vuelve a pedir mientras sus puntos no cambien;
-- otra ruta del mismo hogar con los mismos puntos reusa la respuesta.

create table app.trip_drives (
  id              uuid primary key default public.uuid_generate_v7(),
  household_id    uuid not null,
  trip_id         uuid not null,

  drive_date      date not null,
  position        smallint not null default 0,
  purpose         text not null check (purpose in ('move', 'day_trip')),
  -- Ids de `trip_places` o del catálogo, en orden.
  points          text[] not null check (cardinality(points) between 2 and 24),
  mode            text not null check (mode in ('car', 'ferry', 'train', 'transfer')),
  -- [{from, to, distanceM, durationS, ascentM, maxElevationM}]
  legs            jsonb not null default '[]'::jsonb,
  -- [[lon, lat, elevación]] simplificada.
  geometry        jsonb,
  request_hash    text not null check (length(request_hash) = 64),
  status          text not null default 'pending' check (status in ('pending', 'routed', 'failed')),
  failure         text check (failure is null or length(failure) <= 200),

  source_name     text check (source_name is null or length(source_name) <= 160),
  source_url      text check (source_url is null or source_url ~ '^https://'),
  fetched_at      timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint trip_drives_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade
);

create index trip_drives_trip_idx on app.trip_drives (trip_id, drive_date, position);
create index trip_drives_cache_idx on app.trip_drives (household_id, request_hash)
  where status = 'routed';

create trigger set_updated_at before update on app.trip_drives
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Hospedaje
-- ---------------------------------------------------------------------------

create table app.trip_lodging_options (
  id              uuid primary key default public.uuid_generate_v7(),
  household_id    uuid not null,
  trip_id         uuid not null,
  leg_id          uuid not null,

  provider        text not null check (provider in ('airbnb', 'booking', 'other')),
  -- El id del anuncio en su sitio; arma el link con fechas y personas.
  listing_id      text check (listing_id is null or listing_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  name            text not null check (length(btrim(name)) between 1 and 160),
  kind            text check (kind is null or length(kind) <= 60),
  rating          numeric(3, 2) check (rating is null or rating between 0 and 10),
  reviews         integer check (reviews is null or reviews >= 0),
  -- Total de la estadía, no por noche.
  total_price     numeric(19, 4) check (total_price is null or total_price >= 0),
  currency        char(3) references platform.currencies (code),
  url             text check (url is null or url ~ '^https://'),
  recommended     boolean not null default false,
  breakfast       boolean,
  parking         boolean,
  position        smallint not null default 0,

  certainty       app.rumbo_certainty not null default 'unverified',
  source_name     text check (source_name is null or length(source_name) <= 160),
  checked_on      date,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint trip_lodging_options_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade,
  constraint trip_lodging_options_leg foreign key (leg_id, trip_id)
    references app.trip_legs (id, trip_id) on delete cascade,
  constraint trip_lodging_options_price_currency check (
    (total_price is null) or (currency is not null)
  ),
  constraint trip_lodging_options_id_trip unique (id, trip_id)
);

create index trip_lodging_options_leg_idx on app.trip_lodging_options (leg_id, position);

create trigger set_updated_at before update on app.trip_lodging_options
  for each row execute function public.set_updated_at();

alter table app.trip_legs
  add constraint trip_legs_chosen_option foreign key (chosen_option_id, trip_id)
    references app.trip_lodging_options (id, trip_id) on delete set null (chosen_option_id);

-- ---------------------------------------------------------------------------
-- Reservas y compras
-- ---------------------------------------------------------------------------
--
-- Se generan del itinerario; `todo_key` es estable entre regeneraciones, para
-- que lo marcado como comprado no se pierda cuando el plan cambia.

create table app.trip_todos (
  id                uuid primary key default public.uuid_generate_v7(),
  household_id      uuid not null,
  trip_id           uuid not null,

  todo_key          text not null check (todo_key ~ '^[a-z0-9_:.-]{1,120}$'),
  -- El texto sale del catálogo i18n (`rumbo.todos.<kind>`), no de la fila.
  kind              text not null check (kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  title_params      jsonb not null default '{}'::jsonb,
  country_code      char(2) check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  url               text check (url is null or url ~ '^https://'),
  due_on            date,
  -- Para lo que se agota: el día en que abre la venta.
  sale_opens_on     date,
  status            app.rumbo_todo_status not null default 'pending',
  -- Número de reserva, nunca datos de tarjeta.
  confirmation_code text check (confirmation_code is null or length(confirmation_code) <= 60),
  bought_at         timestamptz,
  -- Ya no lo pide el plan; se conserva si estaba comprado.
  orphaned_at       timestamptz,

  certainty         app.rumbo_certainty not null default 'estimated',
  source_name       text check (source_name is null or length(source_name) <= 160),
  source_url        text check (source_url is null or source_url ~ '^https://'),
  checked_on        date,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint trip_todos_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade,
  constraint trip_todos_key unique (trip_id, todo_key)
);

create index trip_todos_due_idx on app.trip_todos (household_id, due_on)
  where status = 'pending' and orphaned_at is null;

create trigger set_updated_at before update on app.trip_todos
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Requisitos de entrada (referencia de la plataforma)
-- ---------------------------------------------------------------------------

create table platform.entry_rules (
  id                uuid primary key default public.uuid_generate_v7(),
  passport_country  char(2) not null check (passport_country ~ '^[A-Z]{2}$'),
  -- `schengen` o un país (ISO alfa-2).
  zone              text not null check (zone = 'schengen' or zone ~ '^[A-Z]{2}$'),
  status            platform.entry_status not null,
  max_stay_days     smallint check (max_stay_days is null or max_stay_days > 0),
  window_days       smallint check (window_days is null or window_days > 0),
  -- {"passportValidMonthsAfterExit": 3, "passportIssuedWithinYears": 10, "mayAsk": [...]}
  conditions        jsonb not null default '{}'::jsonb,
  source_name       text not null check (length(source_name) between 1 and 160),
  source_url        text not null check (source_url ~ '^https://'),
  checked_on        date not null,
  valid_from        date,
  valid_to          date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint entry_rules_validity check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

comment on table platform.entry_rules is
  'Visa and entry rules per passport and destination zone, each with its official source and lookup date. Older than 30 days reads as unverified.';

create unique index entry_rules_current on platform.entry_rules (passport_country, zone)
  where valid_to is null;

create trigger set_updated_at before update on platform.entry_rules
  for each row execute function public.set_updated_at();

create table platform.border_systems (
  id              text primary key check (id in ('ees', 'etias')),
  zone            text not null,
  -- Nulo mientras no tenga fecha confirmada. Editable desde la consola.
  starts_on       date,
  exempt          char(2)[] not null default '{}',
  source_name     text not null,
  source_url      text not null check (source_url ~ '^https://'),
  checked_on      date not null,
  updated_at      timestamptz not null default now()
);

create trigger set_updated_at before update on platform.border_systems
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'trip_places', 'trip_anchors', 'trip_wishes', 'trip_flight_segments',
    'trip_drives', 'trip_lodging_options', 'trip_todos'
  ] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
    execute format(
      'create policy %I on app.%I for all to authenticated
         using (app.is_household_member(household_id))
         with check (app.is_household_member(household_id))',
      t || '_household_access', t);
    execute format(
      'create policy %I on app.%I for select to authenticated
         using (app.has_accountant_access(household_id, ''read''))',
      t || '_readable_by_accountant', t);
    execute format('grant select, insert, update, delete on app.%I to authenticated', t);
  end loop;
end;
$$;

alter table platform.entry_rules enable row level security;
alter table platform.entry_rules force row level security;
create policy entry_rules_readable on platform.entry_rules for select to authenticated using (true);
grant select on platform.entry_rules to authenticated;

alter table platform.border_systems enable row level security;
alter table platform.border_systems force row level security;
create policy border_systems_readable on platform.border_systems for select to authenticated using (true);
grant select on platform.border_systems to authenticated;
