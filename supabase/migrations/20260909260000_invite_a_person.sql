-- Invitar a una persona, no a una dirección suelta.
--
-- El hogar ya tenía dos listas que hablaban de la misma gente sin conocerse. En
-- Personas están Davo y Blei —a quienes el dinero tiene que alcanzar—, y en
-- Accesos están las cuentas que entran al sistema. Nada unía a «Blei» la
-- persona con «blei@…» la cuenta, así que la pregunta más simple que se le hace
-- a esa lista —¿Blei tiene manera de entrar?— no tenía respuesta en ninguna de
-- las dos pantallas.
--
-- El enlace ya existía en `household_people.member_id` y nada lo llenaba nunca,
-- porque el único momento en que se puede llenar es cuando alguien acepta una
-- invitación, y la invitación no sabía para quién era. Ahora lo sabe, y
-- `accept_invitation` cierra el círculo en la misma transacción en que crea la
-- membresía.

alter table app.household_invitations
  add column if not exists person_id uuid references app.household_people (id) on delete set null;

comment on column app.household_invitations.person_id is
  'Which person of the household this invitation is for, so accepting it links the membership to them. Null is an ordinary invitation to an address nobody has named yet.';

create index if not exists household_invitations_person_idx
  on app.household_invitations (person_id) where person_id is not null;

-- Se reescribe entera, no se parchea: una función así se lee de arriba abajo
-- para auditarla, y una versión parcial obliga a reconstruirla de memoria.
create or replace function app.accept_invitation(invitation_token_hash text)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'app', 'public', 'pg_temp'
as $function$
declare
  caller        uuid := auth.uid();
  caller_email  text;
  invitation    app.household_invitations;
  new_member_id uuid;
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
         updated_at = now()
  returning id into new_member_id;

  -- Y si la invitación era para alguien de la lista de personas, queda unida a
  -- su cuenta aquí, en la misma transacción que la creó. Hacerlo después, desde
  -- la aplicación, deja una ventana en la que la membresía existe y nadie sabe
  -- de quién es.
  --
  -- `member_id` es único: si esa persona ya tenía una cuenta enlazada, la
  -- invitación no se la roba a la anterior, se queda sin enlazar y la pantalla
  -- lo muestra como una cuenta sin persona.
  if invitation.person_id is not null and new_member_id is not null then
    update app.household_people
       set member_id = new_member_id,
           updated_at = now()
     where id = invitation.person_id
       and household_id = invitation.household_id
       and member_id is null
       and not exists (
         select 1 from app.household_people other
          where other.member_id = new_member_id
       );
  end if;

  update app.household_invitations
     set accepted_at = now(),
         accepted_by = caller
   where id = invitation.id;

  -- The household's own trail: a membership appearing without a record of who
  -- let them in is the first question anybody asks afterwards.
  insert into audit.events (actor_user_id, action, entity_type, entity_id, household_id, metadata)
  values (caller, 'household.member.joined', 'household_member', invitation.household_id,
          invitation.household_id,
          jsonb_build_object('role', invitation.role, 'invitedBy', invitation.invited_by,
                             'personId', invitation.person_id));

  -- The category tree, for a household created before migration 27 or by a
  -- path that skipped it. Idempotent, and the caller is a member by now.
  perform app.seed_household_categories(invitation.household_id);

  return jsonb_build_object('state', 'ok', 'householdId', invitation.household_id);
end;
$function$;
