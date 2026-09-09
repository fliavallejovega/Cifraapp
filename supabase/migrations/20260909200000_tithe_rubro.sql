-- El diezmo y las ofrendas, como rubro propio.
--
-- Caían en «Otros», que es donde va lo que el producto no supo nombrar. Para
-- una parte grande de los hogares panameños no es un gasto suelto: es un
-- compromiso mensual fijo, de los primeros que se apartan y de los últimos que
-- se recortan, y verlo sumado con «lo demás» borra justamente la línea que su
-- dueño quiere poder mirar.
--
-- Va como gasto y no como donación genérica porque así lo nombra quien lo da.

insert into app.category_templates (slug, parent_slug, name_en, name_es, kind, sort_order, icon)
values ('tithe', null, 'Tithe and offerings', 'Diezmo y ofrendas', 'expense', 91, 'giving')
on conflict (slug) do update
  set name_en = excluded.name_en,
      name_es = excluded.name_es,
      kind = excluded.kind,
      sort_order = excluded.sort_order,
      icon = excluded.icon;

do $$
declare
  target uuid;
begin
  for target in select id from app.households loop
    perform app.seed_household_categories(target);
  end loop;
end;
$$;
