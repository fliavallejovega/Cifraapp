-- Apartar el impuesto en el momento del cobro, y no en marzo.
--
-- A un asalariado le retienen. A un independiente no le retiene nadie: cobra el
-- 100% de la factura, la gasta, y descubre en la declaración que una parte de
-- ese dinero nunca fue suyo. No es un problema de disciplina — es un problema de
-- diseño, porque el único momento en que apartar el impuesto es indoloro es el
-- momento exacto en que la plata entra.
--
-- ## Qué se guarda y por qué así
--
-- El porcentaje ya existía: `household_settings.tax_reserve_rate`, que la casa
-- fija en Ajustes y que la pantalla de reserva ya enseñaba. No se añade otro. Un
-- segundo porcentaje en el perfil fiscal serían dos fuentes de verdad para la
-- misma cifra, y la pregunta «¿cuál manda?» no tiene buena respuesta el día que
-- difieren. Lo que faltaba no era el número: era aplicarlo en el momento del
-- cobro en vez de estimarlo sobre el saldo.
--
-- Y no sale de las reglas de Panamá cargadas en `platform.tax_rule_sets`: son un
-- borrador sin revisar, y calcular una reserva con ellas sería exactamente lo
-- que `CLAUDE.md` prohíbe — una cifra fiscal que nadie con credenciales validó,
-- presentada como si lo estuviera. Dónde se guarda la reserva tampoco necesita
-- columna: las cuentas de tipo `tax_reserve` ya lo dicen.
--
-- `tax_reserved` en el cobro: lo que se apartó de **este** cobro, congelado en
-- el momento de cobrarlo. No se recalcula: si la casa sube la tasa en junio, lo
-- reservado en marzo siguió siendo lo que se reservó en marzo. Un porcentaje que
-- se aplica hacia atrás reescribe la historia del hogar.
--
-- La suma de lo reservado y no liberado es lo que el plan deduce como reserva
-- fiscal, reemplazando el «un porcentaje del saldo líquido» que había — que era
-- una aproximación sin fecha ni origen, y que subía cuando la casa cobraba
-- aunque el cobro fuera de algo no gravado.

alter table app.receivables
  add column if not exists tax_reserved      numeric(19, 4) not null default 0,
  add column if not exists tax_reserved_rate numeric(5, 2),
  -- Liberado cuando el impuesto se pagó de verdad. Hasta entonces la reserva
  -- sigue siendo una deducción viva del disponible para gastar.
  add column if not exists tax_released_on   date;

alter table app.receivables
  drop constraint if exists receivables_reserve_not_negative;
alter table app.receivables
  add constraint receivables_reserve_not_negative
  check (tax_reserved >= 0);

-- No se puede reservar más de lo que entró. Un redondeo que produjera lo
-- contrario dejaría un cobro con disponible negativo por su propia reserva.
alter table app.receivables
  drop constraint if exists receivables_reserve_within_amount;
alter table app.receivables
  add constraint receivables_reserve_within_amount
  check (tax_reserved <= amount);

-- Y no se reserva sobre lo que todavía no se cobró: apartar el impuesto de una
-- expectativa es apartar dinero que no está.
alter table app.receivables
  drop constraint if exists receivables_reserve_needs_receipt;
alter table app.receivables
  add constraint receivables_reserve_needs_receipt
  check (tax_reserved = 0 or received_on is not null);

comment on column app.receivables.tax_reserved is
  'What was set aside for tax the moment this was received. Frozen: raising the rate in June does not change what March reserved.';
comment on column app.receivables.tax_reserved_rate is
  'The rate that produced it, so the figure stays explainable after the setting moves.';
comment on column app.receivables.tax_released_on is
  'When the reserve stopped being a claim, because the tax was paid. Null means it is still deducted from what the household can spend.';

-- Lo que el plan lee cada vez que calcula el disponible: lo reservado y todavía
-- no liberado, por hogar.
create index if not exists receivables_reserve_live_idx
  on app.receivables (household_id)
  where tax_reserved > 0 and tax_released_on is null and deleted_at is null;
