-- Las fuentes del catálogo, y el barrido que cada mes vuelve a mirarlas.
--
-- ## El problema que resuelve
--
-- Un catálogo de condiciones bancarias envejece solo. Una tarjeta que daba 3%
-- en supermercados el año pasado puede dar 1% hoy, y el producto no tiene forma
-- de enterarse: nadie le avisa cuando un banco reescribe su página.
--
-- La solución honesta no es prometer que el catálogo está siempre al día —eso
-- exigiría releer y reinterpretar veinte sitios cada mes, que ningún trabajo
-- desatendido hace bien. Es más modesta y sirve más: **volver a mirar cada
-- fuente y decir cuál se movió**.
--
-- Cada mes el barrido descarga cada dirección, le saca una huella al contenido
-- y la compara con la guardada. Si cambió, las filas que salieron de ahí quedan
-- marcadas como **por revisar** y la pantalla lo dice al lado de cada una. El
-- dato no se toca: reinterpretar una página automáticamente es exactamente cómo
-- se mete una cifra inventada en un producto financiero.
--
-- ## Lo que esto sí garantiza
--
-- Que ninguna línea se presente como fresca cuando su fuente cambió, y que
-- exista una lista corta y accionable de qué reconfirmar este mes. Eso es
-- comprobable y se cumple sin intervención.
--
-- ## Lo que no garantiza
--
-- Que los datos nuevos entren solos. Reinterpretarlos es trabajo de juicio, y
-- queda registrado como pendiente en vez de fingirse hecho.

create table if not exists platform.catalogue_sources (
  id            uuid primary key default public.uuid_generate_v7(),

  -- Cómo se llama la fuente en pantalla, y a quién pertenece.
  name          text not null,
  url           text not null unique,
  issuer_key    text,
  /**
   * Qué clase de fuente es.
   *
   * `issuer` es la página del propio banco. `regulator` es ACODECO, que publica
   * un estudio comparativo periódico de tasas y anualidades — la única fuente
   * de este catálogo que es a la vez oficial, transversal a todos los bancos y
   * republicada con calendario. `network` es Visa o Mastercard. `third_party`
   * es un comparador independiente, y se marca así para que se lea con la
   * desconfianza que corresponde.
   */
  kind          text not null check (kind in ('issuer', 'regulator', 'network', 'third_party')),

  -- La huella del contenido la última vez que se leyó, y cuándo fue.
  content_hash  text,
  fetched_at    timestamptz,
  -- El resultado del último intento: una fuente que lleva tres meses caída es
  -- un dato sobre el catálogo, no un silencio.
  last_status   text check (last_status in ('ok', 'changed', 'unreachable', 'never')),
  last_error    text,

  -- Verdadero desde que su contenido cambió hasta que alguien reconfirma las
  -- filas que salieron de ella.
  needs_review  boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table platform.catalogue_sources is
  'The pages the card catalogue was read from, re-fetched monthly. The sweep compares a content hash and flags what moved; it never reinterprets a page, because doing that unattended is how an invented figure gets into a financial product.';

create trigger set_updated_at before update on platform.catalogue_sources
  for each row execute function public.set_updated_at();

/**
 * Cada barrido, con lo que encontró.
 *
 * Sin esto, «el catálogo se actualiza cada mes» sería una afirmación que nadie
 * puede comprobar. Con esto, la pantalla puede decir cuándo corrió por última
 * vez y cuántas fuentes se movieron.
 */
create table if not exists platform.catalogue_refresh_runs (
  id            uuid primary key default public.uuid_generate_v7(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  sources_checked integer not null default 0,
  sources_changed integer not null default 0,
  sources_failed  integer not null default 0,
  notes         text
);

comment on table platform.catalogue_refresh_runs is
  'One row per monthly sweep. Without it, «the catalogue refreshes monthly» is a claim nobody can check.';

create index if not exists catalogue_refresh_runs_recent_idx
  on platform.catalogue_refresh_runs (started_at desc);

-- El nombre comercial de la tarjeta, cuando la fuente lo nombra. Es lo que
-- permite comparar «Visa Platinum ConnectMiles» contra «Mastercard Travel
-- Platinum» y no dos filas que sólo dicen «platinum».
alter table platform.card_benefit_catalogue
  add column if not exists card_product text,
  -- De qué fuente salió, para poder marcarla cuando esa fuente se mueva.
  add column if not exists source_id uuid references platform.catalogue_sources (id) on delete set null;

comment on column platform.card_benefit_catalogue.card_product is
  'The card''s commercial name when the source gives one. What lets a comparison put «Visa Platinum ConnectMiles» against «Mastercard Travel Platinum» rather than two rows that only say «platinum».';

create index if not exists card_benefit_catalogue_source_idx
  on platform.card_benefit_catalogue (source_id);

grant select on platform.catalogue_sources to authenticated, anon;
grant select on platform.catalogue_refresh_runs to authenticated, anon;
