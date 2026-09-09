-- Cuándo se paga una cuota, que en Panamá muchas veces no es «una vez al mes».
--
-- Una hipoteca con descuento directo se cobra por quincena: la mitad el 15 y la
-- mitad el 30, o los días que diga el contrato. Guardarla como un pago mensual
-- es correcto sobre el mes y falso sobre las dos mitades — y la vista por
-- quincena existe justamente para la mitad en la que la casa se queda corta.
--
-- Es la misma forma que ya tienen los ingresos y los pagos: una cadencia y los
-- días en los que cae. No se inventa una nueva porque no hace falta una nueva:
-- una cuota es un cobro que se repite, igual que el alquiler.

alter table app.debts
  add column if not exists payment_frequency app.recurrence_frequency not null default 'monthly',
  -- Los días del mes en que cae la cuota. Uno para la mensual, dos para la
  -- quincenal. Nulo mientras nadie los diga: no se supone el 15 y el 30.
  add column if not exists anchor_days smallint[];

comment on column app.debts.payment_frequency is
  'How often the instalment is charged. Monthly is the common case; a payroll-deducted mortgage is very often twice a month.';
comment on column app.debts.anchor_days is
  'Calendar days the instalment lands on, 31 meaning month end. One for monthly, two for twice-monthly. Null until stated: the 15th and the 30th are not assumed.';

-- Días de un mes, y como mucho dos. Una lista más larga no es una cuota
-- quincenal: es un dato que ninguna proyección puede leer.
alter table app.debts
  drop constraint if exists debts_anchor_days_valid;

alter table app.debts
  add constraint debts_anchor_days_valid
  check (
    anchor_days is null
    or (
      array_length(anchor_days, 1) between 1 and 2
      and anchor_days <@ array[
        1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
        17,18,19,20,21,22,23,24,25,26,27,28,29,30,31
      ]::smallint[]
    )
  );

-- Y lo revolvente no tiene cuota que fechar: una tarjeta tiene fecha de corte y
-- de pago, que ya viven en sus propias columnas.
alter table app.debts
  drop constraint if exists debts_revolving_has_no_anchors;

alter table app.debts
  add constraint debts_revolving_has_no_anchors
  check (repayment is distinct from 'revolving' or anchor_days is null);
