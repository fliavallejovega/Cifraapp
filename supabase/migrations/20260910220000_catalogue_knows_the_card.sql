-- Una referencia de mercado no es un beneficio de tu tarjeta.
--
-- El catálogo mezclaba dos cosas distintas bajo la misma tabla y la misma
-- pantalla: lo que **tu** tarjeta da, y lo que **el mercado** ofrece. Frente a
-- una Visa ConnectMiles de Banco General, la pantalla ofrecía «anualidad más
-- baja del mercado: US$84 en Davivienda» con un botón que decía «Tengo este».
--
-- Eso no es un error de filtro. Es ofrecerle a alguien declarar como propio un
-- dato sobre otro banco. Un sistema que sabe qué tarjeta tiene la casa —el
-- banco, la red, el nivel y el programa— y aun así le pregunta cuál de seis
-- programas ajenos es el suyo, no está usando lo que sabe.
--
-- La comparación con el mercado sigue siendo útil: saber que tu platino cobra
-- $150 cuando el más barato cobra $84 es exactamente la clase de cosa que este
-- producto debería decir. Lo que no puede es presentarla como algo que se
-- «tiene».

alter table platform.card_benefit_catalogue
  add column if not exists is_market_reference boolean not null default false;

comment on column platform.card_benefit_catalogue.is_market_reference is
  'Verdadero cuando la fila describe el mercado y no una tarjeta: «la anualidad más baja es US$84 en Davivienda». No se puede adoptar como propia, y se enseña aparte.';

-- Las seis de ACODECO. Son un estudio comparativo de todas las tarjetas del
-- país, no términos de ninguna.
update platform.card_benefit_catalogue
set is_market_reference = true
where source_name like 'ACODECO%'
  and (label like '%más baja del mercado%' or label like '%more%market%');

create index if not exists card_benefit_catalogue_program_idx
  on platform.card_benefit_catalogue (program)
  where program is not null;
