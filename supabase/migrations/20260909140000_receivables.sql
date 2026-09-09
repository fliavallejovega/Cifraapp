-- Lo que la familia va a cobrar, y cuándo.
--
-- Un hogar no vive solo de sueldos. Hay una factura que un cliente paga el mes
-- que viene, un préstamo que un hermano va a devolver, el décimo tercer mes.
-- Nada de eso es una cadencia —no se repite, tiene fecha propia— y por eso no
-- cabe en `recurring_series`, que existe para lo que vuelve a pasar.
--
-- **No es dinero disponible y el plan no lo reparte.** Esa es la regla y está
-- escrita aquí porque es la que más fácil se rompe: un cobro que el plan trata
-- como cierto es exactamente la cifra optimista que arruina un presupuesto —el
-- cliente paga tarde, el hermano no paga, y la casa ya gastó contra eso—. El
-- plan se hace con lo que entró; esto se enseña al lado, para poder gestionarlo:
-- saber cuánto viene, de quién, y para cuándo.
--
-- `confidence` guarda esa diferencia sin pretender medirla: la persona dice si
-- está confirmado o es un estimado, y el producto no calcula probabilidades
-- sobre la palabra de nadie.

create type app.receivable_confidence as enum ('confirmed', 'estimated');

create table if not exists app.receivables (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,

  -- Qué es. Texto libre: «Factura marzo», «Décimo tercer mes», «Lo de Luis».
  name           text not null check (length(trim(name)) between 1 and 120),
  -- De quién viene. Un cobro sin origen no se puede reclamar.
  source         text check (source is null or length(trim(source)) <= 120),

  amount         numeric(19, 4) not null check (amount >= 0),
  currency       char(3) not null default 'USD' references platform.currencies (code),

  /**
   * Para cuándo. Fecha de calendario y no marca de tiempo: cobrar es un hecho
   * del día, igual que todo lo demás que este sistema fecha (ADR-006).
   *
   * Nula a propósito cuando la persona no lo sabe. «Me deben 500 y no sé
   * cuándo» es una respuesta verdadera y útil; obligarla a inventar una fecha
   * la convertiría en un dato falso con aspecto de dato.
   */
  expected_on    date,

  confidence     app.receivable_confidence not null default 'estimated',

  -- Cobrado, con la fecha en que se cobró. No se borra: un cobro que entró es
  -- historia del hogar, y borrarlo dejaría el mes pasado sin explicación.
  received_on    date,

  notes          text check (notes is null or length(notes) <= 500),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

comment on table app.receivables is
  'Money the household expects to receive, with a date and a source. Never counted as available: the plan is built on money that arrived. Shown alongside so the household can chase it.';
comment on column app.receivables.confidence is
  'Stated by the household, not computed. The product does not put a probability on somebody''s word.';

create index if not exists receivables_household_idx
  on app.receivables (household_id, expected_on)
  where deleted_at is null and received_on is null;

create trigger set_updated_at before update on app.receivables
  for each row execute function public.set_updated_at();

alter table app.receivables enable row level security;
alter table app.receivables force row level security;

drop policy if exists receivables_household_access on app.receivables;
create policy receivables_household_access on app.receivables
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

drop policy if exists receivables_readable_by_accountant on app.receivables;
create policy receivables_readable_by_accountant on app.receivables
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

grant select, insert, update, delete on app.receivables to authenticated;
