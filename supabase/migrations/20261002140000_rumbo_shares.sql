-- Rumbo: compartir un viaje por enlace, de solo lectura.
--
-- Mismo diseño que el calendario de compromisos: el token viaja en la URL, se
-- guarda hasheado, se revoca sin borrar la fila y detrás de él no hay nada más
-- que el itinerario de un viaje — ni montos, ni saldos, ni el resto del hogar.
-- Editar un viaje sigue siendo cosa de quien pertenece al hogar.

create table app.trip_shares (
  id            uuid primary key default public.uuid_generate_v7(),
  household_id  uuid not null,
  trip_id       uuid not null,
  token_hash    text not null unique check (length(token_hash) = 64),
  -- Los primeros caracteres, para que la persona reconozca qué enlace revoca.
  hint          text not null check (length(hint) between 4 and 8),
  permission    text not null default 'read' check (permission in ('read')),
  created_by    uuid references app.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,

  constraint trip_shares_trip foreign key (trip_id, household_id)
    references app.trips (id, household_id) on delete cascade
);

create index trip_shares_trip_idx on app.trip_shares (trip_id) where revoked_at is null;

alter table app.trip_shares enable row level security;
alter table app.trip_shares force row level security;
create policy trip_shares_household_access on app.trip_shares for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));
grant select, insert, update, delete on app.trip_shares to authenticated;
