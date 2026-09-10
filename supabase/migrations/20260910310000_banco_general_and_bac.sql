-- Banco General y BAC, verificados contra sus propias páginas.
--
-- ## Las URLs de BAC nunca estuvieron muertas
--
-- Devolvían cero bytes porque se les mandaba un user-agent de navegador: Akamai
-- cuelga la conexión con esa cabecera y responde normal sin ella. Mi propia
-- técnica de lectura las rompía, y yo llegué a borrar una fila «porque su fuente
-- no se puede abrir». La fuente se abría; el que no sabía abrirla era yo.
--
-- ## Donde viven los errores de 3x
--
-- En los bonos por categoría, y son asimétricos entre bancos. El 2x de Banco
-- General en gasolineras y supermercados existe **sólo** en Signature y Black;
-- las Platinum, Gold y Standard dan 1 estrella por dólar y nada más. Y en BAC la
-- tasa la decide **la red, no el nivel**: las Amex rinden más que las Visa en
-- todos los niveles.
--
-- Un modelo que suponga «nivel más alto = más puntos» se equivoca en los dos.

-- ── Banco General: Estrellas y CashBack, completos ────────────────────────────
delete from platform.card_benefit_catalogue
where issuer_key = 'banco_general' and program_key in ('estrellas', 'cashback');

insert into platform.card_benefit_catalogue
  (issuer_key, network, tier, program, program_key, kind, label, value, notes,
   source_name, source_url, source_kind, captured_on, review_by)
values
  ('banco_general', null, null, 'Estrellas', 'estrellas', 'points',
   'Programa Estrellas',
   '1 estrella por cada dólar de compra. En impuestos y multas al Gobierno, 1 estrella por cada $3.',
   'Cien estrellas equivalen a un dólar de crédito. Se canjean desde 2,500, sólo desde la app y sólo por el tarjetahabiente principal, y el crédito no sustituye el pago mínimo.',
   'Banco General', 'https://www.bgeneral.com/tarjetas-de-credito/tarjeta-estrellas/',
   'product_page', '2026-09-10', '2027-03-10'),

  ('banco_general', null, 'signature', 'Estrellas', 'estrellas', 'points',
   'El doble en gasolineras y supermercados',
   '2 estrellas por cada US$1 en gasolineras y supermercados. Sólo Signature y Black.',
   'Las Platinum, Gold y Standard NO tienen este bono: dan 1 estrella por dólar en todos los comercios. Es la diferencia que decide con cuál tarjeta llenar el tanque.',
   'Banco General', 'https://www.bgeneral.com/tarjetas-de-credito/tarjeta-estrellas/',
   'product_page', '2026-09-10', '2027-03-10'),

  ('banco_general', 'mastercard', 'black', 'Estrellas', 'estrellas', 'points',
   'El doble en gasolineras y supermercados',
   '2 estrellas por cada US$1 en gasolineras y supermercados, y sin tope anual de acumulación.',
   'Las Platinum topan en 100,000 estrellas al año y las Gold y Standard en 60,000.',
   'Banco General', 'https://www.bgeneral.com/tarjetas-de-credito/tarjeta-estrellas/',
   'product_page', '2026-09-10', '2027-03-10'),

  ('banco_general', null, null, 'Estrellas', 'estrellas', 'other',
   'Las estrellas vencen a los 5 años',
   'Es de los vencimientos más largos del país: Banistmo vence a 2 años y Mercantil a 2.',
   null,
   'Banco General', 'https://www.bgeneral.com/tarjetas-de-credito/tarjeta-estrellas/paga-con-estrellas/',
   'product_page', '2026-09-10', '2027-03-10'),

  ('banco_general', 'visa', null, 'CashBack', 'cashback', 'cashback',
   'Visa CashBack',
   '1% sobre las compras del mes, con un tope de US$600.',
   'Plano: no hay categorías con porcentaje distinto. Sólo existe en Gold y Platinum.',
   'Banco General', 'https://www.bgeneral.com/tarjetas-de-credito/visa-cashback/',
   'product_page', '2026-09-10', '2027-03-10'),

  ('banco_general', null, null, null, null, 'fee',
   'Lo que cuesta cada tarjeta al año',
   'Classic y Gold US$64.20; Platinum US$101.65; Signature y Black US$160.50. El adicional va de US$21.40 a US$80.25.',
   'Del tarifario oficial actualizado en noviembre de 2025. La nota al pie de las páginas de producto dice «entre $64.20 y $187.25» y está vieja: es de octubre de 2020 y ningún producto personal llega a $187.25.',
   'Banco General · tarifario', 'https://www.bgeneral.com/tasas-comisiones-recargos/',
   'product_page', '2026-09-10', '2027-03-10'),

  ('banco_general', null, null, null, null, 'insurance',
   'El seguro de fraude se paga aparte',
   'US$3.50 al mes en Classic, Gold y Standard; US$4.50 en Platinum y superiores.',
   'La cobertura es de US$15,000 / US$25,000 / US$40,000 según la categoría.',
   'Banco General · tarifario', 'https://www.bgeneral.com/tasas-comisiones-recargos/',
   'product_page', '2026-09-10', '2027-03-10');

