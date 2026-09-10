-- Scotiabank, Credicorp, Mercantil y Visa, verificados contra sus propias fuentes.
--
-- Lo más grave del lote no es una tasa: es un beneficio que este catálogo podría
-- estar prometiendo y que **no existe desde octubre de 2021**. Visa descontinuó
-- el seguro de alquiler de vehículos para las Platinum y Gold emitidas en Panamá.
-- Una casa que alquila un auto confiando en esa cobertura la descubre en el
-- mostrador.

delete from platform.card_benefit_catalogue
where issuer_key in ('scotiabank', 'credicorp', 'mercantil');

-- La red: sólo lo que Visa atribuye por nivel, con sus montos.
delete from platform.card_benefit_catalogue where source_url like '%visa.com%';

insert into platform.card_benefit_catalogue
  (issuer_key, network, tier, program, program_key, kind, label, value, notes,
   source_name, source_url, source_kind, captured_on, review_by,
   is_disputed, dispute_note, dispute_source_url)
values
  -- ── Scotiabank / Davivienda ────────────────────────────────────────────────
  ('scotiabank', 'visa', 'signature', '+Premios', 'mas_premios', 'points',
   'Visa Signature +Premios',
   '3 puntos por dólar en hoteles, renta de autos, boletos aéreos y agencias de viajes; 2 en restaurantes y compras en el extranjero; 1 en el resto.',
   'Anualidad US$215.00 a partir del segundo año, con hasta 7 adicionales sin costo. Tasa 20.50%. Ingreso mínimo exigido: $3,500 al mes.',
   'Scotiabank Panamá (Davivienda)',
   'https://www.davibank.pa/es/banca-personal/tarjetas-de-credito/scotiabank-visa-signature-premios.html',
   'product_page', '2026-09-10', '2027-03-10', false, null, null),

  ('scotiabank', 'visa', 'signature', '+Premios', 'mas_premios', 'other',
   '¿Vencen los puntos +Premios?',
   'La página del producto dice que no vencen mientras se use la tarjeta.',
   'Preguntale al banco cuál documento rige hoy antes de contar con un saldo viejo.',
   'Scotiabank Panamá (Davivienda)',
   'https://www.davibank.pa/es/banca-personal/tarjetas-de-credito/scotiabank-visa-signature-premios.html',
   'product_page', '2026-09-10', '2027-03-10',
   true,
   'El reglamento del mismo banco dice lo contrario: «Los puntos vencerán si después de veinticuatro (24) meses de haber sido otorgados, los mismos no han sido utilizados en su totalidad», y que se pierden todos tras seis meses sin comprar. El reglamento es de julio de 2021; la página es actual.',
   'https://www.davibank.pa/content/dam/scotiabank/international/panama/Espanol/Programas-Lealtad-Scotiabank-julio-2021.pdf'),

  ('scotiabank', 'visa', 'signature', '+Premios', 'mas_premios', 'lounge',
   'Cinco visitas a salas VIP',
   '5 visitas gratis al año, cortesía de Davivienda, por Visa Airport Companion.',
   'La cantidad de visitas la pone el banco, no Visa.',
   'Scotiabank Panamá (Davivienda)',
   'https://www.davibank.pa/es/banca-personal/tarjetas-de-credito/scotiabank-visa-signature-premios.html',
   'product_page', '2026-09-10', '2027-03-10', false, null, null),

  -- ── Credicorp ──────────────────────────────────────────────────────────────
  ('credicorp', 'visa', 'classic', 'Credicorp Rewards', 'credicorp_rewards', 'points',
   'Visa Clásica Rewards',
   'La página del producto dice 3 puntos por dólar en supermercados, restaurantes, farmacias, cable, telefonía, seguros, educación, peaje, clubes, taxis y limosinas; 1 en el resto.',
   'Anualidad $80.25 el titular y $26.75 el adicional, con interés de 25.50%. Tope de 60,000 puntos al año.',
   'Credicorp Bank', 'https://credicorpbank.com/en/tarjeta/visa-clasica-rewards/',
   'product_page', '2026-09-10', '2027-03-10',
   true,
   'El reglamento del propio programa dice otra cosa: «1.25 Puntos Rewards por cada $1.00 de pago en: Gasolineras / Cable-Internet», y 1 punto en el resto. Eso es hasta 2.4 veces menos que lo que anuncia la página. El reglamento es de agosto de 2021.',
   'https://d31tqelrmghhhr.cloudfront.net/2021/08/Reglamento-Credicorp-Rewards-Agosto-2021.pdf'),

  ('credicorp', 'visa', 'platinum', 'Credicorp Rewards', 'credicorp_rewards', 'points',
   'Visa Platinum Rewards',
   'La página del producto dice 3 puntos por dólar en Panamá y en el extranjero; 1 en las demás categorías.',
   'Anualidad $160.50 el titular y $58.85 el adicional, con interés de 21.50%. Sin tope anual de acumulación.',
   'Credicorp Bank', 'https://credicorpbank.com/en/tarjeta/visa-platinum-rewards/',
   'product_page', '2026-09-10', '2027-03-10',
   true,
   'El reglamento del propio programa dice «1.75 Puntos Rewards por cada $1.00 de pago en: Restaurantes / Supermercado / Gasolinera / Cable-Internet», y 1 punto en el resto. Es 1.7 veces menos que lo que anuncia la página. El reglamento es de agosto de 2021.',
   'https://d31tqelrmghhhr.cloudfront.net/2021/08/Reglamento-Credicorp-Rewards-Agosto-2021.pdf'),

  ('credicorp', null, null, 'Credicorp Rewards', 'credicorp_rewards', 'other',
   'Los puntos no vencen, pero se anulan',
   'Por seis meses de inactividad se pierde el 100%, y también al cancelar la tarjeta o por mora.',
   'Sólo se pueden redimir después de seis meses con la tarjeta.',
   'Credicorp Bank', 'https://credicorpbank.com/en/tarjeta/visa-platinum-rewards/',
   'product_page', '2026-09-10', '2027-03-10', false, null, null),

  -- ── Mercantil ──────────────────────────────────────────────────────────────
  ('mercantil', 'mastercard', 'platinum', 'Puntos Mercantil', 'mercantil_puntos', 'points',
   'Mastercard Platinum',
   '1 punto por cada dólar en todas las compras, y cada punto vale $0.01 — un 1% de retorno.',
   'Es el único de estos programas donde la página y el reglamento coinciden, y el único que publica cuánto vale un punto. Anualidad $100 el titular y $20 el adicional, gratis el primer año.',
   'Mercantil Banco', 'https://media.mercantilbanco.com.pa/public-media/pdf/programa_de_lealtad.pdf',
   'product_page', '2026-09-10', '2027-03-10', false, null, null),

  ('mercantil', 'mastercard', 'platinum', 'Puntos Mercantil', 'mercantil_puntos', 'other',
   'Los puntos vencen a los 24 meses',
   'Y se pierden todos tras tres meses sin usar la tarjeta. Mínimo de 5,000 puntos para redimir.',
   'La redención se acredita a la tarjeta y no cubre el pago mínimo. Tope de 180,000 puntos al año.',
   'Mercantil Banco', 'https://media.mercantilbanco.com.pa/public-media/pdf/programa_de_lealtad.pdf',
   'product_page', '2026-09-10', '2027-03-10', false, null, null),

  ('mercantil', 'mastercard', 'platinum', 'Puntos Mercantil', 'mercantil_puntos', 'lounge',
   'Esta tarjeta NO tiene salas VIP',
   'En Mercantil, Priority Pass es de las Visa Signature e Infinite, y LoungeKey de la Mastercard Black. La Platinum no tiene ninguno.',
   'Un invitado a la sala cuesta $35. Se anota lo que no se tiene porque suponerlo es el error que se paga en el aeropuerto.',
   'Mercantil Banco', 'https://media.mercantilbanco.com.pa/public-media/pdf/programa_de_lealtad.pdf',
   'product_page', '2026-09-10', '2027-03-10', false, null, null),

  -- ── Visa, por nivel y con montos ───────────────────────────────────────────
  (null, 'visa', 'platinum', null, null, 'insurance',
   'La Platinum panameña YA NO tiene seguro de alquiler de autos',
   'Visa lo descontinuó para las Gold y Platinum emitidas en Panamá el 1 de octubre de 2021.',
   'Si alguien te dijo que lo tenés, está citando una tabla regional anterior al anexo que lo canceló por país. Sólo Signature e Infinite lo conservan.',
   'Visa · términos del beneficio',
   'https://www.visa.com.ar/content/dam/VCOM/regional/lac/SPA/beneficios/seguro-alquiler-vehiculo-spa-01.pdf',
   'network', '2026-09-10', '2027-03-10', false, null, null),

  (null, 'visa', 'signature', null, null, 'insurance',
   'Seguro de alquiler de vehículo',
   'Cubre robo, colisión, vandalismo e incendio del auto alquilado, sin cargo.',
   'El tope lo fija cada banco emisor: Visa no lo publica. Preguntá el tuyo antes de rechazar la cobertura de la arrendadora.',
   'Visa Panamá', 'https://www.visa.com.pa/es_PA/promociones/seguro-de-alquiler-de-vehiculos/178434',
   'network', '2026-09-10', '2027-03-10', false, null, null),

  (null, 'visa', 'infinite', null, null, 'insurance',
   'Seguro de alquiler de vehículo, hasta 60 días',
   'Cubre hasta 60 días de alquiler e incluye autos costosos o exóticos, contra 31 días del resto.',
   null,
   'Visa · términos del beneficio',
   'https://www.visa.com.ar/content/dam/VCOM/regional/lac/SPA/beneficios/seguro-alquiler-vehiculo-spa-01.pdf',
   'network', '2026-09-10', '2027-03-10', false, null, null),

  (null, 'visa', 'signature', null, null, 'insurance',
   'Seguro de equipaje',
   'Hasta US$1,000 por pérdida y US$500 por retraso.',
   null,
   'Visa · términos del beneficio',
   'https://www.visa.com.ar/content/dam/VCOM/regional/lac/SPA/beneficios/perdida-equipaje-spa-01.pdf',
   'network', '2026-09-10', '2027-03-10', false, null, null),

  (null, 'visa', 'infinite', null, null, 'insurance',
   'Seguro de equipaje',
   'Hasta US$3,000 por pérdida y US$600 por retraso.',
   null,
   'Visa · términos del beneficio',
   'https://www.visa.com.ar/content/dam/VCOM/regional/lac/SPA/beneficios/perdida-equipaje-spa-01.pdf',
   'network', '2026-09-10', '2027-03-10', false, null, null),

  (null, 'visa', null, null, null, 'lounge',
   'Salas VIP por Visa Airport Companion',
   'Infinite, Signature y Platinum. Hay que descargar la app y registrarse: sin eso no hay acceso.',
   'El proveedor es DragonPass, no LoungeKey — Visa Panamá no ofrece LoungeKey. Cuántas visitas gratis tenés lo decide tu banco, no Visa.',
   'Visa Panamá', 'https://www.visa.com.pa/es_PA/promociones/visa-airport-companion/153826',
   'network', '2026-09-10', '2027-03-10', false, null, null),

  (null, 'visa', null, null, null, 'other',
   'Visa Digital Concierge',
   'Infinite, Signature y Platinum. Reservas de restaurantes, viajes y entradas.',
   null,
   'Visa Panamá', 'https://www.visa.com.pa/es_PA/promociones/visa-digital-concierge/157950',
   'network', '2026-09-10', '2027-03-10', false, null, null);

-- Y el programa de Mercantil, que el catálogo de programas no tenía.
insert into platform.card_programs
  (issuer_key, program_key, name, kind, networks, tiers, detail,
   source_name, source_url, captured_on, review_by)
values
  ('mercantil', 'mercantil_puntos', 'Puntos Mercantil', 'points', '{mastercard}', '{}',
   'Un punto por dólar, y cada punto vale un centavo. De los pocos programas del país que publica su valor de canje.',
   'Mercantil Banco', 'https://media.mercantilbanco.com.pa/public-media/pdf/programa_de_lealtad.pdf',
   '2026-09-10', '2027-03-10')
on conflict (issuer_key, program_key) do nothing;
