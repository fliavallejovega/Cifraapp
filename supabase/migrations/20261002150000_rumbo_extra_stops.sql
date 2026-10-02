-- Rumbo: paradas que la persona agrega a un día.
--
-- Un mirador, un almuerzo, un museo encontrado en el mapa. Rumbo la mete en el
-- manejo de ese día donde menos desvío cuesta (o arma una ida y vuelta si ese
-- día no se maneja), pide la ruta de nuevo y recalcula horas y luz.

alter table app.trip_places
  -- El lugar en Google Maps, cuando se eligió desde su buscador.
  add column google_place_id text check (google_place_id is null or length(google_place_id) <= 300);

create table app.trip_extra_stops (
  id            uuid primary key default public.uuid_generate_v7(),
  household_id  uuid not null,
  trip_id       uuid not null,
  stop_date     date not null,
  place_id      uuid not null,
  -- Lo que piensan quedarse; nulo usa el tiempo típico del tipo de lugar.
  minutes       smallint check (minutes is null or minutes between 0 and 720),
  note          text check (note is null or length(note) <= 200),
  created_by    uuid references app.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),

  constraint trip_extra_stops_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade,
  constraint trip_extra_stops_place foreign key (place_id, trip_id)
    references app.trip_places (id, trip_id) on delete cascade,
  constraint trip_extra_stops_once unique (trip_id, stop_date, place_id)
);

create index trip_extra_stops_trip_idx on app.trip_extra_stops (trip_id, stop_date);

alter table app.trip_extra_stops enable row level security;
alter table app.trip_extra_stops force row level security;
create policy trip_extra_stops_household_access on app.trip_extra_stops for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));
create policy trip_extra_stops_readable_by_accountant on app.trip_extra_stops for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));
grant select, insert, update, delete on app.trip_extra_stops to authenticated;
