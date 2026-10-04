-- Una persona dijo que dos líneas iguales de capturas distintas son dos
-- movimientos y no uno.
--
-- Al subir varias capturas de la app del banco, la misma línea suele aparecer
-- en dos de ellas (la parte de abajo de una es la de arriba de la siguiente).
-- La pantalla de importación pregunta si es un solo movimiento. Si la respuesta
-- es «son distintos», esta marca evita volver a preguntarlo y permite guardar
-- los dos aunque tengan la misma huella.
alter table app.import_rows
  add column if not exists distinct_confirmed boolean not null default false;

comment on column app.import_rows.distinct_confirmed is
  'Verdadero cuando una persona confirmó que esta línea no es la misma que otra igual en otro archivo pendiente.';
