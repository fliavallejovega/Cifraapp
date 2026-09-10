-- El programa con nombre propio de una tarjeta.
--
-- Una tarjeta no se distingue sólo por su red y su nivel. Dos Visa Platinum del
-- mismo banco pueden acumular ConnectMiles una y Estrellas la otra, y eso
-- cambia qué promoción le sirve a cada una: «doble millas ConnectMiles este
-- mes» no le sirve a la de Estrellas aunque compartan banco, red y nivel.
--
-- Sin este dato el sistema tenía que enseñarle a la casa promociones que quizá
-- no puede usar, o esconder promociones que sí. Las dos opciones son peores que
-- preguntarlo una vez.
--
-- ## Por qué un catálogo y no un campo de texto libre
--
-- Para poder cruzarlo. «ConnectMiles», «Connect Miles» y «connectmiles» escritos
-- a mano son tres cosas distintas para una consulta y la misma para una persona.
-- La llave estable es lo que permite que una promoción diga «esto es para
-- ConnectMiles» y el sistema sepa a qué tarjetas alcanza.
--
-- ## Por qué cada programa cuelga de un emisor
--
-- Porque ConnectMiles es de Copa, no de un banco, y cinco bancos panameños lo
-- co-emiten con condiciones propias. La fila «bac + connectmiles» y la fila
-- «banco_general + connectmiles» son dos productos distintos con la misma
-- moneda de lealtad, y cada una lleva su propia fuente.

create table if not exists platform.card_programs (
  id uuid primary key default public.uuid_generate_v7(),
  issuer_key text not null,
  program_key text not null,
  name text not null,
  -- 'miles' | 'points' | 'cashback' | 'discounts' | 'other'
  kind text not null,
  -- Vacío significa «en todas»: un programa que no distingue red aplica a todas
  -- las que ese banco emite. Es lo que dice un programa que no lo aclara.
  networks text[] not null default '{}',
  tiers text[] not null default '{}',
  detail text,
  source_name text not null,
  source_url text not null,
  -- Cuándo se leyó. Sin esto, «el programa da 2x» es una afirmación sin fecha.
  captured_on date not null,
  valid_until date,
  review_by date,
  status text not null default 'verified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_programs_kind_check
    check (kind in ('miles', 'points', 'cashback', 'discounts', 'other')),
  constraint card_programs_status_check
    check (status in ('verified', 'unverified', 'expired')),
  constraint card_programs_unique unique (issuer_key, program_key)
);

create index if not exists card_programs_issuer_idx
  on platform.card_programs (issuer_key);

-- El programa que la casa declaró para esta tarjeta.
--
-- Nulo es «nadie lo dijo», que no es «no tiene». La diferencia importa: sin
-- programa declarado se enseñan las promociones que no lo exigen, y se dice que
-- podrían faltar las que sí.
alter table app.accounts
  add column if not exists card_program text;

comment on column app.accounts.card_program is
  'La llave del programa de lealtad declarado (platform.card_programs.program_key). Nulo es «nadie lo dijo», no «no tiene».';

-- Y del otro lado: una promoción que sólo aplica a un programa.
--
-- Vacío significa «a todas las del banco», que es lo que dice una promoción que
-- no nombra programa. Es el mismo criterio que ya usan networks y tiers.
alter table platform.card_promotions
  add column if not exists programs text[] not null default '{}';

comment on column platform.card_promotions.programs is
  'Llaves de programa a las que aplica. Vacío es «a todas las del emisor», que es lo que dice una promoción que no nombra programa.';
