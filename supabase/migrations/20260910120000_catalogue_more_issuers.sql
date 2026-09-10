-- El resto de los emisores, leídos el 10 de septiembre de 2026.
--
-- Igual que la primera tanda: cada línea con su dirección y su fecha de
-- lectura, nada completado de memoria, y `valid_until` vacío salvo que la
-- fuente diera una fecha.
--
-- La tanda de ACODECO merece una nota. Son las tasas y anualidades **más bajas
-- del mercado** por segmento según su informe de mayo de 2026 — no las de una
-- tarjeta concreta, sino el suelo contra el que se compara cualquiera. Se
-- guardan con `issuer_key` nulo y `kind = 'fee'` o `'other'` porque describen el
-- mercado, no un producto, y la pantalla las enseña como referencia y no como
-- un beneficio de la tarjeta de nadie.

insert into platform.card_benefit_catalogue
  (issuer_key, network, tier, card_product, program, kind, label, value,
   source_name, source_url, captured_on, review_by, notes)
values
-- ── Scotiabank / Davivienda ────────────────────────────────────────────────
('scotiabank', 'visa', 'signature', 'Visa Signature +Premios', '+Premios', 'points',
 'Acumulación +Premios',
 '3 puntos por US$1 en hoteles, alquiler de autos, boletos aéreos y agencias de viaje; 2 puntos por US$1 en restaurantes y compras en el exterior; 1 punto por US$1 en el resto.',
 'Scotiabank Panamá (Davivienda)', 'https://www.davibank.pa/es/banca-personal/tarjetas-de-credito/scotiabank-visa-signature-premios.html',
 '2026-09-10', '2027-03-10',
 'Scotiabank Panamá quedó integrado con Davivienda, que mantiene licencia temporal de la marca. La página vive en davibank.pa.'),

('scotiabank', 'visa', 'signature', 'Visa Signature +Premios', '+Premios', 'other',
 'Los puntos no vencen', 'Mientras la tarjeta siga activa con compras.',
 'Scotiabank Panamá (Davivienda)', 'https://www.davibank.pa/es/banca-personal/tarjetas-de-credito/scotiabank-visa-signature-premios.html',
 '2026-09-10', '2027-03-10', null),

('scotiabank', 'visa', 'signature', 'Visa Signature +Premios', null, 'waiver',
 'Membresía del primer año', 'Gratis el primer año.',
 'Scotiabank Panamá (Davivienda)', 'https://www.davibank.pa/es/banca-personal/tarjetas-de-credito/scotiabank-visa-signature-premios.html',
 '2026-09-10', '2027-03-10', null),

-- ── Credicorp Bank ─────────────────────────────────────────────────────────
('credicorp', 'visa', 'classic', 'Visa Clásica Rewards', 'Credicorp Rewards', 'points',
 'Bono de bienvenida', '2,000 puntos Rewards con la primera compra.',
 'Credicorp Bank', 'https://credicorpbank.com/en/tarjeta/visa-clasica-rewards/', '2026-09-10', '2027-03-10', null),

('credicorp', 'visa', 'classic', 'Visa Clásica Rewards', 'Credicorp Rewards', 'points',
 'Acumulación acelerada',
 '3 puntos por US$1 en supermercados, restaurantes, farmacias, cable, telefonía, seguros, educación, peajes, clubes, taxis y limusinas, en Panamá y en el exterior.',
 'Credicorp Bank', 'https://credicorpbank.com/en/tarjeta/visa-clasica-rewards/', '2026-09-10', '2027-03-10', null),

('credicorp', 'visa', 'platinum', 'Visa Platinum Rewards', 'Credicorp Rewards', 'points',
 'Bono de bienvenida', '10,000 puntos Rewards con la primera compra.',
 'Credicorp Bank', 'https://credicorpbank.com/en/tarjeta/visa-platinum-rewards/', '2026-09-10', '2027-03-10', null),

('credicorp', 'visa', 'platinum', 'Visa Platinum Rewards', 'Credicorp Rewards', 'points',
 'Acumulación', '3 puntos por US$1 de compra en Panamá y en el exterior.',
 'Credicorp Bank', 'https://credicorpbank.com/en/tarjeta/visa-platinum-rewards/', '2026-09-10', '2027-03-10', null),

