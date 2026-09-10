-- Banistmo, Banesco y Global Bank, verificados contra sus propias páginas.
--
-- ## Banistmo: el programa que el catálogo nombraba ya no existe
--
-- Este sistema decía «Regálate». Banistmo lo reemplazó por **MultiPuntos**, y
-- las cuatro URLs del viejo programa devuelven 404. Peor que el nombre: la tasa
-- no es plana. Una Clásica da 1 punto por dólar y una Black da 5 en viajes, y el
-- catálogo enseñaba una sola cifra para las cuatro.
--
-- ## Banesco: la Infinite no acumula más que la Platinum
--
-- Las dos publican la misma tabla de cinco tramos. Lo que las separa es el tope
-- anual, el bono y las coberturas — no la acumulación. Suponer que un nivel más
-- alto rinde más por dólar es la clase de inferencia que este catálogo no hace.
--
-- ## Global Bank: la categoría acelerada se elige, y es una sola
--
-- «2 Links por dólar» no aplica a supermercados y gasolineras y entretenimiento:
-- aplica a **la que el cliente eligió**. Las otras dos quedan en 1.

-- ── Banistmo ──────────────────────────────────────────────────────────────────
delete from platform.card_benefit_catalogue where issuer_key = 'banistmo';

update platform.card_programs
set program_key = 'multipuntos',
    name = 'MultiPuntos',
    detail = 'El programa de puntos de Banistmo. Reemplazó a Regálate: las páginas del programa viejo ya no existen.',
    source_url = 'https://www.banistmo.com/personas/multipuntos',
    captured_on = '2026-09-10',
    review_by = '2027-03-10',
    updated_at = now()
where issuer_key = 'banistmo' and program_key = 'regalate';

insert into platform.card_benefit_catalogue
  (issuer_key, network, tier, program, program_key, kind, label, value, notes,
   source_name, source_url, source_kind, captured_on, review_by)
values
  ('banistmo', null, 'classic', 'MultiPuntos', 'multipuntos', 'points',
   'MultiPuntos Clásica',
   '1.5 MultiPuntos por cada $1.00 en supermercados, Metro de Panamá y MetroBus; 1 MultiPunto por dólar en el resto.',
   'Tope de 60,000 MultiPuntos al año. Un punto vale $0.010 canjeado en comercio afiliado y $0.008 canjeado por efectivo.',
   'Banistmo', 'https://www.banistmo.com/personas/multipuntos', 'product_page', '2026-09-10', '2027-03-10'),

  ('banistmo', 'visa', 'gold', 'MultiPuntos', 'multipuntos', 'points',
   'MultiPuntos Oro',
   '2 MultiPuntos por cada $1.00 en restaurantes, comida rápida y gasolineras; 1 por dólar en el resto.',
   'Tope de 60,000 MultiPuntos al año.',
   'Banistmo', 'https://www.banistmo.com/personas/multipuntos', 'product_page', '2026-09-10', '2027-03-10'),

  ('banistmo', null, 'platinum', 'MultiPuntos', 'multipuntos', 'points',
   'MultiPuntos Platinum',
   '2 MultiPuntos por cada $1.00 en supermercados, streaming, e-commerce e inteligencia artificial; 1 por dólar en el resto.',
   'El streaming y el e-commerce sólo aplican a la lista de aplicaciones y comercios que publica Banistmo. Tope de 100,000 MultiPuntos al año.',
   'Banistmo', 'https://www.banistmo.com/personas/multipuntos', 'product_page', '2026-09-10', '2027-03-10'),

  ('banistmo', 'mastercard', 'black', 'MultiPuntos', 'multipuntos', 'points',
   'MultiPuntos Black',
   '5 MultiPuntos por cada $1.00 en viajes; 2 en restaurantes, comida rápida y supermercados; 1 en el resto.',
   'Tope de 150,000 MultiPuntos al año.',
   'Banistmo', 'https://www.banistmo.com/personas/multipuntos', 'product_page', '2026-09-10', '2027-03-10'),

  ('banistmo', null, null, 'MultiPuntos', 'multipuntos', 'other',
   'Los puntos vencen, y se pierden por no usar la tarjeta',
   'Vigencia de 2 años. Y a los 4 meses consecutivos sin comprar ni retirar, se pierde el 100% de los puntos acumulados.',
   'También vencen al cancelar la tarjeta, con 60 días o más de mora, o con arreglo de pago vigente.',
   'Banistmo', 'https://www.banistmo.com/personas/multipuntos', 'product_page', '2026-09-10', '2027-03-10'),

