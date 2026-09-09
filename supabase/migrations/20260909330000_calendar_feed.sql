-- La dirección secreta por la que se suscribe el calendario de compromisos.
--
-- Apple Calendar y Google Calendar suscriben un `.ics` por URL, y ninguno de los
-- dos sabe iniciar sesión: piden la dirección y la leen desde sus servidores,
-- sin cookies y sin cabeceras. Eso deja una sola forma de autenticar la lectura,
-- que es que el secreto viaje en la propia dirección.
--
-- ## Lo que eso obliga a hacer bien
--
-- Una URL que lleva un secreto es una URL que se filtra: aparece en el
-- historial, en una captura de pantalla, en el registro de un proxy. Así que:
--
--   * El token se guarda **hasheado**, igual que una contraseña. La base de
--     datos filtrada no da acceso a los compromisos de nadie.
--   * Se puede **revocar** sin borrar la fila, y se puede emitir uno nuevo. Un
--     enlace comprometido se corta en un clic y el de antes deja de servir.
--   * Sólo sirve para **leer los compromisos** de un hogar. No hay nada más
--     detrás de esa dirección: ni saldos, ni movimientos, ni sesión.
--   * Se registra cuándo se leyó por última vez, que es lo que permite darse
--     cuenta de que un enlace que nadie usa sigue vivo.
--
-- El token en claro se enseña **una vez**, al crearlo, con el mismo criterio que
-- las invitaciones de miembro que ya existen en este esquema.

create table if not exists app.calendar_feeds (
  id           uuid primary key default public.uuid_generate_v7(),
  household_id uuid not null references app.households (id) on delete cascade,
  created_by   uuid references app.profiles (id) on delete set null,

  -- SHA-256 del token. Nunca el token.
  token_hash   text not null unique,
  -- Los primeros caracteres, para poder decir cuál de dos enlaces es cuál.
  token_hint   text not null,

  label        text check (label is null or length(trim(label)) <= 60),

  -- Cuántos días hacia adelante publica. Un calendario con dos años de
  -- compromisos proyectados es un calendario que nadie vuelve a mirar.
  horizon_days smallint not null default 120
               check (horizon_days between 7 and 400),

  last_read_at timestamptz,
  read_count   integer not null default 0,

  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

comment on table app.calendar_feeds is
  'The secret address a calendar client subscribes to. Apple and Google Calendar cannot sign in, so the secret travels in the URL — which is why it is stored hashed, is revocable, and reaches nothing but this household''s commitments.';
comment on column app.calendar_feeds.token_hash is
  'SHA-256 of the token. The raw value is shown once, at creation, like a member invitation.';
comment on column app.calendar_feeds.last_read_at is
  'When a client last fetched it. What makes a forgotten live link visible.';

create index if not exists calendar_feeds_household_idx
  on app.calendar_feeds (household_id)
  where revoked_at is null;

alter table app.calendar_feeds enable row level security;
alter table app.calendar_feeds force row level security;

drop policy if exists calendar_feeds_household_access on app.calendar_feeds;
create policy calendar_feeds_household_access on app.calendar_feeds
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

grant select, insert, update, delete on app.calendar_feeds to authenticated;
