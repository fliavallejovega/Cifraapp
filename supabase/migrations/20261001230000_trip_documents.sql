-- Documentos de viaje: lo que el lector propone y lo que la familia confirma.
--
-- Pasajes, confirmaciones de hotel, recibos en otra moneda. Usan la misma
-- tabla, el mismo almacén y la misma cola que los estados de cuenta: no hay un
-- segundo pipeline. Lo nuevo es dónde queda la propuesta mientras espera
-- revisión, y a qué se convirtió cuando se confirmó.
--
-- `trip_extraction` guarda la propuesta **ya normalizada y sin datos
-- personales sensibles**: números de tarjeta y de pasaporte se descartan antes
-- de escribirla. La transcripción cruda del modelo no se guarda.

alter table app.documents
  add column trip_status text check (trip_status is null or trip_status in
    ('pending', 'processing', 'needs_review', 'confirmed', 'failed', 'discarded')),
  add column trip_extraction jsonb,
  add column trip_confidence numeric(4, 3) check (trip_confidence is null or trip_confidence between 0 and 1),
  add column trip_failure text check (trip_failure is null or length(trip_failure) <= 200),
  add column trip_reviewed_at timestamptz,
  add column trip_booking_id uuid references app.trip_bookings (id) on delete set null,
  add column trip_transaction_id uuid references app.transactions (id) on delete set null;

comment on column app.documents.trip_extraction is
  'Normalized proposal from the travel-document reader, with card and passport numbers removed. Nothing is filed until a person confirms it.';

create index documents_trip_review_idx on app.documents (household_id, trip_status)
  where trip_status in ('pending', 'processing', 'needs_review');
