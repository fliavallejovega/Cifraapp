-- El piso, el colchón y la cuenta que los hace ciertos.
--
-- Un hogar que vive de vender no tiene sueldo: tiene un piso. La Fase A le dio
-- al producto la mitad del ingreso variable que le faltaba —los cobros, con su
-- ventana y su grado de certeza—. Esta le da la otra: contra cuánto se puede
-- comprometer, y dónde se guarda la diferencia.
--
-- ## Tres columnas y una cuenta
--
-- `income_floor` es lo que la persona declara mientras no haya historia. No es
-- el piso: es el piso **declarado**, y por eso convive con el medido en vez de
-- pisarlo. El motor calcula un percentil sobre los cobros reales en cuanto hay
-- seis meses, y a partir de ahí manda el medido — pero lo declarado se conserva,
-- porque la diferencia entre lo que alguien cree que cobra en su peor mes y lo
-- que de verdad cobró es información sobre esa persona, no ruido que limpiar.
--
-- `income_floor_percentile` existe para que el número no sea un misterio ni una
-- constante escondida en un archivo. Un hogar conservador puede bajarlo al p10.
--
-- `cushion_months` es el objetivo en meses cuando la casa quiere fijarlo a mano.
-- Nulo significa «que lo decida mi propia volatilidad», que es el caso normal y
-- el que produce un objetivo distinto para cada hogar en vez del consejo
-- genérico de tres meses que no le sirve a ninguno de los dos extremos.
--
-- `retention_account_id` es la pieza sin la cual todo lo anterior es decorado.
-- Si lo cobrado cae en la cuenta de la que se gasta, el mes de $8,000 se gasta
-- como un mes de $8,000 y el de $0 no tiene de dónde salir. La retención recibe
-- los cobros y le pasa el piso a la operativa cada mes: es el mecanismo, no una
-- sutileza contable.

alter table app.household_settings
  add column if not exists income_floor            numeric(19, 4),
  add column if not exists income_floor_percentile numeric(4, 3) not null default 0.250,
  add column if not exists cushion_months          smallint,
  add column if not exists retention_account_id    uuid
    references app.accounts (id) on delete set null;

alter table app.household_settings
  drop constraint if exists household_settings_income_floor_positive;
alter table app.household_settings
  add constraint household_settings_income_floor_positive
  check (income_floor is null or income_floor >= 0);

-- Un percentil fuera de (0, 0.5] no es conservador, es otra cosa. Por encima de
-- la mediana el «piso» sería un mes mejor que la mitad de los meses vividos, y
-- comprometerse contra eso es exactamente el error que esta fase evita.
alter table app.household_settings
  drop constraint if exists household_settings_floor_percentile_range;
alter table app.household_settings
  add constraint household_settings_floor_percentile_range
  check (income_floor_percentile > 0 and income_floor_percentile <= 0.5);

alter table app.household_settings
  drop constraint if exists household_settings_cushion_months_range;
alter table app.household_settings
  add constraint household_settings_cushion_months_range
  check (cushion_months is null or cushion_months between 1 and 24);

comment on column app.household_settings.income_floor is
  'The floor the household stated, for use while there is not enough history to measure one. Never overwritten by the measured figure: the gap between the two is information about the household.';
comment on column app.household_settings.income_floor_percentile is
  'Which percentile of the household''s own months defines the floor. 0.25 means three months in four bring at least that much.';
comment on column app.household_settings.cushion_months is
  'Months of floor to hold in retention, when the household fixes it by hand. Null means the target follows the household''s own income volatility.';
comment on column app.household_settings.retention_account_id is
  'Where receipts land before they become a salary. Without it the cushion is a number on a screen: the month of $8,000 gets spent as a month of $8,000.';

/**
 * Si el monto declarado de un ingreso ya trae descontado lo que se descuenta.
 *
 * Un compromiso marcado `is_deducted_at_source` no se reclama contra el saldo:
 * sale de la planilla antes de que el sueldo llegue, y los motores ya lo
 * excluyen. Eso deja una pregunta abierta que decide una cifra financiera: el
 * monto que la persona escribió como su ingreso, ¿es lo que le depositan, o lo
 * que gana antes de los descuentos?
 *
 * Las dos respuestas son legítimas y producen números distintos. Con `net` —lo
 * que casi todo el mundo escribe, porque es lo que ve en el banco— el sistema
 * ya está bien y no hay que restar nada. Con `gross`, los descuentos de planilla
 * atados a ese ingreso se restan antes de usarlo, o la casa cree tener $700 al
 * mes que nunca tocan su cuenta.
 *
 * El defecto es `net` porque es lo que la gente escribe, y porque es el lado
 * conservador de los dos: sobreestimar el ingreso de alguien es el error que
 * hace daño.
 */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'income_basis') then
    create type app.income_basis as enum ('net', 'gross');
  end if;
end
$$;

alter table app.recurring_series
  add column if not exists stated_basis app.income_basis not null default 'net';

comment on column app.recurring_series.stated_basis is
  'Whether the stated amount already has payroll deductions taken out. `net` is what people read off a bank statement; `gross` makes the engines subtract the commitments deducted at source from this income.';
