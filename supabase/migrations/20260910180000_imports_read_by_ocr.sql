-- Cómo se leyó este estado de cuenta.
--
-- Un CSV se parsea: las columnas están donde el banco las puso y el resultado es
-- reproducible. Un escaneo se transcribe, y una transcripción se equivoca de
-- formas distintas — un 8 que era un 3, una línea que se saltó, un concepto
-- cortado por el borde de la hoja.
--
-- Las dos rutas terminan en la misma cola de revisión, pero quien revisa merece
-- saber cuál fue: revisar una lista transcrita es un trabajo distinto de
-- confirmar una lista parseada, y no decirlo invita a aprobar en bloque.
alter table app.imports
  add column if not exists read_by_ocr boolean not null default false;

comment on column app.imports.read_by_ocr is
  'Verdadero cuando las filas salieron de transcribir un escaneo o una foto en vez de parsear un archivo con estructura. La pantalla de revisión lo dice.';
