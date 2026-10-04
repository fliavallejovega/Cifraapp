-- Una importación que la app guardó sola.
--
-- Lo que la app puede decidir con seguridad —filas nuevas, de la cuenta que los
-- dígitos confirman, que no están ya en el libro— entra solo al terminar de
-- leer el archivo. Esta marca es lo que permite decir «guardado solo» y ofrecer
-- deshacerlo; deshacer devuelve la importación a revisión sin borrar nada.
alter table app.imports
  add column if not exists auto_filed_at timestamptz;

comment on column app.imports.auto_filed_at is
  'When the app filed this import on its own after reading it. Null when a person saved it, or nobody has.';
