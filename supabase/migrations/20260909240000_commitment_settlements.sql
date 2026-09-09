-- Que un compromiso quedó pagado.
--
-- Hasta aquí un compromiso sólo podía darse por saldado enlazándolo a una
-- transacción real (`obligations.settled_transaction_id`), y nada en el
-- producto creaba esa transacción. El resultado es el hogar que abre el plan
-- con todo pago y lee que debe $1,835.99: correcto según las filas, falso según
-- su vida. Un hogar que acaba de pagar la luz necesita poder decirlo antes de
-- haber importado un solo estado de cuenta.
--
-- Es una tabla y no una bandera en `obligations` por dos razones.
--
-- La primera es que un compromiso mensual son doce vencimientos al año. Una
-- bandera sólo sabe decir «el de ahora está hecho» y se pierde en cuanto el
-- compromiso avanza al mes siguiente; el hogar que quiera saber si pagó el
-- alquiler de marzo no tiene dónde mirar. La fila guarda *cuál* vencimiento.
--
-- La segunda es la conciliación. Cuando el movimiento real aparezca en un
-- estado de cuenta importado, tiene que engancharse a algo: esta fila es ese
-- algo, y `method` es lo que distingue lo que el hogar afirmó de lo que un
-- movimiento confirmó. Presentar una afirmación con la misma cara que un hecho
-- es precisamente la clase de mentira cómoda que este producto no cuenta.

create table if not exists app.commitment_settlements (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,
  obligation_id  uuid not null references app.obligations (id) on delete cascade,

  -- Qué vencimiento se pagó, no cuándo se registró. Son cosas distintas: el
  -- alquiler del 5 se puede pagar el 3 o el 9, y el que manda para saber si el
  -- mes está cubierto es el 5.
  due_on         date not null,

  -- Lo que efectivamente se pagó. Arranca en el monto esperado porque casi
  -- siempre coinciden, pero es su propia columna: la luz esperada en $100 que
  -- se pagó en $118 es un dato, y machacarlo contra lo esperado lo borra.
  amount         numeric(19,4) not null,
  currency       char(3) not null default 'USD' references platform.currencies (code),

  -- Cómo se supo. `declared` es el hogar diciéndolo; `matched` es un movimiento
  -- real que lo confirmó.
  method         text not null default 'declared'
                 check (method in ('declared', 'matched')),
  transaction_id uuid references app.transactions (id) on delete set null,

  -- El día en que se pagó, según el hogar. Por defecto el del registro, pero
  -- editable: «lo pagué el viernes» es una corrección que la gente hace.
  settled_on     date not null,

  -- Quién lo afirmó. Un cambio sobre una cifra financiera sin autor no es
  -- auditable, y en un hogar de dos importa quién dijo qué.
  declared_by    uuid references app.profiles (id) on delete set null,
  note           text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Un vencimiento se paga una vez. Sin esto, dos toques al botón cuentan el
  -- alquiler dos veces.
  constraint commitment_settlements_one_per_occurrence unique (obligation_id, due_on),

  -- Un pago conciliado tiene el movimiento que lo concilió; uno declarado no
  -- tiene ninguno. Cualquier otra combinación es una fila que miente sobre su
  -- propia procedencia.
  constraint commitment_settlements_matched_has_transaction
    check ((method = 'matched') = (transaction_id is not null))
);

comment on table app.commitment_settlements is
  'One occurrence of a commitment, paid. Declared by the household or matched to a real transaction — never the two presented alike.';

create index if not exists commitment_settlements_household_idx
  on app.commitment_settlements (household_id, due_on desc);

create index if not exists commitment_settlements_obligation_idx
  on app.commitment_settlements (obligation_id, due_on desc);

create trigger set_updated_at before update on app.commitment_settlements
  for each row execute function public.set_updated_at();

alter table app.commitment_settlements enable row level security;
alter table app.commitment_settlements force row level security;

-- El dinero del hogar es del hogar: cualquier miembro registra y corrige un
-- pago, igual que puede hacerlo sobre el compromiso mismo.
drop policy if exists commitment_settlements_by_member on app.commitment_settlements;
create policy commitment_settlements_by_member on app.commitment_settlements
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

grant select, insert, update, delete on app.commitment_settlements to authenticated;