-- ── BAC: LifeMiles, donde la red manda sobre el nivel ─────────────────────────
delete from platform.card_benefit_catalogue where issuer_key = 'bac';

insert into platform.card_benefit_catalogue
  (issuer_key, network, tier, program, program_key, kind, label, value, notes,
   source_name, source_url, source_kind, captured_on, review_by,
   is_disputed, dispute_note, dispute_source_url)
values
  ('bac', 'visa', 'infinite', 'LifeMiles', 'lifemiles', 'miles',
   'LifeMiles Visa Infinite',
   '3 millas LifeMiles por dólar.',
   'Tope de 30,000 millas al mes y 150,000 al año. Anualidad $150 desde el primer año, sin cortesía.',
   'BAC Credomatic',
   'https://www.baccredomatic.com/es-pa/personas/tarjetas/viajes/lifemiles-infinite/visa/infinite',
   'product_page', '2026-09-10', '2027-03-10', false, null, null),

  ('bac', 'amex', 'signature', 'LifeMiles', 'lifemiles', 'miles',
   'LifeMiles Elite American Express',
   '4 millas LifeMiles por dólar — más que la Visa Infinite.',
   'En BAC la tasa la decide la RED, no el nivel: las Amex rinden más que las Visa en todos los niveles. Pero las Amex Dorada y Platinum topan en 12,500 millas al mes contra las 30,000 de la Infinite, así que por encima de unos $3,800 mensuales de consumo el orden se invierte.',
   'BAC Credomatic',
   'https://www.baccredomatic.com/es-pa/personas/tarjetas/viajes/lifemiles-elite/american-express/elite',
   'product_page', '2026-09-10', '2027-03-10', false, null, null),

  ('bac', 'visa', 'platinum', 'ConnectMiles', 'connectmiles', 'miles',
   'ConnectMiles Platinum',
   '2 millas por cada $1 en Copa Airlines; 1 milla por cada $1 en el resto de comercios.',
   'Anualidad $95. Tope de 102,000 a 150,000 millas al año.',
   'BAC Credomatic',
   'https://www.baccredomatic.com/es-pa/personas/tarjetas/destacadas/connectmiles-platinum/visa/platinum',
   'product_page', '2026-09-10', '2027-03-10', false, null, null),

  ('bac', 'amex', 'gold', 'ConnectMiles', 'connectmiles', 'miles',
   'ConnectMiles Dorada American Express',
   '2.2 millas por cada $1 en Copa Airlines; 1.1 millas por cada $1 en el resto.',
   'De nuevo la red por encima del nivel: la Amex Dorada rinde más que la Visa Platinum.',
   'BAC Credomatic',
   'https://www.baccredomatic.com/es-pa/personas/tarjetas/viajes/connectmiles-gold/american-express/dorada',
   'product_page', '2026-09-10', '2027-03-10', false, null, null),

  ('bac', null, null, 'Cashback BAC', 'cashback_bac', 'cashback',
   'SmartCash',
   'La página del programa dice 5% en supermercado y gasolina, 2% en servicios mensuales, streaming y Panapass, y 1% en otros comercios.',
   'Topes por tarjeta: de $50 a $75 al mes. La anualidad se exonera cumpliendo entre 5 y 10 transacciones mensuales.',
   'BAC Credomatic', 'https://www.baccredomatic.com/es-pa/personas/landing/cashback',
   'product_page', '2026-09-10', '2027-03-10',
   true,
   'Las páginas de cada tarjeta SmartCash del mismo banco dicen otra cosa: «hasta 5% en supermercados y gasolineras, 1% en comida rápida, restaurantes, farmacias y mascotas». No mencionan el 2%, y limitan el 1% a cuatro rubros en vez de a todos. Además una dice «5%» y la otra «hasta 5%». Preguntale a BAC cuál rige antes de elegir con cuál pagar el supermercado.',
   'https://www.baccredomatic.com/es-pa/personas/tarjetas/destacadas/smartcash-platinum-visa/visa/platino');

-- Y el programa LifeMiles, que faltaba en el catálogo de programas.
insert into platform.card_programs
  (issuer_key, program_key, name, kind, networks, tiers, detail,
   source_name, source_url, captured_on, review_by)
values
  ('bac', 'lifemiles', 'LifeMiles', 'miles', '{visa,amex}', '{}',
   'El programa de Avianca. En BAC la tasa la decide la red antes que el nivel: las Amex rinden más que las Visa.',
   'BAC Credomatic',
   'https://www.baccredomatic.com/es-pa/personas/tarjetas/viajes/lifemiles-infinite/visa/infinite',
   '2026-09-10', '2027-03-10')
on conflict (issuer_key, program_key) do update set
  detail = excluded.detail, source_url = excluded.source_url,
  captured_on = excluded.captured_on, review_by = excluded.review_by, updated_at = now();
