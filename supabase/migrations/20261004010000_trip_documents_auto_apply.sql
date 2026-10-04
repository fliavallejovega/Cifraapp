-- Un documento de viaje que se aplicó solo, y uno que choca con lo planeado.
--
-- La casa decidió que un hotel o un vuelo que encaja en el viaje se aplica en
-- cuanto se lee, con aviso y con forma de deshacerlo. Para deshacer hay que
-- saber qué se creó (la reserva y, si hizo falta, el tramo de la ciudad), y eso
-- queda en trip_auto_applied. Cuando el documento choca con lo planeado —un
-- hotel en otra ciudad en noches que ya tienen destino— no se aplica: espera a
-- una persona, y trip_conflict guarda el antes y el después que se le muestra.
alter table app.documents
  add column if not exists trip_auto_applied jsonb,
  add column if not exists trip_conflict jsonb;

comment on column app.documents.trip_auto_applied is
  'Cuando el documento se aplicó al viaje sin revisión: cuándo, la reserva creada y el tramo creado si hizo falta. Lo usa «Deshacer».';
comment on column app.documents.trip_conflict is
  'Cuando el documento choca con lo planeado: las noches, la ciudad planeada y la del documento. Se muestra en la revisión.';
