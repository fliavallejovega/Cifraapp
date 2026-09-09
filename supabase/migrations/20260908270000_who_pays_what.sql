-- De qué sueldo sale un pago, que no es lo mismo que un descuento en planilla.
--
-- La columna `deducted_from_series_id` cargaba dos ideas y solo servía para
-- una. «Se descuenta antes de que cobres» es un hecho sobre el dinero: nunca
-- llega, así que no reclama tu saldo. «Sale del sueldo de Blei» es un hecho
-- sobre el hogar: el dinero sí llega, sí reclama el saldo, y aun así importa
-- saber de quién sale para poder ordenarse. Un hogar puede pagar el alquiler
-- del sueldo de uno sin que nadie lo descuente de ninguna planilla, y hasta
-- ahora decir eso obligaba a mentir en la otra mitad.
--
-- Así que se separan. `paid_from_series_id` responde de quién sale;
-- `is_deducted_at_source` responde si llega o no llega. Un descuento en
-- planilla es las dos cosas a la vez, que es exactamente lo que estaba
-- guardado, y por eso el respaldo es una copia y no una interpretación.
--
-- Y los montos por quincena, porque una quincena no siempre paga lo mismo que
-- la otra: `anchor_amounts` corre en paralelo a `anchor_days`, posición por
-- posición. Nulo significa «lo mismo las dos veces», que es el caso corriente
-- y el que ya estaba guardado.

alter table app.obligations
  add column if not exists paid_from_series_id uuid
    references app.recurring_series (id) on delete set null,
  add column if not exists is_deducted_at_source boolean not null default false,
  add column if not exists anchor_amounts numeric(19, 4)[];

-- El respaldo. Lo que estaba en la columna vieja era las dos cosas a la vez,
-- así que va entero a las dos: nada se interpreta y nada se pierde.
update app.obligations
   set paid_from_series_id = deducted_from_series_id,
       is_deducted_at_source = true
 where deducted_from_series_id is not null;

comment on column app.obligations.paid_from_series_id is
  'The income this payment comes out of. Says nothing about whether it is deducted before that income arrives — see is_deducted_at_source.';
comment on column app.obligations.is_deducted_at_source is
  'True when the money never reaches an account: it is taken from the payslip. Such an obligation is owed and shown, but is not a claim on any balance.';
comment on column app.obligations.anchor_amounts is
  'One amount per anchor day, in the same order. Null means the same amount every time.';

-- Un monto por cada día, o ninguno. Una lista más corta que la otra es un pago
-- que nadie puede calcular, y prefiero que la base lo rechace a que una
-- pantalla elija en silencio cuál de los dos días se queda sin monto.
alter table app.obligations
  drop constraint if exists obligations_anchor_amounts_match;

alter table app.obligations
  add constraint obligations_anchor_amounts_match
  check (
    anchor_amounts is null
    or (anchor_days is not null and array_length(anchor_amounts, 1) = array_length(anchor_days, 1))
  );

create index if not exists obligations_paid_from_idx
  on app.obligations (paid_from_series_id)
  where paid_from_series_id is not null;

-- La columna vieja se va: su contenido está copiado entero arriba, y dejarla
-- viva sería dejar dos respuestas a la misma pregunta esperando divergir.
alter table app.obligations
  drop column if exists deducted_from_series_id;
