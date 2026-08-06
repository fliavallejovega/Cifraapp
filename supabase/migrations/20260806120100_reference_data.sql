-- Global reference data.
--
-- These tables are not tenant-scoped. They hold facts that are the same for
-- every household in the system: which currencies exist, which tax jurisdictions
-- the engine knows about, and the default category tree new households start
-- from. They are readable by any authenticated user and writable only by the
-- service role, so a household can never edit another household's reality.
--
-- Household-specific categories — the ones users rename, merge and create —
-- arrive in Phase 3 and reference these templates as their origin.

-- ---------------------------------------------------------------------------
-- Currencies
-- ---------------------------------------------------------------------------
--
-- USD and PAB are pegged 1:1 and circulate together in Panama, but they are
-- distinct ISO 4217 codes and reporting has to be able to tell them apart
-- (spec §7). No implicit conversion exists anywhere in the system.

create table if not exists platform.currencies (
  code          char(3) primary key,
  name_en       text not null,
  name_es       text not null,
  symbol        text not null,
  minor_units   smallint not null default 2 check (minor_units between 0 and 4),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

comment on table platform.currencies is 'ISO 4217 currencies the system accepts. Reference data, not tenant data.';

-- ---------------------------------------------------------------------------
-- Tax jurisdictions
-- ---------------------------------------------------------------------------
--
-- The tax engine is jurisdiction-aware from the start even though only Panama
-- is implemented (spec §116). Rules, thresholds and deadlines hang off this
-- table in Phase 12, each version-stamped and source-attributed.

create table if not exists platform.tax_jurisdictions (
  code            char(2) primary key,
  name_en         text not null,
  name_es         text not null,
  authority_name  text not null,
  authority_url   text,
  default_currency char(3) not null references platform.currencies (code),
  is_supported    boolean not null default false,
  created_at      timestamptz not null default now()
);

comment on table platform.tax_jurisdictions is
  'Tax jurisdictions. is_supported marks the ones with implemented, reviewed rules — never assume coverage from a row existing.';

-- ---------------------------------------------------------------------------
-- Default category tree
-- ---------------------------------------------------------------------------
--
-- The starting taxonomy from spec §15, in both interface languages (ADR-003).
-- `kind` matters more than it looks: transfers and income are not expenses, and
-- a system that treats them as such reports a credit-card payment as spending
-- and double-counts every internal transfer (spec §11).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'category_kind') then
    create type public.category_kind as enum ('income', 'expense', 'transfer', 'investment');
  end if;
end
$$;

create table if not exists app.category_templates (
  id            uuid primary key default public.uuid_generate_v7(),
  slug          text not null unique,
  parent_slug   text references app.category_templates (slug) on delete cascade,
  name_en       text not null,
  name_es       text not null,
  kind          public.category_kind not null,
  sort_order    integer not null default 0,
  is_system     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists category_templates_parent_idx
  on app.category_templates (parent_slug);

drop trigger if exists set_updated_at on app.category_templates;
create trigger set_updated_at
  before update on app.category_templates
  for each row execute function public.set_updated_at();

comment on table app.category_templates is
  'Default category taxonomy new households start from. Global reference data; user-owned categories live elsewhere.';

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table platform.currencies enable row level security;
alter table platform.tax_jurisdictions enable row level security;
alter table app.category_templates enable row level security;

grant select on platform.currencies to anon, authenticated;
grant select on platform.tax_jurisdictions to anon, authenticated;
grant select on app.category_templates to authenticated;

drop policy if exists currencies_readable on platform.currencies;
create policy currencies_readable on platform.currencies for select using (true);

drop policy if exists tax_jurisdictions_readable on platform.tax_jurisdictions;
create policy tax_jurisdictions_readable on platform.tax_jurisdictions for select using (true);

-- Readable by signed-in users only. The category tree is not secret, but there
-- is no reason to expose the product's taxonomy to anonymous traffic.
drop policy if exists category_templates_readable on app.category_templates;
create policy category_templates_readable
  on app.category_templates
  for select
  to authenticated
  using (true);

update platform.schema_version
   set version = 2,
       description = 'Phase 0 — reference data: currencies, tax jurisdictions, default category tree',
       applied_at = now()
 where id;
