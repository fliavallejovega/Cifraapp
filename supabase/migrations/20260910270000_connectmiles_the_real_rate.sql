-- La tasa real de la Visa ConnectMiles de Banco General.
--
-- El catálogo decía «Una milla ConnectMiles por cada US$3.00 de compra». La
-- página del producto —https://www.bgeneral.com/tarjetas-de-credito/visa-connectmiles/—
-- dice, textual:
--
--   «Platinum 2 millas por cada dólar de compra en Copa Airlines.»
--   «1 milla por cada dólar de compra en otros comercios.»
--   «En el caso del pago de impuestos y multas realizados a favor del Gobierno
--    de la República de Panamá será 1 milla por cada $3.»
--
-- El «$3» existe. Es la excepción para impuestos y multas, y yo la tomé por la
-- regla general. Una casa mirando esa fila creía que su tarjeta rinde un tercio
-- de lo que rinde — y decidía con cuál pagar en base a eso.
--
-- La fuente citada era una página de promoción de «doble millas de bienvenida».
-- Una promoción describe una promoción. No es autoridad sobre lo que la tarjeta
-- da todos los días.

delete from platform.card_benefit_catalogue
where issuer_key = 'banco_general' and program_key = 'connectmiles';

insert into platform.card_benefit_catalogue
  (issuer_key, network, tier, program, program_key, kind, label, value, notes,
   source_name, source_url, source_kind, captured_on, review_by)
values
  -- Platinum, que es el nivel que la casa tiene.
  ('banco_general', 'visa', 'platinum', 'ConnectMiles', 'connectmiles', 'miles',
   'Visa ConnectMiles Platinum',
   '1 milla por cada dólar de compra en comercios, y 2 millas por cada dólar en Copa Airlines.',
   'En impuestos y multas al Gobierno de Panamá la tasa baja a 1 milla por cada $3. Las millas premio vencen a los 2 años sin actividad en la cuenta; una compra con la tarjeta cuenta como actividad.',
   'Banco General', 'https://www.bgeneral.com/tarjetas-de-credito/visa-connectmiles/',
   'product_page', '2026-09-10', '2027-03-10'),

  ('banco_general', 'visa', 'signature', 'ConnectMiles', 'connectmiles', 'miles',
   'Visa ConnectMiles Signature',
   '1 milla por cada dólar en comercios, 2 en gasolineras y supermercados, y 3 en Copa Airlines.',
   'En impuestos y multas al Gobierno de Panamá la tasa baja a 1 milla por cada $3. Las millas premio vencen a los 2 años sin actividad en la cuenta.',
   'Banco General', 'https://www.bgeneral.com/tarjetas-de-credito/visa-connectmiles/',
   'product_page', '2026-09-10', '2027-03-10'),

  -- El descuento en redención, que aplica a los dos niveles.
  ('banco_general', 'visa', null, 'ConnectMiles', 'connectmiles', 'discount',
   '10% de descuento al redimir millas',
   'Signature y Platinum. No aplica a boletos pagados con millas ni Miles & Cash.',
   null,
   'Banco General', 'https://www.bgeneral.com/tarjetas-de-credito/visa-connectmiles/',
   'product_page', '2026-09-10', '2027-03-10'),

  -- Y las millas de bienvenida, que sí son una promoción y se citan como tal.
  ('banco_general', 'visa', 'platinum', 'ConnectMiles', 'connectmiles', 'miles',
   'Millas de bienvenida Platinum',
   '10,000 millas por compras y/o retiros en efectivo de US$6,000 o más.',
   'Dentro de los 3 primeros meses tras activar la tarjeta y dentro de la vigencia de la promoción. Se reflejan al cuarto mes. Confirmá la vigencia antes de contar con ellas.',
   'Banco General', 'https://www.bgeneral.com/tarjetas-de-credito/visa-connectmiles/',
   'product_page', '2026-09-10', '2026-12-10'),

  ('banco_general', 'visa', 'signature', 'ConnectMiles', 'connectmiles', 'miles',
   'Millas de bienvenida Signature',
   '15,000 millas por compras y/o retiros en efectivo de US$12,000 o más.',
   'Dentro de los 3 primeros meses tras activar la tarjeta. Se reflejan al cuarto mes. Confirmá la vigencia antes de contar con ellas.',
   'Banco General', 'https://www.bgeneral.com/tarjetas-de-credito/visa-connectmiles/',
   'product_page', '2026-09-10', '2026-12-10');

-- La cobertura de fraude por nivel, también de la página del producto y no del
-- comparador: la página distingue tres tramos y el comparador uno solo.
update platform.card_benefit_catalogue
set value = 'Hasta US$25,000 en Platinum. US$15,000 en Classic, Gold y Standard; US$40,000 en Signature, Black e Infinite.',
    source_url = 'https://www.bgeneral.com/tarjetas-de-credito/visa-connectmiles/',
    source_kind = 'product_page',
    captured_on = '2026-09-10'
where issuer_key = 'banco_general' and kind = 'insurance' and label ilike '%fraude%';

-- El bono de BAC salía de una URL que ya no resuelve. No se corrige a ciegas: se
-- borra. Una fila cuya fuente no se puede abrir no se puede comprobar, y una
-- cifra incomprobable sobre plata no vale más que ninguna.
delete from platform.card_benefit_catalogue
where source_url = 'https://www.baccredomatic.com/personas/promociones/connectmiles';
