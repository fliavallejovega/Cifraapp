-- Cuántas millas llevás.
--
-- Una tarjeta de millas tiene dos saldos y el producto sólo conocía uno. Sabía
-- que se deben $4,050 y no sabía que hay 42,000 millas esperando — que es
-- justamente la mitad que explica por qué alguien paga $150 de anualidad.
--
-- ## Por qué se declara y no se calcula
--
-- Porque calcularlo exige una tasa, y la tasa está escrita en prosa: «una milla
-- por cada US$3.00 de compra, y por cada US$3.00 en impuestos y multas». Sacar
-- un número de esa frase e ir acumulando sobre él produciría un saldo de millas
-- que el programa no reconoce, y una casa decidiendo un viaje contra una cifra
-- que este sistema se inventó.
--
-- Lo que sí se puede decir sin inventar nada: cuánto se consumió con esa tarjeta
-- desde la fecha del saldo declarado. Eso son movimientos reales sumados, y deja
-- juzgar si el saldo está viejo.
--
-- ## Por qué es una tabla y no una columna
--
-- Porque un saldo con fecha es un hecho fechado, no un valor actual. Guardar
-- sólo el último borra si el programa devaluó, si vencieron millas, o si alguien
-- canjeó — y esas tres cosas son las que uno quiere ver cuando el número no
-- cuadra.

create table if not exists app.program_balances (
  id uuid primary key default public.uuid_generate_v7(),
  household_id uuid not null references app.households (id) on delete cascade,
  account_id uuid not null references app.accounts (id) on delete cascade,
  -- La llave del programa al que pertenece este saldo. Un mismo plástico puede
  -- cambiar de programa; el saldo viejo sigue siendo del programa viejo.
  program_key text,
  -- Millas y puntos son enteros. No hay medias millas, y un numeric aquí
  -- invitaría a promediar algo que no se promedia.
  balance bigint not null,
  as_of date not null,
  note text,
  recorded_by uuid references app.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  constraint program_balances_not_negative check (balance >= 0)
);

create index if not exists program_balances_account_idx
  on app.program_balances (account_id, as_of desc);

alter table app.program_balances enable row level security;

drop policy if exists program_balances_household_access on app.program_balances;
create policy program_balances_household_access on app.program_balances
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

comment on table app.program_balances is
  'El saldo de millas o puntos que la casa declaró, con la fecha en que lo miró. No se calcula: la tasa vive en prosa y acumular sobre una tasa inferida produce un saldo que el programa no reconoce.';
