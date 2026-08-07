-- Documents and imports.
--
-- The file a user uploads is evidence. Every transaction that came from it must
-- be traceable back to it — "imported from the Banco General July 2026
-- statement" is not a nicety, it is how a person decides whether to trust a
-- figure they did not enter themselves (spec §14).
--
-- Bytes live in Cloudflare R2, never in Postgres. The database holds the key,
-- the hash and the provenance.

create type app.document_kind as enum (
  'bank_statement', 'card_statement', 'receipt', 'invoice',
  'tax_document', 'loan_statement', 'contract', 'other'
);

create type app.import_status as enum (
  'uploaded',   -- stored, not yet parsed
  'parsing',
  'review',     -- parsed; exceptions await a human
  'importing',
  'completed',
  'failed',
  'discarded'
);

create table app.documents (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,
  uploaded_by    uuid references app.profiles (id) on delete set null,
  account_id     uuid references app.accounts (id) on delete set null,

  kind           app.document_kind not null default 'bank_statement',
  file_name      text not null,
  mime_type      text not null,
  byte_size      bigint not null check (byte_size > 0),

  -- The object key in R2. Private always; reads go through a signed URL with a
  -- short expiry, never a public bucket (spec §46, §122).
  storage_key    text not null unique,
  -- SHA-256 of the bytes. Re-uploading the same file is caught here, before it
  -- is parsed — a filename is not identity, and users download the same
  -- statement twice with different names all the time.
  content_hash   text not null,

  statement_period_start date,
  statement_period_end   date,
  tax_year       smallint,

  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  -- One copy of a given file per household. Two households may legitimately
  -- hold the same document.
  unique (household_id, content_hash)
);

create index documents_household_idx on app.documents (household_id, created_at desc)
  where deleted_at is null;

create table app.imports (
  id            uuid primary key default public.uuid_generate_v7(),
  household_id  uuid not null references app.households (id) on delete cascade,
  document_id   uuid not null references app.documents (id) on delete cascade,
  account_id    uuid references app.accounts (id) on delete set null,
  started_by    uuid references app.profiles (id) on delete set null,

  status        app.import_status not null default 'uploaded',
  format        text,

  -- The counts the review screen reports. Stored rather than recomputed so the
  -- summary a user acted on is the summary that is recorded.
  rows_found    integer not null default 0,
  rows_new      integer not null default 0,
  rows_duplicate integer not null default 0,
  rows_review   integer not null default 0,
  rows_rejected integer not null default 0,

  -- Makes a retried import a no-op rather than a second copy (spec §67).
  idempotency_key text unique,

  error_message text,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,

  constraint imports_completed_has_timestamp
    check ((status in ('completed', 'failed', 'discarded')) = (completed_at is not null))
);

create index imports_household_idx on app.imports (household_id, started_at desc);

-- Every extracted row, kept whether or not it became a transaction. A row the
-- parser could not read is a transaction the user never learns about unless it
-- is recorded and shown.
create table app.import_rows (
  id             uuid primary key default public.uuid_generate_v7(),
  import_id      uuid not null references app.imports (id) on delete cascade,
  household_id   uuid not null references app.households (id) on delete cascade,
  line_number    integer,

  transaction_date date,
  amount         numeric(19, 4),
  currency       char(3),
  description_original text,
  description_normalized text,
  external_reference text,
  fingerprint    text,

  verdict        text not null check (verdict in ('new', 'duplicate', 'review', 'rejected')),
  confidence     numeric(4, 3) check (confidence between 0 and 1),
  matched_transaction_id uuid references app.transactions (id) on delete set null,
  -- Which rules fired. The explanation shown to the user comes from here, so a
  -- decision can always be justified after the fact (spec §98).
  matched_signals jsonb not null default '[]'::jsonb,
  rejection_reason text,

  created_transaction_id uuid references app.transactions (id) on delete set null,
  raw            text,
  created_at     timestamptz not null default now()
);

create index import_rows_import_idx on app.import_rows (import_id, verdict);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array['documents', 'imports', 'import_rows'] loop
    execute format('alter table app.%I enable row level security', target);
    execute format('alter table app.%I force row level security', target);
    execute format(
      'create policy %I on app.%I for all to authenticated
         using (app.is_household_member(household_id))
         with check (app.is_household_member(household_id))',
      target || '_household_access', target
    );
  end loop;
end
$$;

grant select, insert, update, delete on app.documents, app.imports, app.import_rows
  to authenticated;

-- Backfills the provenance link the transactions table already reserved.
alter table app.transactions
  add constraint transactions_source_document_fkey
  foreign key (source_document_id) references app.documents (id) on delete set null;

alter table app.transactions
  add constraint transactions_source_import_fkey
  foreign key (source_import_id) references app.imports (id) on delete set null;

update platform.schema_version
   set version = 5,
       description = 'Phase 4 — documents and imports: storage provenance, import runs, per-row verdicts',
       applied_at = now()
 where id;
