-- A qué navegador mandarle un aviso.
--
-- Una suscripción push es de un navegador, no de una persona: la misma persona
-- en el teléfono y en la portátil son dos, y una que se borra en uno tiene que
-- seguir viva en el otro. Por eso la llave es el `endpoint` que da el navegador
-- y no el usuario.
--
-- Las dos claves que vienen con ella —`p256dh` y `auth`— son lo que cifra el
-- mensaje de punta a punta: sin ellas el servicio de push transporta un sobre
-- que no puede abrir, que es exactamente lo que se quiere de un servicio que
-- mueve avisos sobre el dinero de alguien.
--
-- Se borran solas cuando el servicio dice que el endpoint ya no existe. Una
-- suscripción muerta que nadie retira convierte cada envío en un error diario
-- para siempre.

create table if not exists app.push_subscriptions (
  id           uuid primary key default public.uuid_generate_v7(),
  household_id uuid not null references app.households (id) on delete cascade,
  user_id      uuid not null references app.profiles (id) on delete cascade,

  -- La dirección que el navegador dio. Única: dos filas para el mismo navegador
  -- son dos avisos idénticos en la misma pantalla.
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,

  -- Para poder decir «Chrome en tu teléfono» al listarlas, y para que quitar la
  -- correcta no sea adivinar entre tres cadenas iguales.
  label        text,

  last_sent_at timestamptz,
  /** Por qué se dio de baja, cuando el servicio la rechazó. */
  failed_reason text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table app.push_subscriptions is
  'One browser, not one person: the same person on a phone and a laptop is two. Keyed by the endpoint the browser issued.';

create index if not exists push_subscriptions_household_idx
  on app.push_subscriptions (household_id, user_id);

create trigger set_updated_at before update on app.push_subscriptions
  for each row execute function public.set_updated_at();

alter table app.push_subscriptions enable row level security;
alter table app.push_subscriptions force row level security;

-- Cada quien ve y borra las suyas. Una suscripción es de un navegador de una
-- persona: que un miembro del hogar pueda retirar el aviso del teléfono de otro
-- sería darle a alguien la llave para silenciar a su pareja.
drop policy if exists push_subscriptions_own on app.push_subscriptions;
create policy push_subscriptions_own on app.push_subscriptions
  for all to authenticated
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id() and app.is_household_member(household_id));

grant select, insert, update, delete on app.push_subscriptions to authenticated;
