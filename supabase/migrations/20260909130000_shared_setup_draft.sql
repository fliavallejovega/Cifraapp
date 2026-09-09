-- El cuestionario a medio contestar, del hogar y no del navegador.
--
-- Guardarlo en `localStorage` resolvía la mitad del problema: quien vuelve en
-- el mismo navegador no repite lo que ya escribió. Pero un hogar no es un
-- navegador. Quien arranca la descripción de la casa es muchas veces quien
-- tiene tiempo esa tarde, y quien sabe el saldo de la cuenta o la tasa de la
-- tarjeta es la otra persona; obligarlas a terminar en el mismo dispositivo es
-- obligarlas a sentarse juntas para contestar seis pantallas.
--
-- Así que vive aquí, con el hogar, y cualquier miembro lo continúa. Una fila
-- por hogar: no son versiones de nada, es una respuesta a medias, y la última
-- que alguien escribió es la que vale.
--
-- **No es un hogar descrito.** Es lo que se lleva contestado, con campos vacíos
-- y filas a medio llenar, y por eso es `jsonb` opaco y no columnas: ninguna
-- pantalla lo lee más que el propio cuestionario, ningún motor lo proyecta, y
-- nada de lo que hay aquí cuenta como dato financiero hasta que se envía y se
-- guarda entero, en una transacción, en las tablas que sí tienen forma.

create table if not exists app.setup_drafts (
  -- Uno por hogar. La clave primaria lo dice mejor que una restricción única.
  household_id uuid primary key references app.households (id) on delete cascade,

  answers      jsonb not null,
  -- En qué paso se quedó, para que volver no cueste pasar cinco pantallas ya
  -- contestadas.
  step         smallint not null default 0 check (step between 0 and 20),

  -- Quién lo dejó así, para poder decirlo: «lo empezó Ana» es la diferencia
  -- entre retomar y sospechar que la aplicación inventó estos números.
  updated_by   uuid references app.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table app.setup_drafts is
  'The setup questionnaire in progress, shared by the household so one member can start it and another finish it. Half-filled answers, never read by anything but the questionnaire itself; the real records are written only on submit.';

create trigger set_updated_at before update on app.setup_drafts
  for each row execute function public.set_updated_at();

alter table app.setup_drafts enable row level security;
alter table app.setup_drafts force row level security;

drop policy if exists setup_drafts_household_access on app.setup_drafts;
create policy setup_drafts_household_access on app.setup_drafts
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

grant select, insert, update, delete on app.setup_drafts to authenticated;

-- ---------------------------------------------------------------------------
-- Un icono por rubro
-- ---------------------------------------------------------------------------
--
-- Veintiocho nombres en una lista se leen uno por uno; veintiocho nombres con
-- su icono se reconocen de un vistazo, que es lo que hace la diferencia cuando
-- alguien está clasificando el octavo pago del mes.
--
-- Se guarda el **nombre** del icono, no el dibujo: el dibujo pertenece al
-- sistema de diseño y cambia con él, y una base de datos llena de rutas SVG es
-- una base de datos que hay que migrar cada vez que alguien redibuja una casa.

alter table app.category_templates
  add column if not exists icon text
    check (icon is null or icon ~ '^[a-z][a-z0-9-]{0,39}$');

alter table app.categories
  add column if not exists icon text
    check (icon is null or icon ~ '^[a-z][a-z0-9-]{0,39}$');

comment on column app.category_templates.icon is
  'Stable icon name the interface maps to a drawing. Not a path: the drawing belongs to the design system.';

update app.category_templates set icon = case
  when slug like 'income%'          then 'wallet'
  when slug = 'housing'             then 'home'
  when slug = 'housing-rent'        then 'key'
  when slug = 'housing-mortgage'    then 'bank'
  when slug = 'housing-utilities'   then 'bolt'
  when slug = 'housing-maintenance' then 'wrench'
  when slug like 'groceries%'       then 'basket'
  when slug like 'dining%'          then 'cutlery'
  when slug = 'transportation'      then 'car'
  when slug like '%fuel%'           then 'fuel'
  when slug like 'transportation%'  then 'bus'
  when slug like 'shopping%'        then 'bag'
  when slug like 'entertainment%'   then 'play'
  when slug like 'subscriptions%'   then 'repeat'
  when slug like 'travel%'          then 'plane'
  when slug like 'healthcare%'      then 'heart'
  when slug like 'insurance%'       then 'shield'
  when slug like 'education%'       then 'book'
  when slug like 'family%'          then 'people'
  when slug like 'personal%'        then 'person'
  when slug like 'debt%'            then 'card'
  when slug like 'taxes%'           then 'receipt'
  when slug like 'fees%'            then 'percent'
  when slug like 'business%'        then 'briefcase'
  when slug like 'transfers%'       then 'arrows'
  when slug like 'investments%'     then 'chart'
  when slug like 'savings%'         then 'piggy'
  else 'tag'
end
where icon is null;

-- Y a los rubros que los hogares ya tienen, por el mismo nombre de plantilla.
update app.categories c
   set icon = t.icon
  from app.category_templates t
 where t.slug = c.template_slug
   and c.icon is distinct from t.icon;

-- La siembra futura los copia igual que copia el nombre.
create or replace function app.seed_household_categories(target_household uuid)
returns integer
language plpgsql
security definer
set search_path = app, public, pg_temp
as $$
declare
  parents integer := 0;
  children integer := 0;
begin
  if auth.uid() is not null and not app.is_household_member(target_household) then
    raise exception 'Only a member may seed a household''s categories.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from app.households h where h.id = target_household) then
    raise exception 'No such household.' using errcode = '42704';
  end if;

  insert into app.categories (household_id, template_slug, name, kind, sort_order, is_system, icon)
  select target_household, t.slug, t.name_es, t.kind, t.sort_order, true, t.icon
    from app.category_templates t
   where t.parent_slug is null
     and not exists (
       select 1 from app.categories c
        where c.household_id = target_household and c.template_slug = t.slug
     );

  get diagnostics parents = row_count;

  insert into app.categories
    (household_id, parent_id, template_slug, name, kind, sort_order, is_system, icon)
  select target_household, parent.id, t.slug, t.name_es, t.kind, t.sort_order, true, t.icon
    from app.category_templates t
    join app.categories parent
      on parent.household_id = target_household
     and parent.template_slug = t.parent_slug
   where t.parent_slug is not null
     and not exists (
       select 1 from app.categories c
        where c.household_id = target_household and c.template_slug = t.slug
     );

  get diagnostics children = row_count;

  return parents + children;
end;
$$;

grant execute on function app.seed_household_categories(uuid) to authenticated;
