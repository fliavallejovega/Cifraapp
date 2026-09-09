-- Cómo se paga un crédito, que no es lo mismo que qué clase de crédito es.
--
-- Una hipoteca y un préstamo entre amigos pueden pagarse igual —cuota fija
-- todos los meses— y una hipoteca y una línea de crédito del mismo banco no.
-- La forma de pago es lo que decide qué preguntar, qué se puede calcular y qué
-- pasa con el saldo: una cuota fija baja el capital cada mes, un préstamo de
-- solo intereses no lo baja nunca hasta el final, y una tarjeta no termina.
--
-- Por eso va aparte de `kind`. Mezclarlas obligaría a inventar una clase por
-- cada combinación —«hipoteca a cuota fija», «hipoteca a interés simple»— y a
-- reclasificar a mano el día que un banco ofrezca la otra.
--
-- ## Las formas
--
-- `fixed_instalment`      cuota fija, la corriente en hipoteca y auto
-- `declining_instalment`  capital fijo y cuota que baja, común en banca local
-- `interest_only`         se pagan intereses y el capital queda para el final
-- `single_payment`        todo al vencimiento; la forma del préstamo informal
-- `no_interest_plan`      cuotas sin interés de una compra a plazos
-- `revolving`             tarjeta o línea: mínimo mensual y sin final
--
-- **Esta lista sale del conocimiento de quien la escribió, no de una fuente
-- panameña citable.** Cubre lo que se usa —incluido el descuento directo, que
-- es una forma de cobro y no de pago y por eso va como marca aparte— pero si
-- falta una estructura, se agrega al enum sin tocar nada más.

create type app.debt_repayment as enum (
  'fixed_instalment',
  'declining_instalment',
  'interest_only',
  'single_payment',
  'no_interest_plan',
  'revolving'
);

alter table app.debts
  add column if not exists repayment app.debt_repayment,
  /**
   * Descuento directo: la cuota sale de la planilla antes de que el sueldo
   * llegue. Muy común en Panamá y no es un detalle de trámite — ese dinero
   * nunca entra a la cuenta, así que no puede reclamar un saldo que ya no lo
   * tiene. Es la misma distinción que los pagos ya hacen con
   * `is_deducted_at_source`.
   */
  add column if not exists is_payroll_deducted boolean not null default false,
  /** El día del mes en que se cobra la cuota, cuando la hay. */
  add column if not exists instalment_day smallint
    check (instalment_day is null or instalment_day between 1 and 31);

comment on column app.debts.repayment is
  'How this credit is repaid, which decides what to ask and what can be computed. Separate from `kind`: a mortgage and a loan between friends can share a shape.';
comment on column app.debts.is_payroll_deducted is
  'Taken from the payslip before the salary arrives. That money never reaches an account, so it cannot claim a balance that never held it.';

-- Lo que ya está guardado: una tarjeta da vueltas, y todo lo demás se pagaba en
-- cuotas fijas mientras no hubiera dónde decir otra cosa. Es la lectura que no
-- inventa nada — la forma corriente, deducida una vez y editable después.
update app.debts
   set repayment = (case when kind = 'credit_card' then 'revolving' else 'fixed_instalment' end)::app.debt_repayment
 where repayment is null;

-- Una tarjeta da vueltas por definición, y algo que da vueltas no tiene cuotas.
-- Que la base lo diga evita una pantalla preguntándole a una tarjeta cuándo
-- termina.
alter table app.debts
  drop constraint if exists debts_revolving_has_no_term;

alter table app.debts
  add constraint debts_revolving_has_no_term
  check (repayment is distinct from 'revolving' or (term_months is null and paid_months is null));
