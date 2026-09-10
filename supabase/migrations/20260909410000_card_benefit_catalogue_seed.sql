-- Lo que los emisores de Panamá publicaban el 9 de septiembre de 2026.
--
-- Cada fila se leyó ese día en la dirección que lleva pegada. Ninguna es una
-- estimación y ninguna se completó de memoria: lo que la fuente no dijo, aquí
-- está nulo. `valid_until` está vacío en casi todas porque casi ninguna fuente
-- publica una fecha de fin — poner una inventada sería peor que no tenerla.
--
-- `review_by` es seis meses después de la lectura y **no** es un término del
-- banco: es la sugerencia de este producto sobre cuándo volver a mirar. La
-- pantalla lo dice con esas palabras.
--
-- Dos fuentes son de terceros y van marcadas como tales en `source_name`, para
-- que se lean con la desconfianza que corresponde frente a la página del propio
-- emisor.

insert into platform.card_benefit_catalogue
  (issuer_key, network, tier, program, kind, label, value, source_name, source_url, captured_on, review_by, notes)
values
-- ── Banco General ──────────────────────────────────────────────────────────
('banco_general', null, null, 'Estrellas', 'points',
 'Programa Estrellas',
 'Una estrella por cada US$1 de compra, y una por cada US$3 en pago de multas e impuestos. Se canjean como crédito contra el saldo de la tarjeta.',
 'Banco General', 'https://www.bgeneral.com/personas/tarjeta-estrellas/', '2026-09-09', '2027-03-09', null),

('banco_general', 'visa', null, 'ConnectMiles', 'miles',
 'Visa ConnectMiles',
 'Una milla ConnectMiles por cada US$3.00 de compra, y por cada US$3.00 en impuestos y multas a favor del Gobierno de Panamá.',
 'Banco General', 'https://www.bgeneral.com/promosbg/connectmiles-y-banco-general-te-brindan-doble-millas-de-bienvenida/', '2026-09-09', '2027-03-09',
 'La promoción de doble milla de bienvenida es aparte y tiene su propia vigencia; confirmala en la página.'),

('banco_general', 'visa', null, 'CashBack', 'cashback',
 'Visa CashBack',
 '1% de bonificación por cada dólar de consumo, acreditado en el estado de cuenta mensual.',
 'Banco General', 'https://www.bgeneral.com/comparador-de-tarjetas-de-credito/', '2026-09-09', '2027-03-09', null),

('banco_general', null, 'classic', null, 'insurance',
 'Cobertura por fraude', 'Hasta US$15,000.',
 'Banco General', 'https://www.bgeneral.com/comparador-de-tarjetas-de-credito/', '2026-09-09', '2027-03-09',
 'La fuente agrupa Classic, Gold y Standard en el mismo tope.'),
('banco_general', null, 'gold', null, 'insurance',
 'Cobertura por fraude', 'Hasta US$15,000.',
 'Banco General', 'https://www.bgeneral.com/comparador-de-tarjetas-de-credito/', '2026-09-09', '2027-03-09', null),
('banco_general', null, 'platinum', null, 'insurance',
 'Cobertura por fraude', 'Hasta US$25,000.',
 'Banco General', 'https://www.bgeneral.com/comparador-de-tarjetas-de-credito/', '2026-09-09', '2027-03-09', null),
('banco_general', null, 'signature', null, 'insurance',
 'Cobertura por fraude', 'Hasta US$40,000.',
 'Banco General', 'https://www.bgeneral.com/comparador-de-tarjetas-de-credito/', '2026-09-09', '2027-03-09', null),
('banco_general', null, 'infinite', null, 'insurance',
 'Cobertura por fraude', 'Hasta US$40,000.',
 'Banco General', 'https://www.bgeneral.com/comparador-de-tarjetas-de-credito/', '2026-09-09', '2027-03-09', null),
('banco_general', null, 'black', null, 'insurance',
 'Cobertura por fraude', 'Hasta US$40,000.',
 'Banco General', 'https://www.bgeneral.com/comparador-de-tarjetas-de-credito/', '2026-09-09', '2027-03-09', null),

