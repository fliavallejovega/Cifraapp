-- Un cobro que llega «entre el 1 y el 10», y el movimiento que lo confirma.
--
-- El modelo tenía dos estados y ninguno describe a un independiente. O el cobro
-- tenía fecha exacta —y entonces entraba al plan— o no tenía ninguna, y
-- entonces quedaba al margen. Un desarrollador que factura sabe perfectamente
-- que ese pago entra en la primera quincena; no saber el día no es no saber
-- nada, y tratarlo como si lo fuera borra la mitad del ingreso de una casa que
-- vive de vender.
--
-- El rango no lo vuelve disponible para gastar. Esa regla no se toca: un cobro
-- tratado como cierto es la cifra optimista que arruina un presupuesto. Lo que
-- el rango permite es lo otro, que es lo que realmente hace falta: armar el
-- calendario del mes y poder decir «para llegar al 30 tiene que entrar $1,240
-- antes del 26», que es una frase accionable y no una promesa.

alter table app.receivables
  add column if not exists expected_from date,
  add column if not exists expected_to   date;

-- Lo que ya existía con fecha exacta es una ventana de un solo día. Convertirlo
-- ahora evita que el resto del sistema tenga que preguntar dos veces.
update app.receivables
   set expected_from = coalesce(expected_from, expected_on),
       expected_to   = coalesce(expected_to, expected_on)
 where expected_on is not null
   and (expected_from is null or expected_to is null);

alter table app.receivables
  drop constraint if exists receivables_window_ordered;
alter table app.receivables
  add constraint receivables_window_ordered
  check (expected_from is null or expected_to is null or expected_from <= expected_to);

comment on column app.receivables.expected_from is
  'Earliest day this is expected. With expected_to, the window the plan schedules it in. Both null means «no sé cuándo», which is a real answer and stays out of the calendar.';
comment on column app.receivables.expected_to is
  'Latest day this is expected. Equal to expected_from when the date is exact.';

-- El movimiento que lo cobró, cuando se concilió contra un estado de cuenta
-- importado. Nulo mientras sea sólo una expectativa, y nulo también cuando el
-- hogar lo marcó recibido a mano sin haber importado nada.
alter table app.receivables
  add column if not exists received_transaction_id uuid
    references app.transactions (id) on delete set null;

comment on column app.receivables.received_transaction_id is
  'The imported movement that turned this expectation into money. What makes «lo cobré» checkable months later instead of a claim.';

create index if not exists receivables_window_idx
  on app.receivables (household_id, expected_from)
  where received_on is null and deleted_at is null;

-- Un movimiento salda un cobro y no dos.
create unique index if not exists receivables_transaction_unique
  on app.receivables (received_transaction_id)
  where received_transaction_id is not null and deleted_at is null;
