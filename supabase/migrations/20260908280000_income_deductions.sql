-- Lo que te descuentan antes de que el sueldo llegue, dicho por ti.
--
-- Un asalariado en Panamá no cobra lo que dice su contrato: entre el bruto y lo
-- que entra a la cuenta hay seguro social, seguro educativo y retención de
-- renta. Hasta ahora el producto solo sabía preguntar «cuánto entra», que es la
-- pregunta correcta para planear y la inútil para entender — un hogar que ve
-- «$1.000» no puede reconciliar eso con el contrato que dice $1.400 ni saber a
-- dónde se fueron los $400.
--
-- **Los montos los pone el hogar, copiados de su propia ficha de pago.** No hay
-- tasas oficiales aquí y no las hay a propósito. Este repositorio ya tiene el
-- lugar donde viven —`platform.tax_rules`, con vigencia y fuente— y ya tiene la
-- puerta que impide mostrar una cifra fiscal que nadie calificado revisó. Poner
-- 9,75% en una migración porque suena correcto sería saltarse esa puerta por
-- detrás, y la diferencia entre eso y un motor de impuestos es todo el riesgo
-- legal del proyecto.
--
-- Así que aquí solo hay aritmética sobre números que alguien leyó de su recibo:
-- bruto menos descuentos es lo que llega, y lo que llega es lo que el plan usa.
-- Lo mismo sirve para un servicio profesional, donde las líneas se llaman
-- distinto y la cuenta es la misma.

alter table app.recurring_series
  add column if not exists gross_amount numeric(19, 4)
    check (gross_amount is null or gross_amount >= 0);

comment on column app.recurring_series.gross_amount is
  'What the payslip says before deductions, when the household stated it. `expected_amount` always stays what actually arrives, because every plan reads it as cash.';

create table if not exists app.income_deductions (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,
  -- La deducción muere con el ingreso: sin sueldo no hay nada de qué descontar.
  series_id      uuid not null references app.recurring_series (id) on delete cascade,

  -- Como lo dice el recibo. Texto libre y no una lista cerrada: la ficha de una
  -- empresa dice «S.S.», la de otra «Caja de Seguro Social», y una tercera tiene
  -- una línea que ninguna lista nuestra habría previsto. Obligar a elegir de un
  -- menú sería obligar a traducir, y una traducción es donde se pierde el dato.
  label          text not null check (length(trim(label)) between 1 and 80),
  amount         numeric(19, 4) not null check (amount >= 0),
  currency       char(3) not null default 'USD' references platform.currencies (code),

  -- El orden del recibo, para que la pantalla se lea como el papel.
  sort_order     smallint not null default 0,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists income_deductions_series_idx
  on app.income_deductions (series_id, sort_order);

alter table app.income_deductions enable row level security;
alter table app.income_deductions force row level security;

drop policy if exists income_deductions_household_access on app.income_deductions;
create policy income_deductions_household_access on app.income_deductions
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

grant select, insert, update, delete on app.income_deductions to authenticated;
