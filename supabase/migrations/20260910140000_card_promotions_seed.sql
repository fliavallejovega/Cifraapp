-- Las páginas de promociones que el barrido relee cada mes, y lo que decían el
-- 10 de septiembre de 2026.
--
-- Estas filas entran como `verified` porque las leyó una persona —esta sesión—
-- contra la página oficial y anotó las condiciones que la página daba. Lo que
-- suba el barrido automático entrará como `unverified`, y la pantalla los
-- distingue siempre.

insert into platform.catalogue_sources (name, url, issuer_key, kind, last_status) values
('Banco General · Restaurantes participantes',
 'https://www.bgeneral.com/restaurantes/', 'banco_general', 'promotions', 'never'),
('Banco General · Promociones',
 'https://www.bgeneral.com/personas/promociones/', 'banco_general', 'promotions', 'never'),
('Banco General · Promociones Mastercard Débito',
 'https://www.bgeneral.com/promociones-mastercard-debito/', 'banco_general', 'promotions', 'never'),
('BAC Credomatic · Promociones',
 'https://www.baccredomatic.com/es-pa/personas/promociones', 'bac', 'promotions', 'never'),
('Banistmo · Promociones y descuentos',
 'https://www.banistmo.com/personas/promociones', 'banistmo', 'promotions', 'never'),
('Scotiabank/Davivienda · Promociones',
 'https://www.davibank.pa/es/banca-personal/promociones.html', 'scotiabank', 'promotions', 'never')
on conflict (url) do nothing;

insert into platform.card_promotions
  (issuer_key, issuer_name, networks, card_types, merchant_name, merchant_note, category,
   headline, detail, max_discount, max_spend, weekdays, valid_from, valid_until, channel,
   source_name, source_url, captured_on, status, verified_at)
values
-- ── Banco General ──────────────────────────────────────────────────────────
('banco_general', 'Banco General',
 array['visa','mastercard'], array['credit','debit'],
 'Fosters', 'Sucursales participantes', 'restaurantes',
 '50% de descuento en el total de la cuenta',
 'Todos los martes de septiembre de 2026 (1, 8, 15, 22 y 29). Consumo elegible hasta US$250 y descuento máximo US$125. Sólo con tarjetas personales Visa o Mastercard de Banco General.',
 125.0000, 250.0000, array[2]::smallint[], '2026-09-01', '2026-09-29', 'Sólo consumo dentro del restaurante',
 'Fosters Panamá (página de la promoción)', 'https://fosterspanama.com/50-de-descuento-en-fosters-con-banco-general-todos-los-martes-de-septiembre/',
 '2026-09-10', 'verified', now()),

('banco_general', 'Banco General',
 array['visa','mastercard'], array['credit','debit'],
 'Restaurantes participantes', 'La lista completa vive en bgeneral.com/restaurantes', 'restaurantes',
 '50% de descuento en restaurantes',
 'Descuento del 50% en los restaurantes participantes al pagar con tarjetas de Banco General. La lista de comercios y los días de cada uno cambian mes a mes.',
 null, null, array[]::smallint[], null, null, null,
 'Banco General', 'https://www.bgeneral.com/restaurantes/', '2026-09-10', 'verified', now()),

('banco_general', 'Banco General',
 array['visa','mastercard'], array['credit','debit'],
 'Friday''s', null, 'restaurantes',
 '2x1',
 'Promoción 2x1 publicada en la página de promociones de Banco General. Revisá los días y las sucursales que aplican antes de ir.',
 null, null, array[]::smallint[], null, null, null,
 'Banco General', 'https://www.bgeneral.com/promosbg/2x1-en-fridays/', '2026-09-10', 'verified', now()),

('banco_general', 'Banco General',
 array['visa','mastercard'], array['credit','debit'],
 'Bad Juanito', null, 'restaurantes',
 '2x1',
 'Promoción 2x1 publicada en la página de promociones de Banco General.',
 null, null, array[]::smallint[], null, null, null,
 'Banco General', 'https://www.bgeneral.com/promosbg/2x1-en-bad-juanito/', '2026-09-10', 'verified', now()),

-- ── BAC Credomatic ─────────────────────────────────────────────────────────
('bac', 'BAC Credomatic',
 array[]::text[], array['debit'],
 'McDonald''s', 'Por la app, mediante Pide y Pasa', 'restaurantes',
 '25% de descuento sobre el total de la orden',
 'Comprando por la app de McDonald''s con Pide y Pasa y pagando con tarjetas de débito BAC. Válido del 8 al 31 de julio de 2026 o hasta agotar existencias.',
 null, null, array[]::smallint[], '2026-07-08', '2026-07-31', 'Sólo por la app de McDonald''s',
 'BAC Credomatic', 'https://www.baccredomatic.com/es-pa/personas/promociones', '2026-09-10', 'verified', now()),

('bac', 'BAC Credomatic',
 array[]::text[], array['debit'],
 'Billetera digital', 'Apple Pay, Google Pay o Garmin Pay', 'tecnologia',
 'US$5.00 de cashback por registrarte',
 'Para nuevos registros en Apple Pay, Google Pay o Garmin Pay con tarjeta de débito BAC que hagan su primera compra por la billetera. Válido del 1 de julio al 31 de agosto de 2026.',
 5.0000, null, array[]::smallint[], '2026-07-01', '2026-08-31', 'Pago por billetera digital',
 'BAC Credomatic', 'https://www.baccredomatic.com/es-pa/personas/promociones', '2026-09-10', 'verified', now());

-- Atar cada promoción a su fuente, para que el barrido pueda marcarla cuando la
-- página se mueva.
update platform.card_promotions p
   set source_id = s.id
  from platform.catalogue_sources s
 where p.source_url = s.url
   and p.source_id is null;

/**
 * Lo que ya venció, marcado como tal.
 *
 * Dos de estas promociones son de julio y agosto y se siembran igual, a
 * propósito: una promoción vencida es la prueba de que la fuente publica esta
 * clase de oferta y con qué condiciones, y el barrido de octubre va a traer la
 * equivalente. Esconderlas dejaría la pantalla vacía y la impresión de que el
 * banco no da nada.
 */
update platform.card_promotions
   set status = 'expired'
 where valid_until is not null
   and valid_until < current_date
   and status <> 'rejected';