('credicorp', null, null, null, 'Credicorp Rewards', 'points',
 'Canje de puntos',
 'Viajes, boletos aéreos, cruceros, crédito a la tarjeta o transferencia a cuenta, tarjetas de regalo y Multishopping.',
 'Credicorp Bank', 'https://www.credicorpbank.com/en/beneficios/credicorp-bank/', '2026-09-10', '2027-03-10',
 'El reglamento del programa está publicado aparte; conviene leerlo antes de contar con un canje concreto.'),

-- ── Mercantil Banco ────────────────────────────────────────────────────────
('mercantil', 'mastercard', 'platinum', 'Mastercard Platinum', null, 'points',
 'Puntos canjeables por efectivo',
 'Acumula puntos por cada dólar de compra nacional e internacional, canjeables como crédito a la tarjeta.',
 'Mercantil Banco Panamá', 'https://mercantilbanco.com.pa/personas/tarjetas/mastercard-platinum', '2026-09-10', '2027-03-10', null),

('mercantil', 'mastercard', 'platinum', 'Mastercard Platinum', null, 'insurance',
 'Asistencia de viaje Mastercard', 'Servicio de asistencia en viaje.',
 'Mercantil Banco Panamá', 'https://mercantilbanco.com.pa/personas/tarjetas/mastercard-platinum', '2026-09-10', '2027-03-10', null),

-- ── ACODECO: el suelo del mercado, por segmento ────────────────────────────
(null, null, 'classic', null, null, 'fee',
 'Anualidad más baja del mercado · Clásica',
 'B/.0.00 en Banco General, Credicorp Bank, BAC International Bank y EDIOACC, R.L.',
 'ACODECO · informe de mayo de 2026', 'https://www.acodeco.gob.pa/inicio/tarjetas-credito/', '2026-09-10', '2026-12-10',
 'Referencia de mercado, no un beneficio de tu tarjeta. ACODECO republica el estudio periódicamente; el barrido mensual avisa cuando sale uno nuevo.'),

(null, null, 'gold', null, null, 'fee',
 'Anualidad más baja del mercado · Dorada',
 'B/.0.00 en EDIOACC, R.L., Credicorp Bank y Banistmo. La más baja entre las grandes: US$75 en Banco General.',
 'ACODECO · informe de mayo de 2026', 'https://www.acodeco.gob.pa/inicio/tarjetas-credito/', '2026-09-10', '2026-12-10', null),

(null, null, 'platinum', null, null, 'fee',
 'Anualidad más baja del mercado · Platino',
 'US$84 en Davivienda (Panamá).',
 'ACODECO · informe de mayo de 2026', 'https://www.acodeco.gob.pa/inicio/tarjetas-credito/', '2026-09-10', '2026-12-10', null),

(null, null, 'classic', null, null, 'other',
 'Tasa más baja del mercado · Clásica', '15% en Coopeve, R.L.',
 'ACODECO · informe de mayo de 2026', 'https://www.acodeco.gob.pa/inicio/tarjetas-credito/', '2026-09-10', '2026-12-10',
 'Tasa de interés nominal anual. Si la tuya está muy por encima, es la conversación que conviene tener con tu banco.'),

(null, null, 'gold', null, null, 'other',
 'Tasa más baja del mercado · Dorada', '13% en EDIOACC, R.L.',
 'ACODECO · informe de mayo de 2026', 'https://www.acodeco.gob.pa/inicio/tarjetas-credito/', '2026-09-10', '2026-12-10', null),

(null, null, 'platinum', null, null, 'other',
 'Tasa más baja del mercado · Platino', '12% en Banco de Occidente, Panamá.',
 'ACODECO · informe de mayo de 2026', 'https://www.acodeco.gob.pa/inicio/tarjetas-credito/', '2026-09-10', '2026-12-10', null);

-- Atar también estas filas a su fuente.
update platform.card_benefit_catalogue c
   set source_id = s.id
  from platform.catalogue_sources s
 where c.source_url = s.url
   and c.source_id is null;
