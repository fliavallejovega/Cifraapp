-- A quién se le debe, cuando no es un banco.
--
-- `debts` sabía decir «una hipoteca del Banco General» y «lo que Davo debe en su
-- Visa»: una institución, o una persona **del hogar**. No sabía decir lo más
-- común entre gente real — «le debemos mil ochocientos a Giovanni» — porque
-- Giovanni no es un banco de la lista ni vive en este hogar.
--
-- Sin ese dato, un pago a Giovanni entra como un gasto suelto: sale del mes,
-- no baja de ningún saldo, y la deuda sigue diciendo mil ochocientos para
-- siempre. La casa termina llevando esa cuenta en la cabeza, que es exactamente
-- el trabajo que este producto existe para quitar.
--
-- ## Por qué un nombre y no una fila en una tabla de terceros
--
-- Porque una tabla de contrapartes con su propio ciclo de vida —crear, editar,
-- fusionar, borrar— es una pantalla más antes de poder anotar la primera deuda,
-- y la mayoría de estas relaciones son una sola. El nombre normalizado alcanza
-- para agrupar y para cruzar contra la descripción de un movimiento; si algún
-- día hacen falta datos de contacto, la fila se promueve.

alter table app.debts
  add column if not exists counterparty_name text;

-- La forma normalizada, que es contra lo que se cruza la descripción de un
-- movimiento. Se calcula al guardar: minúsculas, sin tildes, sin puntuación.
alter table app.debts
  add column if not exists counterparty_normalized text;

create index if not exists debts_counterparty_idx
  on app.debts (household_id, counterparty_normalized)
  where counterparty_normalized is not null;

comment on column app.debts.counterparty_name is
  'A quién se le debe cuando no es una institución de la lista ni una persona del hogar: «Giovanni Cintione». Nulo para una deuda con un banco.';

-- Cada vez que un movimiento se aplica a una deuda.
--
-- ## Por qué una tabla y no restar y ya
--
-- Porque restar y ya es irreversible y no se puede explicar. Un saldo que bajó
-- de 1800 a 1300 sin dejar rastro obliga a creerle; con el rastro se puede
-- preguntar cuál de los pagos fue, quién lo aplicó, y deshacerlo si alguien se
-- equivocó de deuda. En un producto financiero eso no es lujo de auditoría: es
-- la diferencia entre un error corregible y una cifra que nadie puede defender.
--
-- El saldo de la deuda sigue siendo la columna que manda —lo demás lo leería
-- todo el mundo mal— pero ahora tiene de dónde salir.
create table if not exists app.debt_payments (
  id uuid primary key default public.uuid_generate_v7(),
  household_id uuid not null references app.households (id) on delete cascade,
  debt_id uuid not null references app.debts (id) on delete cascade,
  -- El movimiento del que salió. Nulo cuando alguien registra a mano un pago
  -- que nunca pasó por una cuenta —efectivo, un favor devuelto— que es
  -- frecuente justamente en las deudas informales.
  transaction_id uuid references app.transactions (id) on delete set null,
  amount numeric(19, 4) not null,
  currency char(3) not null default 'USD',
  paid_on date not null,
  note text,
  applied_by uuid references app.profiles (id) on delete set null,
  applied_at timestamptz not null default now(),
  -- Deshacer no borra: marca. Una fila borrada no explica por qué el saldo
  -- volvió a subir.
  reversed_at timestamptz,
  reversed_by uuid references app.profiles (id) on delete set null,
  reversal_reason text,
  constraint debt_payments_amount_positive check (amount > 0)
);

create index if not exists debt_payments_debt_idx
  on app.debt_payments (debt_id)
  where reversed_at is null;

-- Un movimiento no se puede aplicar dos veces a la misma deuda. Sin esto, dos
-- personas mirando la misma pantalla descuentan el mismo pago dos veces y la
-- deuda queda en la mitad de lo que es.
create unique index if not exists debt_payments_one_per_transaction
  on app.debt_payments (debt_id, transaction_id)
  where transaction_id is not null and reversed_at is null;

alter table app.debt_payments enable row level security;

drop policy if exists debt_payments_household_access on app.debt_payments;
create policy debt_payments_household_access on app.debt_payments
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));