-- ── BAC Credomatic ─────────────────────────────────────────────────────────
('bac', null, null, 'Cashback BAC', 'cashback',
 'Cashback en supermercados y gasolineras', '5% de devolución.',
 'BAC Credomatic', 'https://www2.baccredomatic.com/es-pa/tarjetas/credito/personas/cashback', '2026-09-09', '2027-03-09',
 'La fuente no publica tope mensual en la página de producto. Confirmalo en tu contrato antes de contar con ello.'),

('bac', null, null, 'Cashback BAC', 'cashback',
 'Cashback en comida rápida, fondas, farmacias y tiendas de mascotas', '1% de devolución.',
 'BAC Credomatic', 'https://www2.baccredomatic.com/es-pa/tarjetas/credito/personas/cashback', '2026-09-09', '2027-03-09', null),

('bac', null, null, 'ConnectMiles', 'miles',
 'Bono de bienvenida ConnectMiles', '10,000 millas ConnectMiles de bienvenida.',
 'BAC Credomatic', 'https://www.baccredomatic.com/personas/promociones/connectmiles', '2026-09-09', '2027-03-09',
 'Los bonos de bienvenida suelen tener condiciones de consumo y fecha. Esta fuente no las publicaba el día de la lectura.'),

('bac', 'visa', 'infinite', 'LifeMiles', 'miles',
 'LifeMiles Infinite', '4 LifeMiles por cada dólar de compra.',
 'BAC Credomatic', 'https://www.baccredomatic.com/es-pa/personas/tarjetas/viajes/lifemiles-infinite/visa/infinite', '2026-09-09', '2027-03-09',
 'Canjeables en Avianca y aerolíneas de Star Alliance.'),

-- ── Banistmo ───────────────────────────────────────────────────────────────
('banistmo', null, null, 'Regálate', 'points',
 'Programa Regálate',
 'Puntos canjeables en comercios afiliados, convertibles en efectivo o transferibles a millas.',
 'Banistmo', 'https://www.banistmo.com/personas/tarjetas-credito', '2026-09-09', '2027-03-09', null),

('banistmo', null, null, null, 'waiver',
 'Tarjeta adicional sin membresía', 'Sin cobro de membresía por la tarjeta adicional.',
 'Banistmo', 'https://www.banistmo.com/personas/tarjetas-credito', '2026-09-09', '2027-03-09', null),

('banistmo', null, null, null, 'insurance',
 'Cobertura por fraude o robo', 'Los 365 días del año, en cualquier parte del mundo.',
 'Banistmo', 'https://www.banistmo.com/personas/tarjetas-credito', '2026-09-09', '2027-03-09', null),

('banistmo', 'visa', null, null, 'cashback',
 'Cashback personalizable', 'Hasta 7% de devolución mensual, según el comercio que elijas.',
 'hellofyros.com (comparador de terceros, no el banco)', 'https://hellofyros.com/mejores-tarjetas-de-credito-de-panama/', '2026-09-09', '2027-03-09',
 'Dato de un comparador independiente, no de Banistmo. Verificalo con el banco antes de decidir con esta cifra.'),

-- ── Global Bank ────────────────────────────────────────────────────────────
('global_bank', null, null, 'Link Points', 'points',
 'Link Points',
 'Transferibles a millas ConnectMiles de Copa o a millas Suma, y canjeables en LinkPromo.',
 'Global Bank', 'https://www.globalbank.com.pa/banca-personal/tarjetas-de-credito/beneficios', '2026-09-09', '2027-03-09', null),

('global_bank', null, null, null, 'fee',
 'Anualidad', 'US$150 en general; US$50 en el segmento Cash Back.',
 'La Estrella de Panamá (prensa, no el banco)', 'https://www.laestrella.com.pa/economia/intereses-y-anualidades-cuanto-cuesta-usar-una-tarjeta-en-panama-IP19074590', '2026-09-09', '2027-03-09',
 'Dato de prensa, no de la página del emisor. La anualidad varía por producto y por negociación; confirmala con tu banco.'),