-- ── Banesco ───────────────────────────────────────────────────────────────────
  ('banesco', 'visa', 'platinum', 'ConnectMiles', 'connectmiles', 'miles',
   'Visa Platinum ConnectMiles',
   '5 millas por dólar en Copa Airlines, 4 en renta de autos, 3 en hoteles, 2 fuera de Panamá y 1 en el resto de comercios.',
   'Tope de 240,000 millas al año (20,000 al mes). Anualidad gratis el primer año.',
   'Banesco Panamá', 'https://www.banesco.com.pa/tarjetas/visa-platinum-connectmiles/', 'product_page', '2026-09-10', '2027-03-10'),

  ('banesco', 'visa', 'infinite', 'ConnectMiles', 'connectmiles', 'miles',
   'Visa Infinite ConnectMiles',
   '5 millas por dólar en Copa Airlines, 4 en renta de autos, 3 en hoteles, 2 fuera de Panamá y 1 en el resto de comercios.',
   'La misma acumulación que la Platinum: lo que cambia es el tope (600,000 al año), el bono de bienvenida y las coberturas. Un nivel más alto no rinde más por dólar.',
   'Banesco Panamá', 'https://www.banesco.com.pa/tarjetas/visa-infinite-connectmiles/', 'product_page', '2026-09-10', '2027-03-10'),

  ('banesco', 'visa', 'infinite', 'ConnectMiles', 'connectmiles', 'insurance',
   'Asistencia médica internacional',
   'Hasta $150,000 en la Infinite; hasta $70,000 en la Platinum.',
   null,
   'Banesco Panamá', 'https://www.banesco.com.pa/tarjetas/visa-infinite-connectmiles/', 'product_page', '2026-09-10', '2027-03-10'),

-- ── Global Bank ───────────────────────────────────────────────────────────────
  ('global_bank', null, null, 'Link Points', 'link_points', 'points',
   'Global Link Clásica, Dorada y Platinum',
   '1 Link por cada dólar de compra, y 2 Links por dólar en UNA categoría que el cliente elige.',
   'Se elige un solo plan —supermercados y farmacias, autos y gasolineras, o entretenimiento— y las otras dos quedan en 1 Link. Tope anual de 100,000 puntos en Clásica y Dorada, 200,000 en Platinum.',
   'Global Bank', 'https://www.globalbank.com.pa/banca-personal/tarjetas-de-credito/nuestras-tarjetas/global-link-clasica-dorada-y-platinum', 'product_page', '2026-09-10', '2027-03-10'),

  ('global_bank', 'mastercard', 'black', 'Link Points', 'link_points', 'points',
   'Mastercard Black',
   '3 puntos por dólar en entretenimiento, 2 en viajes y 1 en el resto de compras.',
   'Sin tope anual de acumulación. Además, hasta 2,500 puntos al mes por mantener saldos en cuentas de ahorro del banco, a razón de 500 por cada $50,000.',
   'Global Bank', 'https://www.globalbank.com.pa/banca-personal/tarjetas-de-credito/nuestras-tarjetas/mastercard-black', 'product_page', '2026-09-10', '2027-03-10'),

  ('global_bank', null, null, 'Link Points', 'link_points', 'other',
   'Los puntos se pierden por mora o por no usar la tarjeta',
   'A los 90 días de mora, o a los 6 meses sin comprar en punto de venta, o al cancelar la tarjeta.',
   'El banco no publica cuánto vale un punto en dólares: su reglamento dice que el valor lo fijan el banco y los comercios afiliados. Sin ese dato no se puede comparar contra un programa que sí lo publica.',
   'Global Bank', 'https://www.globalbank.com.pa/banca-personal/tarjetas-de-credito/nuestras-tarjetas/global-link-clasica-dorada-y-platinum', 'product_page', '2026-09-10', '2027-03-10');

-- El valor de canje de Banistmo, que es la cifra que de verdad compara programas.
insert into platform.card_benefit_catalogue
  (issuer_key, network, tier, program, program_key, kind, label, value, notes,
   source_name, source_url, source_kind, captured_on, review_by)
values
  ('banistmo', null, null, 'MultiPuntos', 'multipuntos', 'other',
   'Cuánto vale un MultiPunto',
   '$0.010 canjeado en comercio afiliado; $0.008 canjeado por efectivo.',
   'Es de los pocos programas del país que publica su valor de canje. Sin ese número, «puntos por dólar» no se puede comparar entre bancos.',
   'Banistmo', 'https://www.banistmo.com/personas/multipuntos', 'product_page', '2026-09-10', '2027-03-10');
