-- Una importación que no viene de un archivo.
--
-- Hasta aquí toda importación tenía un documento detrás, y la columna lo exigía.
-- Era cierto mientras la única puerta fuera subir un PDF. Los avisos de
-- transacción que manda el banco entran por otra: son correos, no archivos, y
-- forzarlos a inventarse un documento —guardar el cuerpo del correo en el
-- almacén de objetos sólo para satisfacer una llave foránea— guardaría de por
-- vida el dato que menos conviene custodiar.
--
-- Así que la columna se vuelve opcional y se añade `source`, que dice de dónde
-- vino la fila. Sin ella, «esta importación no tiene documento» sería un dato
-- ausente en vez de un hecho, y la pantalla de importaciones no podría explicar
-- por qué no hay nada que descargar.

alter table app.imports
  alter column document_id drop not null;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'import_source') then
    create type app.import_source as enum ('upload', 'email');
  end if;
end
$$;

alter table app.imports
  add column if not exists source app.import_source not null default 'upload';

comment on column app.imports.document_id is
  'The file this came from. Null for an import that had none — a bank alert arrives as an email, and storing its body just to satisfy a foreign key would keep exactly the data worth keeping least.';
comment on column app.imports.source is
  'Where the rows came from. `email` imports have no document and nothing to download; the screen says so instead of showing a broken link.';

-- Una importación sin documento tiene que decir de dónde vino.
alter table app.imports
  drop constraint if exists imports_document_or_source;
alter table app.imports
  add constraint imports_document_or_source
  check (document_id is not null or source = 'email');
