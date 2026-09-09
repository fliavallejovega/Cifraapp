-- Una meta confirmada no es una preferencia más fuerte: es un compromiso.
--
-- Una casa ordena sus metas por importancia y con eso alcanza mientras ninguna
-- tenga día. Pero «el viaje es el 20 de diciembre y ya compramos los boletos»
-- es otra clase de cosa: una meta comprometida que no se llena a tiempo no
-- queda a medias, queda incumplida — y el reparto tiene que saber la
-- diferencia.
--
-- Lo declara la persona. Tener fecha no confirma nada: «algún día en
-- diciembre» es una fecha, y adivinar que está comprometida sería mover el
-- dinero de una casa porque alguien escribió un día en una casilla.

alter table app.goals
  add column if not exists is_committed boolean not null default false;

comment on column app.goals.is_committed is
  'The household said this one is happening. Stated, never inferred from having a target date: «sometime in December» is a date too.';

-- Confirmar algo que ya se logró o se abandonó no significa nada, y dejarlo
-- posible es dejar una meta cerrada compitiendo por dinero.
alter table app.goals
  drop constraint if exists goals_only_active_are_committed;

alter table app.goals
  add constraint goals_only_active_are_committed
  check (not is_committed or status = 'active');
