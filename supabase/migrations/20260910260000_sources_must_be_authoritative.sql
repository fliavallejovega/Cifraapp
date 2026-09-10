-- De dónde puede salir un término de una tarjeta.
--
-- El catálogo decía que una Visa ConnectMiles Platinum de Banco General daba
-- «una milla por cada US$3.00 de compra». La página del producto dice
-- literalmente «1 milla por cada dólar de compra en otros comercios», y el $3
-- es sólo para impuestos y multas al Gobierno.
--
-- El error no fue leer mal un número. Fue leer el número **de la página
-- equivocada**: la fuente citada era `/promosbg/connectmiles-y-banco-general-te-
-- brindan-doble-millas-de-bienvenida/`, una promoción de bienvenida. Una
-- promoción describe una promoción; no es autoridad sobre los términos base de
-- un producto. La casa terminó creyendo que su tarjeta rinde un tercio de lo que
-- rinde.
--
-- Y al auditar el resto aparecieron dos filas peores: una sacada de un blog y
-- otra de un artículo de periódico. Eso no es una fuente para un término de
-- contrato bajo ninguna circunstancia.
--
-- ## La regla
--
-- Un término permanente —cuántas millas por dólar, la anualidad, la cobertura de
-- un seguro— sale de la página de producto del emisor, de la página de la red, o
-- de un regulador. Nunca de una promoción, un comparador, un blog o un diario.
--
-- Una promoción sí puede citar una página de promoción: es lo que es.
--
-- El comparador del propio banco es autoridad —lo publica él— pero es más débil
-- que la página del producto, y es exactamente donde se pierde el detalle por
-- nivel: un comparador dice «millas» y la página del producto dice «2 por dólar
-- en Copa, 1 en otros comercios, 1 por cada $3 en impuestos». Por eso una tasa
-- de acumulación sólo puede venir de la página del producto.

alter table platform.card_benefit_catalogue
  add column if not exists source_kind text;

comment on column platform.card_benefit_catalogue.source_kind is
  'Qué clase de página es la fuente: product_page (del emisor), network (Visa/Mastercard), regulator (ACODECO), promotion. Un término permanente sólo puede venir de las tres primeras — una promoción describe una promoción, no los términos base.';

-- Lo que ya está, clasificado por su dirección.
update platform.card_benefit_catalogue
set source_kind = case
  when source_url like '%acodeco.gob.pa%' then 'regulator'
  when source_url like '%visa.com.pa%' then 'network'
  when source_url like '%/promosbg/%' or source_url like '%/promociones/%' then 'promotion'
  when source_url like '%comparador%' then 'comparator'
  when source_url like '%hellofyros%' or source_url like '%laestrella.com.pa%' then 'third_party'
  else 'product_page'
end
where source_kind is null;

-- Las dos que salen de un blog y de un diario se van. No se corrigen: se
-- borran, porque no había forma de que estuvieran bien — la fuente misma era el
-- error, y dejarlas con una advertencia sería seguir enseñando un término de
-- contrato leído en una nota de prensa.
delete from platform.card_benefit_catalogue
where source_kind = 'third_party';

alter table platform.card_benefit_catalogue
  drop constraint if exists card_benefit_catalogue_source_kind_check;

alter table platform.card_benefit_catalogue
  add constraint card_benefit_catalogue_source_kind_check
  check (source_kind in ('product_page', 'network', 'regulator', 'comparator', 'promotion'));

-- Y la regla dura: nada que no venga de una fuente con autoridad.
--
-- Vive en la base y no sólo en el barrido porque el barrido inserta sin pasar
-- por ninguna pantalla, y una regla que sólo existe donde se renderiza no
-- protege a la que escribe.
alter table platform.card_benefit_catalogue
  alter column source_kind set not null;

-- Y la regla fina: una **tasa de acumulación** nunca desde una promoción.
--
-- Ese fue el error exacto. Una promoción de bienvenida describe la bienvenida;
-- lo que la tarjeta da todos los días está en otra página, y la de bienvenida
-- ni siquiera lo menciona. Leer la tasa base ahí es leerla donde no está.
--
-- El comparador del propio banco sí vale: lo publica el emisor. Es más débil
-- que la página del producto —resume, y al resumir pierde el detalle por
-- nivel— así que la fila queda marcada como tal y el barrido mensual la
-- reconfirma primero. Pero es una publicación del banco sobre su propio
-- producto, y prohibirla dejaría fuera datos ciertos.
alter table platform.card_benefit_catalogue
  drop constraint if exists card_benefit_catalogue_rates_from_product_page;

alter table platform.card_benefit_catalogue
  add constraint card_benefit_catalogue_rates_never_from_a_promo
  check (kind not in ('miles', 'points', 'cashback') or source_kind <> 'promotion');
