-- Ahorrar y jubilarse también son pagos del mes.
--
-- «Ahorros» existía como transferencia y «jubilación» no existía. Las dos
-- ausencias vienen del mismo malentendido: tratar el ahorro como lo que sobra
-- al final en vez de como lo que se aparta al principio. Un hogar que se paga a
-- sí mismo primero tiene una transferencia mensual al ahorro que compite por el
-- sueldo exactamente igual que el alquiler, y no poder clasificarla obliga a
-- ponerla en «Otros» o a no ponerla.
--
-- Se añaden como rubros de gasto —no se toca «Ahorros» ni «Inversiones», que
-- siguen siendo transferencias porque el dinero no sale de la casa— y llegan a
-- los hogares que ya existen por la misma función que siembra los demás.
--
-- «Retiro» y «jubilación» son la misma cosa dicha de dos maneras, así que van
-- en un solo rubro con los dos nombres. Dos rubros para un concepto es la forma
-- más segura de que la mitad de los pagos caiga en uno y la mitad en el otro.

insert into app.category_templates (slug, parent_slug, name_en, name_es, kind, sort_order, icon)
values
  ('savings-contribution', null, 'Saving', 'Ahorro', 'expense', 92, 'piggy'),
  ('retirement', null, 'Retirement', 'Jubilación y retiro', 'expense', 93, 'retire')
on conflict (slug) do update
  set name_en = excluded.name_en,
      name_es = excluded.name_es,
      kind = excluded.kind,
      sort_order = excluded.sort_order,
      icon = excluded.icon;

-- Y a los hogares que ya existen. La función inserta solo lo que falta, así que
-- no toca nada de lo que ya está clasificado.
do $$
declare
  target uuid;
begin
  for target in select id from app.households loop
    perform app.seed_household_categories(target);
  end loop;
end;
$$;
