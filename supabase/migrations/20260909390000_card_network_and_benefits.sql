-- Qué tarjeta es, cuánto cuesta tenerla, y qué da.
--
-- ## La red
--
-- Visa, Mastercard, American Express. Es un hecho estable, impreso en el
-- plástico, y es lo que decide cosas prácticas: dónde se acepta, qué seguro de
-- alquiler de auto aplica, y qué formato tiene el estado de cuenta que se va a
-- importar. Va en la cuenta y no en la deuda porque describe el instrumento,
-- no lo que se debe con él.
--
-- No se deduce del nombre. «Visa Blei BG» probablemente sea Visa, y
-- probablemente no es suficiente: adivinar la red por el nombre es la misma
-- inferencia sobre datos financieros que este esquema evita en todas partes.
--
-- ## La anualidad
--
-- Lo que cuesta tener la tarjeta al año. Es la cifra que decide si una tarjeta
-- que da 3% de vuelta conviene o no, y ninguna pantalla podía contestarlo
-- porque el dato no existía. Nula es «nadie lo ha dicho»; cero es «no cobra»,
-- y son respuestas distintas.
--
-- ## Los beneficios
--
-- Los declara el hogar, leyéndolos de su propio contrato. **No hay un catálogo
-- de las tarjetas de Panamá dentro del producto**, y no lo hay a propósito: los
-- beneficios cambian por nivel de tarjeta, por promoción y por mes, son
-- términos contractuales, y una tabla desactualizada dentro de una aplicación
-- financiera le dice a alguien que tiene un seguro que no tiene. Sin una fuente
-- mantenida y verificable, lo honesto es guardar lo que el titular leyó en su
-- contrato — y `source` existe para que dentro de un año se sepa de dónde
-- salió cada línea.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'card_network') then
    create type app.card_network as enum ('visa', 'mastercard', 'amex', 'discover', 'other');
  end if;
end
$$;

alter table app.accounts
  add column if not exists card_network app.card_network,
  add column if not exists annual_fee   numeric(19, 4);

alter table app.accounts
  drop constraint if exists accounts_annual_fee_not_negative;
alter table app.accounts
  add constraint accounts_annual_fee_not_negative
  check (annual_fee is null or annual_fee >= 0);

-- Una red sólo tiene sentido en una tarjeta. En una cuenta de ahorros sería un
-- dato que no describe nada, y la base lo rechaza en vez de dejar que una
-- pantalla lo interprete.
alter table app.accounts
  drop constraint if exists accounts_network_only_on_cards;
alter table app.accounts
  add constraint accounts_network_only_on_cards
  check (card_network is null or account_type = 'credit_card');

comment on column app.accounts.card_network is
  'Visa, Mastercard, Amex. A stable fact printed on the card, stated rather than guessed from the name: what a card is called is not what it is.';
comment on column app.accounts.annual_fee is
  'What holding it costs per year. Null is «nobody said»; zero is «it charges nothing», and they are different answers.';

/**
 * Lo que da una tarjeta, según su propio titular.
 *
 * Cada fila es una línea que alguien leyó en su contrato: «3% en supermercados»,
 * «seguro de alquiler de auto», «dos entradas de sala VIP al año». El producto
 * no las sabe y no las inventa.
 *
 * `kind` agrupa para poder leer la lista de un vistazo; `value` es texto libre
 * porque un beneficio real casi nunca es un número limpio —«3% hasta $200 al
 * mes en supermercados afiliados»— y forzarlo a un porcentaje lo convertiría en
 * una promesa que el contrato no hace.
 *
 * `expires_on` importa más de lo que parece: la mitad de los beneficios de una
 * tarjeta son promociones con fecha, y un beneficio vencido que la pantalla
 * sigue mostrando es peor que no mostrarlo.
 */
create table if not exists app.card_benefits (
  id           uuid primary key default public.uuid_generate_v7(),
  household_id uuid not null references app.households (id) on delete cascade,
  account_id   uuid not null references app.accounts (id) on delete cascade,

  kind         text not null
               check (kind in (
                 'cashback', 'miles', 'points', 'insurance', 'lounge',
                 'discount', 'waiver', 'other'
               )),
  label        text not null check (length(trim(label)) between 1 and 120),
  value        text check (value is null or length(value) <= 200),
  -- De dónde salió: «contrato p. 4», «app del banco», «llamada del 3 de marzo».
  -- Es lo que hace que una línea siga siendo comprobable dentro de un año.
  source       text check (source is null or length(source) <= 200),
  expires_on   date,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table app.card_benefits is
  'What a card gives, as its own holder read it in their contract. The product ships no catalogue of Panamanian cards: benefits change by tier, promotion and month, and a stale table inside a financial app tells somebody they have insurance they do not have.';

create index if not exists card_benefits_account_idx
  on app.card_benefits (account_id);

create trigger set_updated_at before update on app.card_benefits
  for each row execute function public.set_updated_at();

alter table app.card_benefits enable row level security;
alter table app.card_benefits force row level security;

drop policy if exists card_benefits_household_access on app.card_benefits;
create policy card_benefits_household_access on app.card_benefits
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

drop policy if exists card_benefits_readable_by_accountant on app.card_benefits;
create policy card_benefits_readable_by_accountant on app.card_benefits
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

grant select, insert, update, delete on app.card_benefits to authenticated;
