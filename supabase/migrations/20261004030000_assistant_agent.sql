-- El asistente: qué modelo usa para cada trabajo, y lo que propone.
--
-- Leer un documento pide más precisión que conversar, y la casa pidió poder
-- separarlos sin tocar código: platform.ai_settings guarda el modelo de cada
-- trabajo («reading» para estados y documentos de viaje, «chat» para el
-- asistente). Sin fila, cada trabajo usa el modelo configurado en el entorno.
-- Solo la consola escribe aquí, con su registro de auditoría; ninguna sesión de
-- cliente la lee ni la escribe (RLS forzada y sin políticas).
create table if not exists platform.ai_settings (
  purpose     text primary key check (purpose in ('reading', 'chat')),
  model_key   text not null check (length(model_key) between 1 and 80),
  updated_by  uuid references app.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table platform.ai_settings enable row level security;
alter table platform.ai_settings force row level security;

-- Una conversación sabe de qué trata: las finanzas de la casa o un viaje.
alter table app.chat_threads
  add column if not exists scope text not null default 'finances'
    check (scope = 'finances' or scope ~ '^trip:[0-9a-f-]{36}$');

-- Lo que el asistente propuso en una respuesta, con su estado: propuesto,
-- aplicado o descartado. Nada de esto se aplica solo; cada fila espera a que
-- una persona toque «Aplicar».
alter table app.chat_messages
  add column if not exists proposals jsonb not null default '[]'::jsonb;

comment on column app.chat_messages.proposals is
  'Cambios que el asistente propuso en esta respuesta: [{kind, target, value, reason, label, status}]. Se aplican uno por uno, por una persona.';
