-- Los programas de lealtad de las tarjetas panameñas, con su procedencia.
--
-- Cada fila sale de una página que el emisor publicó, y lleva la dirección, la
-- fecha en que se leyó y cuándo conviene reconfirmarla. Ninguna se inventa: si
-- un banco no nombra su programa en su propio sitio, aquí no aparece — y esa
-- ausencia es información honesta, no un hueco que rellenar con lo plausible.
--
-- Estas condiciones cambian sin aviso. El barrido mensual vuelve a leer cada
-- dirección y marca la fila cuando la página se movió; lo que no hace es
-- reescribir el dato solo, porque reinterpretar una página y pisar lo que había
-- es exactamente como se cuela una cifra inventada en un producto financiero.

insert into platform.card_programs
  (issuer_key, program_key, name, kind, networks, tiers, detail, source_name, source_url, captured_on, review_by)
values
  ('banco_general', 'estrellas', 'Estrellas', 'points', '{}', '{}',
   'El programa de puntos propio de Banco General. Los puntos se canjean en su catálogo y en comercios afiliados.',
   'Banco General', 'https://www.bgeneral.com/personas/tarjeta-estrellas/', '2026-09-09', '2027-03-09'),

  ('banco_general', 'connectmiles', 'ConnectMiles', 'miles', '{visa}', '{}',
   'La tarjeta co-emitida con el programa de viajero frecuente de Copa Airlines. Acumula millas ConnectMiles, no puntos Estrellas.',
   'Banco General', 'https://www.bgeneral.com/promosbg/connectmiles-y-banco-general-te-brindan-doble-millas-de-bienvenida/', '2026-09-09', '2027-03-09'),

  ('banco_general', 'cashback', 'CashBack', 'cashback', '{visa}', '{}',
   'Devuelve un porcentaje del consumo en dinero en vez de acumular puntos.',
   'Banco General', 'https://www.bgeneral.com/comparador-de-tarjetas-de-credito/', '2026-09-09', '2027-03-09'),

  ('bac', 'connectmiles', 'ConnectMiles', 'miles', '{}', '{}',
   'La co-emisión de BAC con el programa de Copa Airlines.',
   'BAC Credomatic', 'https://www.baccredomatic.com/personas/promociones/connectmiles', '2026-09-09', '2027-03-09'),

  ('bac', 'lifemiles', 'LifeMiles', 'miles', '{visa}', '{infinite}',
   'La co-emisión con el programa de viajero frecuente de Avianca.',
   'BAC Credomatic', 'https://www.baccredomatic.com/es-pa/personas/tarjetas/viajes/lifemiles-infinite/visa/infinite', '2026-09-09', '2027-03-09'),

  ('bac', 'cashback_bac', 'Cashback BAC', 'cashback', '{}', '{}',
   'Devolución en dinero por categoría de comercio en vez de puntos.',
   'BAC Credomatic', 'https://www2.baccredomatic.com/es-pa/tarjetas/credito/personas/cashback', '2026-09-09', '2027-03-09'),

  ('banistmo', 'regalate', 'Regálate', 'points', '{}', '{}',
   'El programa de puntos de Banistmo.',
   'Banistmo', 'https://www.banistmo.com/personas/tarjetas-credito', '2026-09-09', '2027-03-09'),

  ('banesco', 'connectmiles', 'ConnectMiles', 'miles', '{visa}', '{platinum,infinite}',
   'La co-emisión de Banesco con el programa de Copa Airlines.',
   'Banesco Panamá', 'https://www.banesco.com.pa/tarjetas/visa-infinite-connectmiles/', '2026-09-09', '2027-03-09'),

  ('global_bank', 'link_points', 'Link Points', 'points', '{}', '{}',
   'El programa de puntos de Global Bank.',
   'Global Bank', 'https://www.globalbank.com.pa/banca-personal/tarjetas-de-credito/beneficios', '2026-09-09', '2027-03-09'),

  ('scotiabank', 'mas_premios', '+Premios', 'points', '{visa}', '{signature}',
   'El programa de puntos de Scotiabank Panamá, hoy Davivienda. Los puntos no vencen según la fuente leída.',
   'Scotiabank Panamá (Davivienda)', 'https://www.davibank.pa/es/banca-personal/tarjetas-de-credito/scotiabank-visa-signature-premios.html', '2026-09-10', '2027-03-10'),

  ('credicorp', 'credicorp_rewards', 'Credicorp Rewards', 'points', '{}', '{}',
   'El programa de puntos de Credicorp Bank, canjeables en su catálogo.',
   'Credicorp Bank', 'https://www.credicorpbank.com/en/beneficios/credicorp-bank/', '2026-09-10', '2027-03-10')

on conflict (issuer_key, program_key) do update set
  name = excluded.name,
  kind = excluded.kind,
  networks = excluded.networks,
  tiers = excluded.tiers,
  detail = excluded.detail,
  source_name = excluded.source_name,
  source_url = excluded.source_url,
  captured_on = excluded.captured_on,
  review_by = excluded.review_by,
  updated_at = now();
