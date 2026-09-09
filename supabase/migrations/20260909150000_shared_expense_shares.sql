-- Cómo se reparten los gastos comunes, dicho por la casa.
--
-- Un hogar de dos personas paga el alquiler entre las dos, y «entre las dos»
-- casi nunca quiere decir a la mitad: quien gana más suele poner más, y en qué
-- proporción es un acuerdo entre ellas, no una cuenta que un producto pueda
-- deducir de sus sueldos. Deducirla sería peor que no tenerla — una aplicación
-- que reparte el alquiler 63/37 porque así salen los ingresos está opinando
-- sobre algo que nadie le preguntó.
--
-- Así que se guarda el porcentaje que cada quien acordó llevar. El producto
-- hace la multiplicación y no propone ninguna cifra que no le hayan dicho; lo
-- único que ofrece por su cuenta es partes iguales, que no es una opinión sino
-- la ausencia de una.
--
-- **Qué es un gasto común ya estaba modelado.** Un pago con
-- `paid_from_series_id` sale del sueldo de alguien y es de esa persona; uno sin
-- él sale del bolsillo común y es de la casa. Este porcentaje reparte
-- exactamente esos, y por eso no hace falta una marca nueva que diga cuáles.

alter table app.household_people
  add column if not exists expense_share numeric(5, 2)
    check (expense_share is null or (expense_share >= 0 and expense_share <= 100));

comment on column app.household_people.expense_share is
  'The percentage of shared expenses this person carries, as the household agreed it. Null means they were never given one — the screen then splits equally, which is the absence of an opinion rather than one.';

-- Una persona que no aporta ingreso no lleva parte de los gastos comunes: un
-- niño no paga el alquiler. Que la base lo diga evita que una pantalla futura
-- reparta entre cuatro lo que sostienen dos.
alter table app.household_people
  drop constraint if exists household_people_dependents_have_no_share;

alter table app.household_people
  add constraint household_people_dependents_have_no_share
  check (not (is_dependent and expense_share is not null));
