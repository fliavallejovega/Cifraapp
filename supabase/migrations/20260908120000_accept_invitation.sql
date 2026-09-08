-- Accepting an invitation.
--
-- Until now this was impossible, and the shape of the bug is worth recording
-- because it is the kind that passes every test written from inside the
-- household.
--
-- `app.household_members` carries one write policy, `household_members_write_owner`,
-- which requires `app.has_household_role(household_id, ARRAY['owner'])`. That is
-- correct for every ordinary write: only an owner adds, removes or re-roles a
-- member. But joining is the one write performed by somebody who is, by
-- definition, not yet a member — so the invited person's INSERT was refused by
-- the policy that exists to protect them, and every invitation in the product
-- was a link that could be created, sent, opened, and never accepted.
--
-- The fix is not a looser policy. A policy permitting a self-insert into any
-- household would be an open door: anybody could add themselves to any
-- household id they could guess or read. The authority to join comes from
-- holding an unexpired invitation addressed to your own verified email, and
-- nothing else — so the check belongs in a function that can see the
-- invitation, and the function runs as definer precisely because the caller
-- must not be able to do this on their own.
--
-- Everything the previous application code checked in TypeScript is checked
-- here instead, in the same transaction as the insert: that the token matches,
-- that the invitation is unaccepted and unexpired, and that it names the
-- caller's own address. Doing it in the application left a window between the
-- read and the write, and it left the rules restatable — a second caller could
-- always be written that forgot one.

