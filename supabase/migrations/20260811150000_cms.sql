-- The CMS: marketing content as data, not as code.
--
-- Every string on the marketing site is a row. Not because a marketing team
-- exists yet, but because the alternative is a deployment for a typo and a
-- second copy of the product's own voice living in JSX where nobody edits it.
--
-- Two things this schema deliberately makes awkward:
--
--   **A hardcoded image URL.** Media is a row with alt text that cannot be null.
--   An image with no alt text is invisible to a screen reader and to a search
--   engine, and making the column nullable is how it ends up empty on every
--   asset uploaded in a hurry.
--
--   **A fabricated testimonial or rating.** The tables exist and ship empty.
--   Nothing seeds them, and structured data is only emitted for content that is
--   actually here (spec §108).

create type platform.content_status as enum ('draft', 'scheduled', 'published', 'archived');

create type platform.legal_kind as enum ('terms', 'privacy', 'tax_disclaimer', 'cookies');

-- ---------------------------------------------------------------------------
-- Media
-- ---------------------------------------------------------------------------

create table platform.media_assets (
  id             uuid primary key default public.uuid_generate_v7(),

  r2_key         text not null unique,
  url            text not null,

  -- Not nullable, on purpose. An asset with no alt text is invisible to a screen
  -- reader, and a nullable column is how that becomes true of everything
  -- uploaded on a deadline.
  alt            text not null check (length(trim(alt)) > 0),

  width          integer check (width is null or width > 0),
  height         integer check (height is null or height > 0),
  mime_type      text not null,
  byte_size      integer check (byte_size is null or byte_size >= 0),

  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Authors and taxonomy
-- ---------------------------------------------------------------------------

create table platform.content_authors (
  id             uuid primary key default public.uuid_generate_v7(),
  slug           text not null unique,
  name           text not null,
  role           text,
  bio            text,
  avatar_id      uuid references platform.media_assets (id) on delete set null,
  created_at     timestamptz not null default now()
);

create table platform.content_categories (
  id             uuid primary key default public.uuid_generate_v7(),
  slug           text not null unique,
  name_es        text not null,
  name_en        text not null,
  description_es text,
  description_en text,
  sort_order     integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Pages and posts
-- ---------------------------------------------------------------------------
--
-- One table for both, distinguished by `kind`. They differ in what they mean,
-- not in what they hold: a slug, a locale, a body, and the metadata a search
-- engine reads. Splitting them would duplicate the SEO columns and the
-- publishing workflow, and the day a "feature page" needs an author both halves
-- would need it.

create table platform.content_pages (
  id             uuid primary key default public.uuid_generate_v7(),

  kind           text not null check (kind in (
    'page', 'post', 'feature', 'comparison', 'case_study', 'changelog', 'legal'
  )),
  slug           text not null,
  locale         text not null check (locale in ('es', 'en')),

  title          text not null,
  -- What appears in a listing. Distinct from the SEO description, which is
  -- written for a search result and reads badly on the page itself.
  excerpt        text,
  body           text not null default '',

  author_id      uuid references platform.content_authors (id) on delete set null,
  category_id    uuid references platform.content_categories (id) on delete set null,
  hero_image_id  uuid references platform.media_assets (id) on delete set null,

  -- SEO, per page and per locale. A single set shared across languages is how a
  -- Spanish page ends up with an English title in search results.
  seo_title      text,
  seo_description text,
  canonical_url  text,
  og_title       text,
  og_description text,
  og_image_id    uuid references platform.media_assets (id) on delete set null,
  structured_data jsonb,
  no_index       boolean not null default false,

  status         platform.content_status not null default 'draft',
  published_at   timestamptz,

  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint content_pages_unique_slug unique (kind, slug, locale),
  constraint content_pages_published_has_date
    check (status <> 'published' or published_at is not null)
);

create index content_pages_lookup_idx
  on platform.content_pages (kind, locale, status, published_at desc);

create table platform.faqs (
  id             uuid primary key default public.uuid_generate_v7(),
  page_id        uuid references platform.content_pages (id) on delete cascade,
  locale         text not null check (locale in ('es', 'en')),
  question       text not null,
  answer         text not null,
  sort_order     integer not null default 0,
  is_published   boolean not null default true
);

-- Ships empty and stays empty until somebody real says something real. Nothing
-- in the seed writes to it, and the landing page renders nothing when it is
-- empty rather than falling back to an example (spec §108).
create table platform.testimonials (
  id             uuid primary key default public.uuid_generate_v7(),
  locale         text not null check (locale in ('es', 'en')),
  quote          text not null,
  attribution    text not null,
  role           text,
  -- Consent is the point. An unapproved quote is not a testimonial, it is a
  -- support message somebody screenshotted.
  approved_at    timestamptz,
  approved_by    text,
  is_published   boolean not null default false,
  created_at     timestamptz not null default now(),

  constraint testimonials_publication_requires_consent
    check (not is_published or (approved_at is not null and approved_by is not null))
);

-- ---------------------------------------------------------------------------
-- Redirects
-- ---------------------------------------------------------------------------

create table platform.redirects (
  id             uuid primary key default public.uuid_generate_v7(),
  from_path      text not null unique,
  to_path        text not null,
  status_code    smallint not null default 301 check (status_code in (301, 302, 307, 308)),
  is_active      boolean not null default true,
  note           text,
  created_at     timestamptz not null default now(),

  constraint redirects_no_self_loop check (from_path <> to_path)
);

-- ---------------------------------------------------------------------------
-- Legal
-- ---------------------------------------------------------------------------
--
-- Versioned, because consent is to a specific text on a specific date.
-- "The user accepted the terms" is not a fact unless it says which terms.

create table platform.legal_documents (
  id             uuid primary key default public.uuid_generate_v7(),
  kind           platform.legal_kind not null,
  locale         text not null check (locale in ('es', 'en')),
  version        text not null,

  title          text not null,
  body           text not null,

  effective_from date not null,
  -- Null until reviewed by counsel. Nothing seeded here has been.
  reviewed_by    text,
  reviewed_at    timestamptz,

  created_at     timestamptz not null default now(),

  constraint legal_documents_unique_version unique (kind, locale, version)
);

create table app.legal_acceptances (
  id             uuid primary key default public.uuid_generate_v7(),
  profile_id     uuid not null references app.profiles (id) on delete cascade,

  kind           platform.legal_kind not null,
  version        text not null,
  locale         text not null,

  accepted_at    timestamptz not null default now(),
  -- Recorded because "they accepted" is disputed more often than anyone expects.
  ip_hash        text,
  user_agent     text,

  constraint legal_acceptances_once unique (profile_id, kind, version)
);

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

grant select on
  platform.content_pages, platform.content_authors, platform.content_categories,
  platform.media_assets, platform.faqs, platform.testimonials, platform.redirects,
  platform.legal_documents
  to anon, authenticated;

alter table platform.content_pages enable row level security;
alter table platform.content_pages force row level security;

-- Only published content is readable. A draft is working material, and the
-- marketing site reads with the anonymous key.
create policy content_pages_published_readable on platform.content_pages
  for select
  using (status = 'published' and published_at <= now());

alter table platform.content_authors enable row level security;
alter table platform.content_authors force row level security;
create policy content_authors_readable on platform.content_authors for select using (true);

alter table platform.content_categories enable row level security;
alter table platform.content_categories force row level security;
create policy content_categories_readable on platform.content_categories for select using (true);

alter table platform.media_assets enable row level security;
alter table platform.media_assets force row level security;
create policy media_assets_readable on platform.media_assets for select using (true);

alter table platform.faqs enable row level security;
alter table platform.faqs force row level security;
create policy faqs_readable on platform.faqs for select using (is_published);

alter table platform.testimonials enable row level security;
alter table platform.testimonials force row level security;
create policy testimonials_readable on platform.testimonials for select using (is_published);

alter table platform.redirects enable row level security;
alter table platform.redirects force row level security;
create policy redirects_readable on platform.redirects for select using (is_active);

alter table platform.legal_documents enable row level security;
alter table platform.legal_documents force row level security;
create policy legal_documents_readable on platform.legal_documents for select using (true);

alter table app.legal_acceptances enable row level security;
alter table app.legal_acceptances force row level security;

-- A person may read and record their own acceptances, and nobody else's.
create policy legal_acceptances_own on app.legal_acceptances
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

grant select, insert on app.legal_acceptances to authenticated;

create trigger content_pages_updated_at
  before update on platform.content_pages
  for each row execute function public.set_updated_at();

update platform.schema_version
   set version = 15,
       description = 'Phase 16 — CMS: pages, posts, media with required alt text, FAQs, redirects, versioned legal documents',
       applied_at = now()
 where id;
