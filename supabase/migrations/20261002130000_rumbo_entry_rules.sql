-- Rumbo: las primeras reglas de entrada, verificadas en su fuente oficial el
-- 2026-10-02. Cada fila dice de dónde salió; con más de 30 días la pantalla la
-- muestra «por verificar» y el cron semanal pide revisarla.
--
-- - Türkiye: Cancillería de Türkiye (mfa.gov.tr), «Visa information for
--   foreigners». Colombia: exentos hasta 90 días (la página no menciona
--   ventana). Panamá: exentos hasta 90 días en 180 desde la primera entrada.
--   Pasaporte: se recomienda vigencia de 6 meses desde la llegada; la ley pide
--   60 días más allá de la estadía.
-- - Schengen: Panamá, Embajada de Italia en Panamá (90 días en 180). Colombia,
--   acuerdo UE–Colombia de exención de visados de corta duración (90 en 180),
--   Parlamento Europeo. Pasaporte: 3 meses después de la salida y emitido hace
--   menos de 10 años (Código de Fronteras Schengen, art. 6).
-- - EES: en operación desde el 12 de octubre de 2025.
-- - ETIAS: sin fecha confirmada a octubre de 2026; queda nula y editable.

insert into platform.entry_rules
  (passport_country, zone, status, max_stay_days, window_days, conditions, source_name, source_url, checked_on)
values
  ('CO', 'TR', 'visa_free', 90, null,
   '{"passportValidMonthsFromArrival": 6, "passportValidDaysAfterExit": 60, "mayAsk": ["onward_ticket", "lodging_proof", "funds"]}',
   'Cancillería de Türkiye — Visa information for foreigners',
   'https://www.mfa.gov.tr/visa-information-for-foreigners.en.mfa', '2026-10-02'),
  ('PA', 'TR', 'visa_free', 90, 180,
   '{"passportValidMonthsFromArrival": 6, "passportValidDaysAfterExit": 60, "mayAsk": ["onward_ticket", "lodging_proof", "funds"]}',
   'Cancillería de Türkiye — Visa information for foreigners',
   'https://www.mfa.gov.tr/visa-information-for-foreigners.en.mfa', '2026-10-02'),
  ('PA', 'schengen', 'visa_free', 90, 180,
   '{"passportValidMonthsAfterExit": 3, "passportIssuedWithinYears": 10, "mayAsk": ["onward_ticket", "lodging_proof", "funds", "insurance"]}',
   'Embajada de Italia en Panamá — Visado de turismo',
   'https://ambpanama.esteri.it/en/servizi-consolari-e-visti/servizi-per-il-cittadino-straniero/visti/visa-de-turismo-visita-familiar/',
   '2026-10-02'),
  ('CO', 'schengen', 'visa_free', 90, 180,
   '{"passportValidMonthsAfterExit": 3, "passportIssuedWithinYears": 10, "mayAsk": ["onward_ticket", "lodging_proof", "funds", "insurance"]}',
   'Parlamento Europeo — Acuerdo UE–Colombia de exención de visados de corta duración',
   'https://oeil.europarl.europa.eu/oeil/en/document-summary?id=1402185', '2026-10-02')
on conflict do nothing;

insert into platform.border_systems (id, zone, starts_on, exempt, source_name, source_url, checked_on) values
  ('ees', 'schengen', '2025-10-12', '{}', 'Unión Europea — Entry/Exit System', 'https://travel-europe.europa.eu/ees_en', '2026-10-02'),
  ('etias', 'schengen', null, '{}', 'Unión Europea — ETIAS', 'https://travel-europe.europa.eu/etias_en', '2026-10-02')
on conflict (id) do nothing;
