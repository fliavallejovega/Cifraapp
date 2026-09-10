-- Las fuentes que el barrido mensual vuelve a mirar.
--
-- Once direcciones: ocho páginas de emisores, una de red, una de la autoridad y
-- una de un comparador independiente. La de ACODECO es la más valiosa de todas
-- y merece la explicación: es la Autoridad de Protección al Consumidor y
-- Defensa de la Competencia, publica un **estudio comparativo periódico** de
-- tasas y anualidades de las tarjetas emitidas en Panamá, y es la única fuente
-- de este catálogo que es a la vez oficial, transversal a todos los bancos y
-- republicada con calendario. Un banco publica lo suyo cuando quiere; ACODECO
-- publica lo de todos cuando toca.
--
-- El `kind` de cada una no es decorativo: la pantalla lo enseña, y una cifra de
-- un comparador independiente no se lee igual que la de la página del emisor.

insert into platform.catalogue_sources (name, url, issuer_key, kind, last_status) values
('ACODECO · Estudio comparativo de tarjetas de crédito',
 'https://www.acodeco.gob.pa/inicio/tarjetas-credito/', null, 'regulator', 'never'),

('Banco General · Comparador de tarjetas',
 'https://www.bgeneral.com/comparador-de-tarjetas-de-credito/', 'banco_general', 'issuer', 'never'),
('Banco General · Tarjeta Estrellas',
 'https://www.bgeneral.com/personas/tarjeta-estrellas/', 'banco_general', 'issuer', 'never'),

('BAC Credomatic · Tarjetas de crédito Panamá',
 'https://www.baccredomatic.com/es-pa/personas/tarjetas', 'bac', 'issuer', 'never'),
('BAC Credomatic · Cashback',
 'https://www2.baccredomatic.com/es-pa/tarjetas/credito/personas/cashback', 'bac', 'issuer', 'never'),

('Banistmo · Tarjetas de crédito',
 'https://www.banistmo.com/personas/tarjetas-credito', 'banistmo', 'issuer', 'never'),

('Global Bank · Beneficios de tarjetas',
 'https://www.globalbank.com.pa/banca-personal/tarjetas-de-credito/beneficios', 'global_bank', 'issuer', 'never'),

('Banesco · Programa de lealtad',
 'https://www.banesco.com.pa/tarjetas/visa-puntos-banesco/', 'banesco', 'issuer', 'never'),

('Scotiabank/Davivienda · Tarjetas de crédito',
 'https://www.davibank.pa/es/banca-personal/tarjetas-de-credito.html', 'scotiabank', 'issuer', 'never'),

('Credicorp Bank · Tarjetas de crédito personales',
 'https://www.credicorpbank.com/en/tarjetas/tarjetas-credito-personal/', 'credicorp', 'issuer', 'never'),

('Mercantil Banco · Mastercard Platinum',
 'https://mercantilbanco.com.pa/personas/tarjetas/mastercard-platinum', 'mercantil', 'issuer', 'never'),

('Visa Panamá · Beneficios de viaje',
 'https://www.visa.com.pa/promociones/visa-beneficios-viajes.html', null, 'network', 'never'),

('hellofyros.com · Comparador independiente',
 'https://hellofyros.com/mejores-tarjetas-de-credito-de-panama/', null, 'third_party', 'never')
on conflict (url) do nothing;

-- Y la llave de emisor para los bancos que el catálogo cubre y que todavía no
-- la tenían. Sólo los que tienen filas: el resto se queda nulo, que es la
-- respuesta correcta hasta que alguien lea sus condiciones.
update app.institutions set parser_key = 'scotiabank' where name = 'Scotiabank';
update app.institutions set parser_key = 'credicorp'  where name = 'Credicorp Bank';
update app.institutions set parser_key = 'mercantil'  where name = 'Mercantil Banco';
update app.institutions set parser_key = 'multibank'  where name = 'Multibank';
update app.institutions set parser_key = 'banco_nacional' where name = 'Banco Nacional de Panamá';
update app.institutions set parser_key = 'caja_ahorros'   where name = 'Caja de Ahorros';
update app.institutions set parser_key = 'towerbank'      where name = 'Towerbank';
update app.institutions set parser_key = 'st_georges'     where name = 'St. Georges Bank';
update app.institutions set parser_key = 'capital_bank'   where name = 'Capital Bank';
update app.institutions set parser_key = 'metrobank'      where name = 'Metrobank';
update app.institutions set parser_key = 'prival'         where name = 'Prival Bank';
update app.institutions set parser_key = 'unibank'        where name = 'Unibank';
update app.institutions set parser_key = 'canal_bank'     where name = 'Canal Bank';
update app.institutions set parser_key = 'banco_aliado'   where name = 'Banco Aliado';
update app.institutions set parser_key = 'lafise'         where name = 'Banco Lafise';

-- Y las filas ya sembradas quedan atadas a la fuente de la que salieron, para
-- que el barrido pueda marcarlas cuando esa página se mueva.
update platform.card_benefit_catalogue c
   set source_id = s.id
  from platform.catalogue_sources s
 where c.source_url = s.url
   and c.source_id is null;
