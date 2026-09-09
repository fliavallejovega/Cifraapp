-- La cuenta de Google del hogar: leer el correo del banco y escribir el calendario.
--
-- Son dos permisos distintos de la misma conexión y se guardan juntos porque el
-- consentimiento es uno: la persona autoriza una vez y decide qué alcances da.
-- Separarlos en dos tablas obligaría a mantener dos tokens de la misma cuenta,
-- que caducan a la vez y se revocan a la vez.
--
-- ## Qué se guarda del token, y qué no
--
-- Sólo el **refresh token**, y cifrado. El de acceso dura una hora y se pide
-- cuando hace falta; guardarlo sería guardar una credencial viva de más para
-- ahorrar una llamada. El refresh se cifra con una llave del despliegue
-- (`GOOGLE_TOKEN_KEY`) antes de tocar la base: una copia de seguridad filtrada
-- no debe entregar el buzón de nadie, y el `service_role` de Supabase, que salta
-- toda la seguridad de fila, tampoco.
--
-- ## Por qué es por persona y no por hogar
--
-- Porque el buzón es de una persona. Dos miembros de un hogar tienen dos
-- correos, cada uno con los avisos de sus propias tarjetas, y una fila por hogar
-- obligaría a elegir cuál se lee. El hogar sigue siendo la frontera de acceso
-- —las políticas de fila son por hogar—, pero la conexión es de quien la
-- autorizó y sólo esa persona la puede quitar.

create table if not exists app.google_connections (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,
  user_id        uuid not null references app.profiles (id) on delete cascade,

  -- Con qué cuenta se conectó. Se enseña para que quitarla no sea adivinar.
  google_email   text not null,

  -- Cifrado con la llave del despliegue. Nunca en claro, ni en un log.
  refresh_token  text not null,

  -- Lo que Google concedió de verdad, que no siempre es lo que se pidió: la
  -- pantalla de consentimiento deja desmarcar alcances uno por uno.
  scopes         text[] not null default '{}',

  -- El calendario que el producto creó en esa cuenta. Propio y no el principal:
  -- escribir en el calendario personal de alguien y luego tener que limpiarlo es
  -- una operación que no se puede deshacer bien. Uno aparte se apaga borrándolo.
  calendar_id    text,

  -- Por dónde iba la lectura del buzón. `history_id` es el cursor incremental de
  -- Gmail: sin él, cada barrido relee el buzón entero.
  gmail_history_id        text,
  gmail_last_synced_at    timestamptz,
  calendar_last_synced_at timestamptz,

  status         text not null default 'active'
                 check (status in ('active', 'revoked', 'error')),
  failed_reason  text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Una conexión por persona y hogar. Reconectar actualiza, no acumula.
  unique (household_id, user_id)
);

comment on table app.google_connections is
  'A household member''s Google account, for reading bank alerts and writing the commitments calendar. Only the refresh token is stored, and encrypted: the access token lives an hour and is fetched when needed.';
comment on column app.google_connections.refresh_token is
  'Encrypted with the deployment key before it reaches the database. A leaked backup must not hand over anybody''s mailbox.';
comment on column app.google_connections.calendar_id is
  'A calendar the product created in that account, never the person''s primary one. Turning the feature off is deleting one calendar, not unpicking events from theirs.';
comment on column app.google_connections.gmail_history_id is
  'Gmail''s incremental cursor. Without it every sweep re-reads the whole mailbox.';

create index if not exists google_connections_household_idx
  on app.google_connections (household_id)
  where status = 'active';

create trigger set_updated_at before update on app.google_connections
  for each row execute function public.set_updated_at();

alter table app.google_connections enable row level security;
alter table app.google_connections force row level security;

-- Leer la conexión: cualquier miembro del hogar, para poder ver que existe y de
-- qué cuenta es. El token no viaja a ninguna pantalla — sólo lo lee el trabajo
-- en segundo plano, que corre con la conexión de administración.
drop policy if exists google_connections_readable on app.google_connections;
create policy google_connections_readable on app.google_connections
  for select to authenticated
  using (app.is_household_member(household_id));

-- Escribirla y borrarla: sólo quien la autorizó. Que un miembro pueda desconectar
-- el buzón de otro sería que un miembro pueda tocar la cuenta de correo de otro.
drop policy if exists google_connections_own on app.google_connections;
create policy google_connections_own on app.google_connections
  for all to authenticated
  using (app.is_household_member(household_id) and user_id = auth.uid())
  with check (app.is_household_member(household_id) and user_id = auth.uid());

grant select, insert, update, delete on app.google_connections to authenticated;

/**
 * Cada correo que ya se leyó.
 *
 * Idempotencia y nada más: sin esto, un barrido que se corre dos veces mete el
 * gasto dos veces, y el cursor de Gmail se puede repetir legítimamente cuando
 * una sincronización falla a la mitad. La fila guarda qué se decidió con el
 * correo —fila de importación, descartado, ilegible— para que «¿por qué no
 * apareció mi compra?» tenga respuesta.
 *
 * No se guarda el cuerpo. El contenido de un correo bancario es exactamente el
 * dato que este producto no quiere custodiar más de lo imprescindible: se lee,
 * se saca el movimiento, y lo que queda es el identificador y el veredicto.
 */
create table if not exists app.google_messages (
  connection_id  uuid not null references app.google_connections (id) on delete cascade,
  message_id     text not null,
  household_id   uuid not null references app.households (id) on delete cascade,

  verdict        text not null
                 check (verdict in ('imported', 'not_a_movement', 'unreadable', 'duplicate')),
  -- La fila que produjo, cuando produjo una.
  import_row_id  uuid references app.import_rows (id) on delete set null,
  reason         text,

  seen_at        timestamptz not null default now(),

  primary key (connection_id, message_id)
);

comment on table app.google_messages is
  'Which messages have already been read, and what each one produced. The body is never stored: a bank alert''s contents are exactly the data this product should hold for as little time as possible.';

create index if not exists google_messages_household_idx
  on app.google_messages (household_id, seen_at);

alter table app.google_messages enable row level security;
alter table app.google_messages force row level security;

drop policy if exists google_messages_household_access on app.google_messages;
create policy google_messages_household_access on app.google_messages
  for select to authenticated
  using (app.is_household_member(household_id));

grant select on app.google_messages to authenticated;
