-- White label.
--
-- The hierarchy already exists: `platform → organization → households`. An
-- organization is a firm; a household belongs to at most one. What this
-- migration adds is what a firm may put its own name on, and where that stops.
--
-- The line it draws matters more than the features. A firm can change what the
-- product looks like and who it appears to come from. It cannot change what the
-- product says about money — the copy register, the tax disclaimers and the
-- refusal to call an estimate a bill are not brandable, because a household
-- reading a rebranded screen is entitled to the same honesty as one reading
-- ours.

create table platform.organization_branding (
  organization_id uuid primary key references app.organizations (id) on delete cascade,

  -- Shown instead of the product's own name. The product name still appears in
  -- legal text and in the security page: who built the software is a fact a
  -- customer is entitled to, not a branding decision.
  display_name   text not null check (length(trim(display_name)) between 1 and 80),

  logo_asset_id  uuid references platform.media_assets (id) on delete set null,
  favicon_asset_id uuid references platform.media_assets (id) on delete set null,

  -- One color. The design system is built on neutrals with a single reserved
  -- signal, and letting a firm set a palette would break the one rule that makes
  -- a threshold crossing legible (DESIGN.md).
  primary_color  text check (primary_color is null or primary_color ~ '^#[0-9a-fA-F]{6}$'),

  -- Lowercased and unique across the platform. Two organizations claiming one
  -- domain is a tenant-resolution bug with a customer's data on the other side.
  custom_domain  text unique check (custom_domain is null or custom_domain = lower(custom_domain)),
  domain_verified_at timestamptz,

  support_email  text,
  email_from_name text,

  -- A firm's own terms and privacy policy, when they have them. Null falls back
  -- to the platform's, which is the honest default rather than an empty page.
  terms_url      text,
  privacy_url    text,

  -- Steps to add or replace during onboarding, as the onboarding flow's own
  -- shape. Validated on read.
  onboarding     jsonb not null default '{}'::jsonb,

  -- The plan a household created under this organization starts on.
  default_plan_code text references platform.plans (code),

  is_active      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- An unverified domain is not served. Serving one would let anyone who can
  -- point DNS at us claim another firm's customers.
  constraint organization_branding_active_domain_is_verified
    check (not is_active or custom_domain is null or domain_verified_at is not null)
);

create index organization_branding_domain_idx
  on platform.organization_branding (custom_domain)
  where is_active and custom_domain is not null;

/**
 * The branding in force for a household, or null.
 *
 * Security definer and deliberately narrow: it returns the presentation fields
 * and nothing else, so a household can render its firm's name and logo without
 * being able to read the firm's row — which carries a support address, a domain
 * and a default plan that are the firm's business.
 */
create or replace function app.branding_for_household(target_household uuid)
returns table (
  display_name text,
  primary_color text,
  logo_asset_id uuid,
  support_email text,
  terms_url text,
  privacy_url text
)
language sql
stable
security definer
set search_path = app, platform, public
as $$
  select b.display_name, b.primary_color, b.logo_asset_id, b.support_email,
         b.terms_url, b.privacy_url
    from app.households h
    join platform.organization_branding b on b.organization_id = h.organization_id
   where h.id = target_household
     and b.is_active
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table platform.organization_branding enable row level security;
alter table platform.organization_branding force row level security;

-- Read only, and only by somebody inside a household that belongs to the
-- organization. Editing branding is an administrative action through the admin
-- platform; a member of one client household must not be able to rebrand the
-- firm for every other client.
create policy organization_branding_readable_by_client on platform.organization_branding
  for select to authenticated
  using (
    exists (
      select 1
        from app.households h
       where h.organization_id = organization_id
         and app.is_household_member(h.id)
    )
  );

grant select on platform.organization_branding to authenticated;
grant execute on function app.branding_for_household(uuid) to authenticated;

create trigger organization_branding_updated_at
  before update on platform.organization_branding
  for each row execute function public.set_updated_at();

update platform.schema_version
   set version = 18,
       description = 'Phase 19 — white label: organization branding, verified custom domains, per-household resolution',
       applied_at = now()
 where id;
