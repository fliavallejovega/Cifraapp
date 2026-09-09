-- No todos los descuentos caen en las dos quincenas.
--
-- El seguro social, el educativo y la retención de renta salen de cada pago:
-- son un porcentaje del sueldo del período y no tienen otra forma de ser. Pero
-- la cuota de la cooperativa, el préstamo de la caja de ahorros o el seguro de
-- vida se descuentan una vez al mes, y una vez al mes significa **una de las
-- dos quincenas**, no la mitad en cada una.
--
-- Restarlos en las dos era restar de más en la quincena que no los paga y de
-- menos en la que sí. Da igual al final del mes y está mal en las dos mitades,
-- que es exactamente lo que la vista por quincena existe para no hacer: el
-- hogar que se queda corto el día 20 no se queda corto por el promedio del mes.
--
-- Dos columnas, y las dos con el caso corriente en nulo para que lo que ya está
-- guardado siga significando lo mismo que significaba.

-- Los días en que se aplica el descuento, en paralelo a `anchor_days` del
-- ingreso del que cuelga. Nulo es «en todos los pagos», que es lo que hay hoy.
alter table app.income_deductions
  add column if not exists applies_to_anchors smallint[];

comment on column app.income_deductions.applies_to_anchors is
  'The anchor days this deduction is taken on, as a subset of the income''s anchor_days. Null means every payment, which is the ordinary case.';

-- Un día del mes es un día del mes. 31 significa fin de mes, igual que en
-- `anchor_days`, y una lista vacía no es «ninguno»: es una fila a medio llenar.
--
-- Los límites van como literal y no como `generate_series`: una restricción de
-- comprobación no admite subconsultas, y el rango de días de un mes no es algo
-- que vaya a cambiar.
alter table app.income_deductions
  drop constraint if exists income_deductions_anchors_valid;

alter table app.income_deductions
  add constraint income_deductions_anchors_valid
  check (
    applies_to_anchors is null
    or (
      array_length(applies_to_anchors, 1) between 1 and 2
      and applies_to_anchors <@ array[
        1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
        17,18,19,20,21,22,23,24,25,26,27,28,29,30,31
      ]::smallint[]
    )
  );

-- Y el neto de cada quincena, porque si un descuento cae en una sola, las dos
-- quincenas dejan de traer lo mismo.
--
-- `expected_amount` sigue siendo lo que todo el sistema lee como efectivo y
-- pasa a guardar el promedio de las dos: es lo que mantiene correcto el total
-- del mes en cada vista que no razona por período, que son casi todas. La
-- verdad de cada quincena vive aquí, igual que ya vive en `app.obligations`, y
-- el plan la lee de aquí. Nulo significa «lo mismo las dos veces».
alter table app.recurring_series
  add column if not exists anchor_amounts numeric(19, 4)[];

comment on column app.recurring_series.anchor_amounts is
  'What arrives on each anchor day, in the same order as anchor_days. Null means the same amount every time. expected_amount stays the average, because everything that does not reason by period reads it as the month''s cash.';

-- Un monto por cada día, o ninguno. Una lista más corta que la de días es un
-- cobro que nadie puede calcular, y prefiero que la base lo rechace a que una
-- pantalla elija en silencio cuál de los dos días se queda sin monto.
alter table app.recurring_series
  drop constraint if exists recurring_series_anchor_amounts_match;

alter table app.recurring_series
  add constraint recurring_series_anchor_amounts_match
  check (
    anchor_amounts is null
    or (anchor_days is not null and array_length(anchor_amounts, 1) = array_length(anchor_days, 1))
  );
