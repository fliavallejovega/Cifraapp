-- El saldo de una cuenta deja de ser un número que se escribe una vez.
--
-- Hasta hoy `current_balance` era lo que la persona tecleó al crear la cuenta,
-- y sólo lo movían los movimientos escritos a mano. Un estado de cuenta
-- importado no lo tocaba nunca: se podían subir cien y el inicio seguía igual.
--
-- Ahora el saldo es derivado:
--
--   current_balance = balance_anchor + movimientos con fecha > balance_anchor_date
--
-- El ancla es el último saldo que alguien declaró, con su fecha: el que la
-- persona escribió, o el que el banco imprime en un estado. Lo mantiene la base
-- con disparadores, así que ninguna ruta del código puede olvidarse de sumarlo.

alter table app.accounts
  add column if not exists balance_anchor numeric(19, 4),
  add column if not exists balance_anchor_date date,
  add column if not exists balance_anchor_source text,
  add column if not exists balance_mismatch numeric(19, 4);

alter table app.accounts
  drop constraint if exists accounts_balance_anchor_source_check;
alter table app.accounts
  add constraint accounts_balance_anchor_source_check
  check (balance_anchor_source is null or balance_anchor_source in ('user', 'statement'));

comment on column app.accounts.balance_anchor is
  'The last balance someone stated: the household, or the bank on a statement. current_balance derives from it.';
comment on column app.accounts.balance_anchor_date is
  'The date balance_anchor is stated for. Only movements dated after it move current_balance.';
comment on column app.accounts.balance_mismatch is
  'Bank balance minus calculated balance when the last statement balance arrived. Null when they agreed.';

alter table app.imports
  add column if not exists printed_balance numeric(19, 4),
  add column if not exists printed_balance_date date;

comment on column app.imports.printed_balance is
  'The balance the statement prints, with its printed sign. Applied to the account when the import is saved.';

-- ---------------------------------------------------------------------------
-- Lo que se movió después de una fecha
-- ---------------------------------------------------------------------------

-- Lo duplicado y lo excluido no movió dinero; todo lo demás sí, también una
-- transferencia (sale de una cuenta y entra a otra) y lo pendiente.
create or replace function app.account_movements_after(p_account uuid, p_after date)
  returns numeric
  language sql
  stable
  security definer
  set search_path to 'app', 'public', 'pg_temp'
as $function$
  select coalesce(sum(t.amount), 0)
  from app.transactions t
  where t.account_id = p_account
    and t.deleted_at is null
    and t.status not in ('duplicate', 'excluded')
    and (p_after is null or t.transaction_date > p_after);
$function$;

revoke all on function app.account_movements_after(uuid, date) from public;

-- La fecha de hoy donde vive el hogar, no donde corre el servidor (ADR-006).
create or replace function app.household_today(p_household uuid)
  returns date
  language sql
  stable
  security definer
  set search_path to 'app', 'public', 'pg_temp'
as $function$
  select (now() at time zone coalesce(
    (select h.time_zone from app.households h where h.id = p_household),
    'America/Panama'))::date;
$function$;

revoke all on function app.household_today(uuid) from public;

-- ---------------------------------------------------------------------------
-- Cuentas: el ancla al crear, al reescribir el saldo y al cambiar el ancla
-- ---------------------------------------------------------------------------

create or replace function app.accounts_balance_anchor()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'app', 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    -- Una cuenta nace con el saldo que alguien le escribió, a hoy.
    if new.balance_anchor is null then
      new.balance_anchor := new.current_balance;
      new.balance_anchor_date := coalesce(new.balance_anchor_date, app.household_today(new.household_id));
      new.balance_anchor_source := coalesce(new.balance_anchor_source, 'user');
    end if;
    return new;
  end if;

  if (new.balance_anchor, new.balance_anchor_date)
       is distinct from (old.balance_anchor, old.balance_anchor_date) then
    -- Llegó un ancla nueva (un estado de cuenta): el saldo se recalcula desde ella.
    new.current_balance := new.balance_anchor
      + app.account_movements_after(new.id, new.balance_anchor_date);
  elsif new.current_balance is distinct from old.current_balance
        and pg_trigger_depth() = 1 then
    -- Alguien reescribió el saldo a mano: eso es declarar un saldo nuevo a hoy.
    -- A profundidad mayor es el recálculo de los movimientos, no una persona.
    new.balance_anchor := new.current_balance
      - app.account_movements_after(new.id, app.household_today(new.household_id));
    new.balance_anchor_date := app.household_today(new.household_id);
    new.balance_anchor_source := 'user';
    new.balance_mismatch := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists accounts_balance_anchor on app.accounts;
create trigger accounts_balance_anchor
  before insert or update on app.accounts
  for each row execute function app.accounts_balance_anchor();

-- ---------------------------------------------------------------------------
-- Movimientos: cada escritura recalcula las cuentas que tocó
-- ---------------------------------------------------------------------------

create or replace function app.transactions_sync_balance()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'app', 'public', 'pg_temp'
as $function$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    update app.accounts a
       set current_balance = a.balance_anchor
             + app.account_movements_after(a.id, a.balance_anchor_date),
           updated_at = now()
     where a.id in (select distinct n.account_id from new_rows n)
       and a.balance_anchor is not null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    update app.accounts a
       set current_balance = a.balance_anchor
             + app.account_movements_after(a.id, a.balance_anchor_date),
           updated_at = now()
     where a.id in (select distinct o.account_id from old_rows o)
       and a.balance_anchor is not null;
  end if;
  return null;
end;
$function$;

drop trigger if exists transactions_sync_balance_insert on app.transactions;
create trigger transactions_sync_balance_insert
  after insert on app.transactions
  referencing new table as new_rows
  for each statement execute function app.transactions_sync_balance();

drop trigger if exists transactions_sync_balance_update on app.transactions;
create trigger transactions_sync_balance_update
  after update on app.transactions
  referencing old table as old_rows new table as new_rows
  for each statement execute function app.transactions_sync_balance();

drop trigger if exists transactions_sync_balance_delete on app.transactions;
create trigger transactions_sync_balance_delete
  after delete on app.transactions
  referencing old table as old_rows
  for each statement execute function app.transactions_sync_balance();

-- ---------------------------------------------------------------------------
-- Las cuentas que ya existen
-- ---------------------------------------------------------------------------

-- El ancla es el día en que se creó la cuenta. El saldo de hoy ya incluye los
-- movimientos escritos a mano (el código viejo los sumaba), así que se restan
-- del ancla los posteriores a ese día; al recalcular vuelven a entrar, junto con
-- los importados que nunca se sumaron. Los anteriores a la creación ya estaban
-- en el saldo que la persona escribió y no se cuentan otra vez.
update app.accounts a
   set balance_anchor_date = (a.created_at at time zone coalesce(h.time_zone, 'America/Panama'))::date,
       balance_anchor_source = 'user',
       balance_anchor = a.current_balance - coalesce((
         select sum(t.amount)
         from app.transactions t
         where t.account_id = a.id
           and t.deleted_at is null
           and t.source <> 'imported'
           and t.transaction_date > (a.created_at at time zone coalesce(h.time_zone, 'America/Panama'))::date
       ), 0)
  from app.households h
 where h.id = a.household_id
   and a.balance_anchor is null;

-- El ancla cambió, así que el disparador ya recalculó `current_balance`.
