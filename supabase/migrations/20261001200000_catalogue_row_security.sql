-- Seguridad de fila forzada en el catálogo de tarjetas.
--
-- Las cinco tablas del catálogo nacieron sin seguridad de fila. Son referencia
-- pública —lo que cada tarjeta da, sus promociones y de dónde salió cada
-- dato— y por eso se leen con la clave pública; eso no cambia. Lo que cambia
-- es que ahora la regla está escrita: lectura para todos, escritura solo para
-- el rol de servicio que corre el barrido, y forzada, como el resto de
-- `platform`. La auditoría de seguridad lo exige y una base reconstruida desde
-- cero lo tiene igual que producción.
--
-- `card_programs` no tiene permisos para clientes: queda cerrada y sin
-- políticas, como `feature_flags`.

do $$
declare
  t text;
begin
  foreach t in array array[
    'card_benefit_catalogue', 'card_promotions', 'catalogue_refresh_runs', 'catalogue_sources'
  ] loop
    execute format('alter table platform.%I enable row level security', t);
    execute format('alter table platform.%I force row level security', t);
    execute format('drop policy if exists %I on platform.%I', t || '_readable', t);
    execute format('create policy %I on platform.%I for select to anon, authenticated using (true)',
      t || '_readable', t);
  end loop;
end;
$$;

alter table platform.card_programs enable row level security;
alter table platform.card_programs force row level security;
