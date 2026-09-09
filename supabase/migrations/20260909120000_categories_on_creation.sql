-- Los rubros existen desde que existe el hogar, no desde que termina el setup.
--
-- El árbol de categorías se copiaba en `completeSetup`, es decir al **final**
-- del cuestionario. Pero la pregunta «¿en qué rubro va este pago?» está dentro
-- del cuestionario, unos pasos antes: la primera vez, el menú salía vacío y
-- quien lo miraba concluía razonablemente que la aplicación no tiene rubros.
--
-- Nada estaba roto en la función que los copia; estaba llamada tarde. Un hogar
-- sin categorías no es un estado que valga la pena poder representar: no hay
-- momento en la vida de un hogar en el que tenga sentido no poder clasificar un
-- gasto, así que nacen con él.

create or replace function app.create_household(
  household_name text,
  currency char(3) default 'USD',
  household_time_zone text default 'America/Panama'
)
returns uuid
language plpgsql
security definer
set search_path = app, public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  new_household uuid;
begin
  if caller is null then
    raise exception 'A household can only be created by a signed-in user.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from app.profiles p where p.id = caller) then
    raise exception 'No profile exists for the current user.'
      using errcode = '42501';
  end if;

  insert into app.households (name, base_currency, time_zone, created_by)
  values (household_name, currency, household_time_zone, caller)
  returning id into new_household;

  insert into app.household_members (household_id, user_id, role, status, joined_at)
  values (new_household, caller, 'owner', 'active', now());

  -- Después de la membresía y no antes: la función que siembra comprueba que
  -- quien la llama sea miembro, y hasta esta línea el creador todavía no lo es.
  perform app.seed_household_categories(new_household);

  insert into audit.events (actor_user_id, action, entity_type, entity_id, household_id)
  values (caller, 'household.created', 'household', new_household, new_household);

  return new_household;
end;
$$;

-- Los hogares que ya existen y se quedaron sin árbol porque nunca llegaron al
-- final del cuestionario. La función no duplica nada: inserta solo lo que falta.
do $$
declare
  target uuid;
begin
  for target in
    select h.id
      from app.households h
     where not exists (
       select 1 from app.categories c where c.household_id = h.id
     )
  loop
    perform app.seed_household_categories(target);
  end loop;
end;
$$;
