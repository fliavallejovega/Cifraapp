-- Toda dirección del catálogo es una fuente que el barrido relee.
--
-- Al sembrar quedaron catorce filas cuya dirección no estaba registrada como
-- fuente: páginas de producto de Banesco y Credicorp, la de LifeMiles de BAC,
-- las promociones sueltas de Banco General. Funcionaban —la fila tenía su
-- dirección y su fecha— pero el barrido mensual no las miraba nunca, así que
-- eran las únicas del catálogo que podían envejecer en silencio.
--
-- Esto las registra derivándolas del propio catálogo, en vez de mantener una
-- lista a mano que se desincroniza a la primera. La regla queda escrita en el
-- esquema: **si una fila cita una dirección, esa dirección se vigila**.
--
-- El nombre de la fuente sale del que la fila ya usaba, y el tipo de si la
-- dirección pertenece a un emisor conocido o no.

insert into platform.catalogue_sources (name, url, issuer_key, kind, last_status)
select distinct on (c.source_url)
       c.source_name,
       c.source_url,
       c.issuer_key,
       case
         when c.source_name ilike '%acodeco%'   then 'regulator'
         when c.source_name ilike '%visa%'      then 'network'
         when c.source_name ilike '%comparador de terceros%'
           or c.source_name ilike '%hellofyros%'
           or c.source_name ilike '%prensa%'
           or c.source_name ilike '%estrella%'  then 'third_party'
         else 'issuer'
       end,
       'never'
  from platform.card_benefit_catalogue c
 where c.source_url not in (select url from platform.catalogue_sources)
 order by c.source_url, c.captured_on desc
on conflict (url) do nothing;

insert into platform.catalogue_sources (name, url, issuer_key, kind, last_status)
select distinct on (p.source_url)
       p.source_name, p.source_url, p.issuer_key, 'promotions', 'never'
  from platform.card_promotions p
 where p.source_url not in (select url from platform.catalogue_sources)
 order by p.source_url, p.captured_on desc
on conflict (url) do nothing;

-- Y ahora sí, cada fila atada a la suya.
update platform.card_benefit_catalogue c
   set source_id = s.id
  from platform.catalogue_sources s
 where c.source_url = s.url and c.source_id is null;

update platform.card_promotions p
   set source_id = s.id
  from platform.catalogue_sources s
 where p.source_url = s.url and p.source_id is null;
