-- Las ofertas del mes: qué comercio, qué descuento, qué días, con qué tarjeta.
--
-- ## Por qué no son beneficios
--
-- Un beneficio del contrato —«1% de devolución en supermercados»— dura mientras
-- dure la tarjeta y describe el producto. Una promoción es lo contrario: «50% en
-- Fosters los martes de septiembre, hasta $125». Tiene comercio, tiene días,
-- tiene tope y **se acaba**. Guardarlas en la misma tabla obligaría a que una de
-- las dos mintiera sobre la otra: o los beneficios cargarían fechas que no
-- tienen, o las promociones se quedarían sin comercio.
--
-- ## Por qué incluye débito y bancos ajenos
--
-- Porque la pregunta que la casa se hace un martes a las siete es «¿con cuál de
-- mis tarjetas pago aquí?», y la mitad de las promociones de Panamá son de
-- débito. Y porque saber que el banco de al lado da 50% donde el tuyo no da
-- nada es información útil aunque no tengas cuenta ahí — es, de hecho, cómo se
-- decide abrir una.
--
-- El filtro «sólo las mías» existe para el momento de decidir; el resto no se
-- esconde, se ordena detrás.
--
-- ## Verificado y sin verificar
--
-- El barrido mensual lee las páginas oficiales y sube lo que encuentra. Esa
-- lectura la hace un modelo sobre texto que cambia sin avisar, así que entra
-- como `unverified` y la pantalla lo dice con esas palabras. Una promoción
-- leída por una máquina no es una promoción confirmada, y presentarla como tal
-- sería exactamente lo que este producto no hace con las cifras de nadie.

create table if not exists platform.card_promotions (
  id             uuid primary key default public.uuid_generate_v7(),

  -- Quién la da. `issuer_key` nulo sería una promoción de nadie: aquí es obligatorio.
  issuer_key     text not null,
  issuer_name    text not null,

  /**
   * Con qué tarjetas aplica.
   *
   * Arreglos y no columnas sueltas porque una promoción real dice «tarjetas
   * personales Visa o Mastercard» — dos redes, los dos productos— y partirlo en
   * filas duplicaría el comercio y el tope tres veces.
   *
   * Vacío significa «todas las de este banco», que es lo que dice una promoción
   * que no distingue.
   */
  networks       text[] not null default '{}',
  card_types     text[] not null default '{}'
                 check (card_types <@ array['credit','debit']::text[]),
  tiers          text[] not null default '{}',

  -- Dónde. El nombre del comercio es lo que se lee de un vistazo y lo que se
  -- busca; la sucursal importa cuando la promoción no aplica en todas.
  merchant_name  text not null check (length(trim(merchant_name)) between 1 and 160),
  merchant_note  text,
  category       text check (category is null or category in (
                   'restaurantes', 'supermercados', 'combustible', 'farmacias',
                   'viajes', 'entretenimiento', 'tecnologia', 'salud', 'otros'
                 )),

  -- Qué dan. `headline` es la frase corta —«50% de descuento»—; `detail` lleva
  -- las condiciones que deciden si conviene ir.
  headline       text not null check (length(trim(headline)) between 1 and 160),
  detail         text,
  /** Tope del descuento y del consumo elegible, cuando la promoción los pone. */
  max_discount   numeric(19, 4),
  max_spend      numeric(19, 4),

  /**
   * Qué días. 1 es lunes y 7 domingo, como ISO.
   *
   * Vacío significa todos los días. Es la diferencia entre una promoción que se
   * puede usar hoy y una que hay que recordar el martes, y sin ella la pantalla
   * no puede contestar «¿qué me sirve hoy?».
   */
  weekdays       smallint[] not null default '{}'
                 check (weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  valid_from     date,
  valid_until    date,
  /** «Sólo consumo en el local», «sólo por la app». Decide si sirve o no. */
  channel        text,

  -- De dónde salió y cuándo se leyó, igual que el catálogo de beneficios.
  source_name    text not null,
  source_url     text not null,
  source_id      uuid references platform.catalogue_sources (id) on delete set null,
  captured_on    date not null,

  /**
   * Si alguien la confirmó, o si sólo la leyó una máquina.
   *
   * `verified` la revisó una persona contra la página oficial. `unverified` la
   * extrajo el barrido mensual. `expired` ya pasó su fecha. La pantalla las
   * distingue siempre: una promoción leída automáticamente es una pista muy
   * buena y no es un hecho.
   */
  status         text not null default 'unverified'
                 check (status in ('verified', 'unverified', 'expired', 'rejected')),
  verified_at    timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table platform.card_promotions is
  'This month''s card offers: merchant, discount, days, cap and validity. Reference data covering every issuer — including banks the household has no account with, because knowing the bank next door gives 50% where yours gives nothing is how somebody decides to open one.';
comment on column platform.card_promotions.status is
  'verified means a person checked it against the official page; unverified means the monthly sweep read it. A promotion read by a machine is a very good lead and is not a fact, and the screen says which is which.';
comment on column platform.card_promotions.weekdays is
  'ISO weekdays, 1 = Monday. Empty means every day. It is the difference between an offer usable today and one to remember on Tuesday.';

create index if not exists card_promotions_live_idx
  on platform.card_promotions (issuer_key, valid_until)
  where status in ('verified', 'unverified');

create index if not exists card_promotions_merchant_idx
  on platform.card_promotions (merchant_name);

create trigger set_updated_at before update on platform.card_promotions
  for each row execute function public.set_updated_at();

-- Referencia compartida, como el catálogo: no pertenece a ningún hogar.
grant select on platform.card_promotions to authenticated, anon;

-- Y una fuente más de clase propia: las páginas de promociones, que cambian
-- cada mes por diseño y son las que el barrido tiene que releer.
alter table platform.catalogue_sources
  drop constraint if exists catalogue_sources_kind_check;
alter table platform.catalogue_sources
  add constraint catalogue_sources_kind_check
  check (kind in ('issuer', 'regulator', 'network', 'third_party', 'promotions'));
