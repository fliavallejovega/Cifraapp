-- Lo que el chat propone, esperando a que alguien lo confirme.
--
-- El copiloto pasa de explicar a poder pedir cambios, y esta tabla es la razón
-- por la que ese paso no rompe la regla que sostiene el producto: **la IA nunca
-- es la fuente de verdad**. Una propuesta no es un cambio. Es una fila
-- pendiente, con su tipo, su objetivo, su valor y la frase que la justifica, que
-- no le hace nada a nada hasta que una persona la aprueba.
--
-- ## Por qué se guarda en vez de aplicarse al confirmar en el momento
--
-- Porque la conversación y la confirmación pueden estar separadas por horas y
-- por dispositivos, y porque después hace falta poder responder «¿quién cambió
-- mi piso de ingreso?». La fila guarda quién la propuso, en qué hilo, quién la
-- aprobó y cuándo — que es exactamente la procedencia que `CLAUDE.md` exige para
-- cualquier cambio automático de estado financiero.
--
-- ## Por qué caduca
--
-- Una propuesta sobre un cobro de octubre carece de sentido en diciembre. En vez
-- de aplicarla tarde sobre un mundo que cambió, se marca `expired` y se vuelve a
-- preguntar. Un botón que aplica una decisión tomada contra datos de hace un mes
-- es peor que un botón que ya no está.

create type app.proposal_status as enum ('pending', 'applied', 'rejected', 'expired');

create table if not exists app.plan_proposals (
  id            uuid primary key default public.uuid_generate_v7(),
  household_id  uuid not null references app.households (id) on delete cascade,

  -- De qué conversación salió. Nulo si se propuso desde otra superficie.
  thread_id     uuid references app.chat_threads (id) on delete set null,
  message_id    uuid references app.chat_messages (id) on delete set null,

  -- El tipo del catálogo cerrado de `@app/ai`. Texto y no enum a propósito: el
  -- catálogo vive en el código, que es donde se valida, y una fila con un tipo
  -- que el código ya no reconoce tiene que poder leerse para explicarse — no
  -- desaparecer porque el tipo del esquema la rechace.
  kind          text not null,
  -- La fila del hogar sobre la que actúa, cuando el tipo tiene una.
  target_id     text,
  -- El valor propuesto, ya normalizado por el validador.
  value         text not null,
  -- La frase del modelo. Es lo único de esta fila que escribió el modelo.
  reason        text not null,

  status        app.proposal_status not null default 'pending',

  proposed_by   uuid references app.profiles (id) on delete set null,
  decided_by    uuid references app.profiles (id) on delete set null,
  decided_at    timestamptz,
  -- Qué había antes, para poder deshacerlo y para poder explicarlo.
  previous_value text,
  failure_reason text,

  expires_at    timestamptz not null default now() + interval '7 days',
  created_at    timestamptz not null default now()
);

comment on table app.plan_proposals is
  'Changes the copilot suggested, pending a person''s approval. A proposal is not a change: nothing happens until somebody confirms, and the row keeps who proposed, who approved and what the value was before.';
comment on column app.plan_proposals.kind is
  'From the closed catalogue in @app/ai. Text rather than an enum so a row whose kind the code no longer recognizes can still be read and explained.';
comment on column app.plan_proposals.previous_value is
  'What it was before it was applied. Provenance, and the only thing that makes an approval reversible.';

create index if not exists plan_proposals_pending_idx
  on app.plan_proposals (household_id, created_at)
  where status = 'pending';

create index if not exists plan_proposals_thread_idx
  on app.plan_proposals (thread_id);

alter table app.plan_proposals enable row level security;
alter table app.plan_proposals force row level security;

drop policy if exists plan_proposals_household_access on app.plan_proposals;
create policy plan_proposals_household_access on app.plan_proposals
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

-- El contador puede verlas, como ve el resto del plan. No puede decidirlas: una
-- propuesta aprobada cambia una cifra del hogar y esa decisión es del hogar.
drop policy if exists plan_proposals_readable_by_accountant on app.plan_proposals;
create policy plan_proposals_readable_by_accountant on app.plan_proposals
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

grant select, insert, update on app.plan_proposals to authenticated;
