-- Las dos tablas nuevas no tenían permisos, y RLS no alcanza.
--
-- `enable row level security` decide **qué filas** ve un rol. `grant` decide si
-- el rol puede mirar la tabla siquiera. Postgres evalúa el segundo primero, así
-- que una tabla con política perfecta y sin grant responde
-- «permission denied» sin llegar a leer la política.
--
-- La pantalla de tarjetas se cayó entera por esto: la consulta lee el saldo de
-- millas con una subconsulta, y esa subconsulta tumbó la consulta completa.
--
-- `debt_payments` tenía el mismo hueco esperando. No se había caído porque
-- todavía nada la leía en una ruta de lectura — el primer pago que alguien
-- registrara habría reventado igual.
--
-- Este proyecto otorga permisos tabla por tabla, a propósito: una tabla nueva no
-- debería volverse legible por existir. El costo de esa decisión es que hay que
-- acordarse, y no me acordé dos veces seguidas. El gate que acompaña esta
-- migración es lo que reemplaza el acordarse.

grant select, insert, update, delete on app.debt_payments to authenticated;
grant select, insert, update, delete on app.program_balances to authenticated;

-- El rol de servicio los tiene por el grant de esquema, pero se escribe: los
-- trabajos de fondo corren con él y un fallo ahí no lo ve nadie hasta el mes
-- siguiente.
grant select, insert, update, delete on app.debt_payments to service_role;
grant select, insert, update, delete on app.program_balances to service_role;