create or replace function app.accept_invitation(invitation_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = app, public, pg_temp
as $$
declare
  caller        uuid := auth.uid();
  caller_email  text;
  invitation    app.household_invitations;
begin
  if caller is null then
    raise exception 'An invitation can only be accepted by a signed-in user.'
      using errcode = '42501';
  end if;

  select p.email::text into caller_email from app.profiles p where p.id = caller;
  if caller_email is null then
    return jsonb_build_object('state', 'signInRequired');
  end if;

  -- Locked, so two clicks on the same link cannot both pass the «not yet
  -- accepted» test and produce two memberships.
  select * into invitation
    from app.household_invitations i
   where i.token_hash = invitation_token_hash
     and i.accepted_at is null
     and i.expires_at > now()
   for update;

  if not found then
    -- Expired, already used, or never existed. One answer for all three: an
    -- invitation link is a bearer credential, and distinguishing «used» from
    -- «never existed» tells whoever holds it which households are real.
    return jsonb_build_object('state', 'invalid');
  end if;

  -- The invitation names an address. A forwarded link must not move somebody
  -- else's account into a household its owner never invited them to.
  if lower(invitation.email::text) <> lower(caller_email) then
    return jsonb_build_object('state', 'wrongAccount');
  end if;

  -- The unique index is partial — it ignores revoked rows — so the conflict
  -- target has to carry the same predicate. A person who was removed and is
  -- now invited back does not collide: their revoked row stays as history and
  -- a new active one is written beside it.
  insert into app.household_members (household_id, user_id, role, status, invited_by, joined_at)
  values (invitation.household_id, caller, invitation.role, 'active', invitation.invited_by, now())
  on conflict (household_id, user_id) where status <> 'revoked' do update
     -- Somebody previously removed and now re-invited comes back with the role
     -- the new invitation grants, not the one they used to hold.
     set role       = excluded.role,
         status     = 'active',
         revoked_at = null,
         updated_at = now();

  update app.household_invitations
     set accepted_at = now(),
         accepted_by = caller
   where id = invitation.id;

  -- The household's own trail: a membership appearing without a record of who
  -- let them in is the first question anybody asks afterwards.
  insert into audit.events (actor_user_id, action, entity_type, entity_id, household_id, metadata)
  values (caller, 'household.member.joined', 'household_member', invitation.household_id,
          invitation.household_id,
          jsonb_build_object('role', invitation.role, 'invitedBy', invitation.invited_by));

  -- The category tree, for a household created before migration 27 or by a
  -- path that skipped it. Idempotent, and the caller is a member by now.
  perform app.seed_household_categories(invitation.household_id);

  return jsonb_build_object('state', 'ok', 'householdId', invitation.household_id);
end;
$$;

grant execute on function app.accept_invitation(text) to authenticated;

comment on function app.accept_invitation(text) is
  'Redeems an invitation token for the signed-in user. Definer, because joining is the one membership write performed by somebody who is not yet a member; the authority comes from the invitation, which this function verifies.';

-- ---------------------------------------------------------------------------
-- Seeding categories on behalf of a household
-- ---------------------------------------------------------------------------
--
-- `app.seed_household_categories` refuses a caller who is not a member, which
-- is right for the product and wrong for the two paths that legitimately act
-- for a household without being in it: the administrative console creating a
-- household for a customer, and a background job. Both hold the service role,
-- which has no `auth.uid()` at all, so the guard rejected them and the console's
-- household creation failed as a whole.
--
-- Rather than weaken the guard, the membership test now also passes for a
-- caller who holds the service role. That is not a hole: reaching this function
-- with the service role already means holding the key that bypasses every
-- policy in the database.
create or replace function app.seed_household_categories(target_household uuid)
returns integer
language plpgsql
security definer
set search_path = app, public, pg_temp
as $$
declare
  parents integer := 0;
  children integer := 0;
begin
  -- A caller with no `auth.uid()` at all is not a customer who wandered in: it
  -- is the service role, already holding the key that bypasses every policy in
  -- this database. A signed-in caller still has to be a member.
  if auth.uid() is not null and not app.is_household_member(target_household) then
    raise exception 'Only a member may seed a household''s categories.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from app.households h where h.id = target_household) then
    raise exception 'No such household.' using errcode = '42704';
  end if;

  -- Parents first, so a child can find the row it hangs from.
  insert into app.categories (household_id, template_slug, name, kind, sort_order, is_system)
  select target_household, t.slug, t.name_es, t.kind, t.sort_order, true
    from app.category_templates t
   where t.parent_slug is null
     and not exists (
       select 1 from app.categories c
        where c.household_id = target_household and c.template_slug = t.slug
     );

  get diagnostics parents = row_count;

  insert into app.categories
    (household_id, parent_id, template_slug, name, kind, sort_order, is_system)
  select target_household, parent.id, t.slug, t.name_es, t.kind, t.sort_order, true
    from app.category_templates t
    join app.categories parent
      on parent.household_id = target_household
     and parent.template_slug = t.parent_slug
   where t.parent_slug is not null
     and not exists (
       select 1 from app.categories c
        where c.household_id = target_household and c.template_slug = t.slug
     );

  get diagnostics children = row_count;

  return parents + children;
end;
$$;

grant execute on function app.seed_household_categories(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The households that already exist
-- ---------------------------------------------------------------------------
--
-- Every household created before migration 27 has no categories at all, so its
-- classifier has nowhere to file anything and its budgets have nothing to
-- budget. They are given the tree here rather than left waiting for somebody to
-- notice.
do $$
declare
  target uuid;
begin
  for target in
    select h.id from app.households h
     where h.deleted_at is null
       and not exists (select 1 from app.categories c where c.household_id = h.id)
  loop
    perform app.seed_household_categories(target);
  end loop;
end;
$$;

update platform.schema_version
   set version = 28,
       description = 'Invitations can actually be accepted, and every household finally has its categories',
       applied_at = now()
 where id;

-- ---------------------------------------------------------------------------
-- Seeing who else is in your household
-- ---------------------------------------------------------------------------
--
-- `profiles_select_self` limits `app.profiles` to `id = auth.uid()`, which is
-- the right default and was the only policy on the table. The consequence was
-- quiet: the access screen inner-joins members to profiles for their name and
-- email, and an inner join across a row-level filter does not error — it
-- returns fewer rows. So an owner who had invited their partner opened
-- «Accesos», saw one person, and had no way to tell whether the invitation had
-- ever been accepted.
--
-- Two narrow additions. A member may read the profile of somebody who shares a
-- household with them, and of an accountant they have granted access to. Both
-- are people the reader already knows they are working with; neither widens
-- the table to anybody else.
drop policy if exists profiles_select_household_peers on app.profiles;
create policy profiles_select_household_peers on app.profiles
  for select
  using (
    exists (
      select 1
        from app.household_members mine
        join app.household_members theirs
          on theirs.household_id = mine.household_id
       where mine.user_id = auth.uid()
         and mine.status = 'active'
         and theirs.user_id = app.profiles.id
         and theirs.status <> 'revoked'
    )
  );

drop policy if exists profiles_select_granted_accountants on app.profiles;
create policy profiles_select_granted_accountants on app.profiles
  for select
  using (
    exists (
      select 1
        from app.accountant_grants g
       where g.accountant_id = app.profiles.id
         and app.is_household_member(g.household_id)
    )
  );
