-- Los beneficios de las tarjetas de Panamá, con su fuente y su fecha.
--
-- ## Por qué esto no existía, y qué cambió
--
-- La objeción era real: los beneficios cambian por nivel de tarjeta, por
-- promoción y por mes, son términos contractuales, y una tabla desactualizada
-- dentro de una aplicación financiera le dice a alguien que tiene un seguro que
-- no tiene. Eso sigue siendo cierto.
--
-- Lo que estaba mal era la conclusión. No publicar nada deja a la casa
-- buscando en ocho sitios web cuál de sus tres tarjetas conviene usar en el
-- supermercado, que es exactamente el trabajo que un producto de finanzas debe
-- quitar. La respuesta no es callar: es **publicar con procedencia**.
--
-- Cada fila lleva de dónde salió (`source_url`), **cuándo se leyó**
-- (`captured_on`), hasta cuándo la fuente dijo que valía (`valid_until`, nulo
-- cuando no lo dice) y cuándo conviene reconfirmarla (`review_by`). La pantalla
-- enseña las cuatro cosas y no deja tocar nada sin que la persona lo confirme
-- contra su propio contrato: el catálogo **sugiere**, el contrato **manda**.
--
-- ## Por qué vive en `platform` y no en `app`
--
-- Es dato de referencia, como las monedas y las jurisdicciones fiscales: dice
-- lo que un banco publicó, nunca lo que alguien tiene. Ninguna fila pertenece a
-- ningún hogar, y por eso se lee sin seguridad de fila y se escribe sólo por
-- migración.
--
-- ## Qué NO es
--
-- No es asesoría, no es exhaustivo, y no reemplaza al contrato. Un beneficio de
-- aquí no entra a la cartera de nadie solo: la persona lo adopta, y al hacerlo
-- se copia a `app.card_benefits` con la fuente pegada.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'card_tier') then
    create type app.card_tier as enum (
      'classic', 'gold', 'platinum', 'signature', 'infinite', 'black', 'other'
    );
  end if;
end
$$;

-- El nivel decide la mitad de los beneficios: una Infinite y una Classic del
-- mismo banco no tienen el mismo seguro ni la misma cobertura de fraude.
alter table app.accounts
  add column if not exists card_tier app.card_tier;

alter table app.accounts
  drop constraint if exists accounts_tier_only_on_cards;
alter table app.accounts
  add constraint accounts_tier_only_on_cards
  check (card_tier is null or account_type = 'credit_card');

comment on column app.accounts.card_tier is
  'Classic, Gold, Platinum, Signature, Infinite, Black. Half of what a card gives depends on this: an Infinite and a Classic from the same bank share neither insurance nor fraud cover.';

create table if not exists platform.card_benefit_catalogue (
  id           uuid primary key default public.uuid_generate_v7(),

  -- A quién aplica. Nulo en cualquiera de los tres significa «a todas»: un
  -- beneficio de la red Visa Infinite aplica lo emita quien lo emita.
  issuer_key   text,
  network      text check (network is null or network in ('visa', 'mastercard', 'amex')),
  tier         text check (tier is null or tier in (
                 'classic', 'gold', 'platinum', 'signature', 'infinite', 'black', 'other'
               )),

  -- El programa con nombre propio, cuando lo tiene: Estrellas, ConnectMiles,
  -- LifeMiles, Regálate, Link Points.
  program      text,

  kind         text not null check (kind in (
                 'cashback', 'miles', 'points', 'insurance', 'lounge',
                 'discount', 'waiver', 'fee', 'other'
               )),
  label        text not null,
  value        text,

  /**
   * La procedencia, que es lo que separa esto de una lista inventada.
   *
   * `source_url` es dónde se leyó. `captured_on` es **cuándo**, y es el dato
   * que la pantalla enseña más grande: una condición de tarjeta leída hace ocho
   * meses es una pista, no un hecho. `valid_until` sólo se llena cuando la
   * fuente dio una fecha; inventarla sería exactamente el problema que este
   * diseño evita.
   *
   * `review_by` no lo dice el banco: lo dice este producto. Es la fecha a
   * partir de la cual conviene reconfirmar, y la pantalla lo etiqueta como
   * sugerencia de Cifraapp y no como término del emisor.
   */
  source_name  text not null,
  source_url   text not null,
  captured_on  date not null,
  valid_until  date,
  review_by    date,

  notes        text,
  created_at   timestamptz not null default now()
);

comment on table platform.card_benefit_catalogue is
  'What Panamanian issuers published about their cards, with where it was read and when. Reference data: it says what a bank published, never what anybody holds. The catalogue suggests; the cardholder contract decides.';
comment on column platform.card_benefit_catalogue.captured_on is
  'When this was read from the source. The figure the screen shows most prominently: a card condition read eight months ago is a lead, not a fact.';
comment on column platform.card_benefit_catalogue.valid_until is
  'Only filled when the source stated an end date. Inventing one would be exactly the problem this design avoids.';
comment on column platform.card_benefit_catalogue.review_by is
  'Cifraapp''s own suggestion of when to reconfirm, not a term stated by the issuer. Labelled as such on screen.';

create index if not exists card_benefit_catalogue_lookup_idx
  on platform.card_benefit_catalogue (issuer_key, network, tier);

-- Referencia compartida: se lee sin seguridad de fila porque no pertenece a
-- ningún hogar, y se escribe sólo por migración.
grant select on platform.card_benefit_catalogue to authenticated, anon;
