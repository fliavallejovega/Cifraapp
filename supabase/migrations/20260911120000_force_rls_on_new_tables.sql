-- Seguridad de fila forzada en las dos tablas que la tenían sólo activada.
--
-- `debt_payments` y `program_balances` nacieron con la política por hogar y el
-- GRANT a `authenticated`, pero sin `force`: el dueño de la tabla —el rol que
-- corre las migraciones— la saltaba. La regla del proyecto es que toda tabla de
-- `app` y `audit` la fuerza, para que ningún camino que no sea el rol de
-- servicio lea el pago de deuda o las millas de otro hogar. El preflight lo
-- atrapó antes del despliegue de la consola.

alter table app.debt_payments force row level security;
alter table app.program_balances force row level security;