-- ── Banesco ────────────────────────────────────────────────────────────────
('banesco', 'visa', 'platinum', 'ConnectMiles', 'miles',
 'Visa Platinum ConnectMiles',
 '10,000 millas ConnectMiles de bienvenida al alcanzar US$3,000 en compras durante los primeros 3 meses desde la activación.',
 'Banesco Panamá', 'https://www.banesco.com.pa/tarjetas/visa-platinum-connectmiles/', '2026-09-09', '2027-03-09', null),

('banesco', 'visa', 'infinite', 'ConnectMiles', 'miles',
 'Visa Infinite ConnectMiles', 'Hasta 5x millas ConnectMiles por compra.',
 'Banesco Panamá', 'https://www.banesco.com.pa/tarjetas/visa-infinite-connectmiles/', '2026-09-09', '2027-03-09',
 'El multiplicador depende del comercio y del día. Confirmá en qué categorías aplica.'),

('banesco', null, null, null, 'waiver',
 'Anualidad del primer año', 'Gratis el primer año; se cobra a partir del segundo.',
 'Banesco Panamá', 'https://www.banesco.com.pa/tarjetas/visa-puntos-banesco/', '2026-09-09', '2027-03-09', null),

-- ── Red Visa, por nivel: aplica lo emita quien lo emita ─────────────────────
(null, 'visa', 'infinite', null, 'insurance',
 'Seguro de alquiler de vehículo',
 'Cubre robo o daño por colisión, robo, vandalismo, incendio y accidentes.',
 'Visa Panamá', 'https://www.visa.com.pa/promociones/visa-beneficios-viajes.html', '2026-09-09', '2027-03-09',
 'Suele exigir pagar el alquiler completo con la tarjeta y rechazar el seguro de la agencia. Leé la guía de beneficios antes de usarlo.'),

(null, 'visa', 'infinite', null, 'insurance',
 'Seguro de equipaje',
 'Pérdida de equipaje para el titular y su familia, y demora de equipaje en todos los tramos salvo el regreso a la residencia.',
 'Visa Panamá', 'https://www.visa.com.pa/promociones/visa-beneficios-viajes.html', '2026-09-09', '2027-03-09', null),

(null, 'visa', 'infinite', null, 'lounge',
 'Salas VIP', 'Acceso por LoungeKey a más de 1,100 salas en el mundo.',
 'Visa Panamá', 'https://www.visa.com.pa/promociones/visa-beneficios-viajes.html', '2026-09-09', '2027-03-09',
 'El número de visitas gratis lo fija el emisor, no la red. Preguntalo en tu banco.'),

(null, 'visa', 'signature', null, 'lounge',
 'Salas VIP', 'Acceso por LoungeKey a salas VIP de aeropuerto.',
 'Visa Panamá', 'https://www.visa.com.pa/promociones/visa-beneficios-viajes.html', '2026-09-09', '2027-03-09', null),

(null, 'visa', 'infinite', null, 'other',
 'Visa Digital Concierge',
 'Asistencia personal para viajes, hoteles, alquiler de vehículos y emergencias.',
 'Visa Panamá', 'https://www.visa.com.pa/promociones/visa-beneficios-viajes.html', '2026-09-09', '2027-03-09', null);

-- La llave que une un banco de la lista con su fila del catálogo.
--
-- `parser_key` existía desde el modelo original y nada la llenaba nunca. Es
-- exactamente para esto: un identificador estable del emisor que no depende de
-- cómo esté escrito su nombre. Sólo se llenan los cinco que el catálogo cubre;
-- el resto se quedan nulos, que es la respuesta correcta hasta que alguien lea
-- sus condiciones.
update app.institutions set parser_key = 'banco_general' where name = 'Banco General';
update app.institutions set parser_key = 'bac'           where name = 'BAC Credomatic';
update app.institutions set parser_key = 'banistmo'      where name = 'Banistmo';
update app.institutions set parser_key = 'global_bank'   where name = 'Global Bank';
update app.institutions set parser_key = 'banesco'       where name = 'Banesco';
