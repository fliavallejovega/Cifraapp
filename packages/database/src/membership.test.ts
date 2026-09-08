import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';

/**
 * Joining a household.
 *
 * This file exists because the product shipped for weeks with invitations that
 * could be created, sent and opened but never accepted, and nothing caught it.
 * The reason nothing caught it is worth stating: every other test writes as
 * somebody who is already a member, and the only write in the system performed
 * by a non-member is the one that makes them a member. `household_members`
 * carries a single write policy requiring an owner, so the invited person's
 * insert was refused by the policy that exists to protect them.
 *
 * So the assertions here are deliberately from the outside. The invited person
 * is a stranger until the moment the token is redeemed, and the stranger is
 * also tested: the same link, in the wrong hands, must do nothing.
 */

const connectionUrl = process.env['TEST_DATABASE_URL'];
const describeWithDatabase = connectionUrl ? describe : describe.skip;

if (!connectionUrl) {
  console.warn('TEST_DATABASE_URL not set — skipping membership tests. Run `pnpm db:local` first.');
}

const OWNER = '55555555-5555-4555-8555-555555555555';
const INVITED = '66666666-6666-4666-8666-666666666666';
const STRANGER = '77777777-7777-4777-8777-777777777777';

const PEOPLE = [
  { id: OWNER, email: 'owner@members.test' },
  { id: INVITED, email: 'invited@members.test' },
  { id: STRANGER, email: 'stranger@members.test' },
] as const;

describeWithDatabase('joining a household', () => {
  const sql = postgres(connectionUrl ?? '', { prepare: false, max: 4, onnotice: () => undefined });

  /** Runs work the way a request runs it: as `authenticated`, with RLS on. */
  const as = async <T>(
    person: (typeof PEOPLE)[number],
    work: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> =>
    sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({
        sub: person.id,
        role: 'authenticated',
        email: person.email,
      })}, true)`;
      await tx`select set_config('role', 'authenticated', true)`;
      return work(tx);
    }) as Promise<T>;

  let householdId = '';

  const inviteToken = () => {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: createHash('sha256').update(token).digest('hex') };
  };

  const invite = async (email: string, role = 'member') => {
    const { hash } = inviteToken();
    await as(
      PEOPLE[0],
      (tx) => tx`
        insert into app.household_invitations
          (household_id, email, role, token_hash, invited_by, expires_at)
        values (${householdId}, ${email}, ${role}, ${hash}, ${OWNER}, now() + interval '7 days')
      `,
    );
    return hash;
  };

  const accept = async (person: (typeof PEOPLE)[number], hash: string) => {
    const rows = await as(
      person,
      (tx) =>
        tx<{ r: { state: string; householdId?: string } }[]>`
          select app.accept_invitation(${hash}) as r
        `,
    );
    return rows[0]?.r ?? { state: 'missing' };
  };

  beforeAll(async () => {
    for (const person of PEOPLE) {
      await sql`delete from auth.users where id = ${person.id}`;
      await sql`insert into auth.users (id, email) values (${person.id}, ${person.email})`;
      await sql`insert into app.profiles (id, email) values (${person.id}, ${person.email})`;
    }

    householdId = await as(PEOPLE[0], async (tx) => {
      const created = await tx<{ create_household: string }[]>`
        select app.create_household('Members', 'USD', 'America/Panama')
      `;
      return created[0]?.create_household ?? '';
    });
  });

  afterAll(async () => {
    if (householdId) await sql`delete from app.households where id = ${householdId}`;
    for (const person of PEOPLE) await sql`delete from auth.users where id = ${person.id}`;
    await sql.end();
  });

  it('lets an invited person accept, which no row-level policy would allow them to do', async () => {
    const hash = await invite('invited@members.test');

    // The insert the application used to attempt directly. It is refused, and
    // it should be: a policy loose enough to permit it would let anybody add
    // themselves to any household id they could guess.
    await expect(
      as(
        PEOPLE[1],
        (tx) => tx`
          insert into app.household_members (household_id, user_id, role, status)
          values (${householdId}, ${INVITED}, 'member', 'active')
        `,
      ),
    ).rejects.toThrow(/row-level security/i);

    expect(await accept(PEOPLE[1], hash)).toMatchObject({ state: 'ok', householdId });

    const members = await as(
      PEOPLE[0],
      (tx) => tx<{ user_id: string; role: string; status: string }[]>`
        select user_id, role, status from app.household_members
         where household_id = ${householdId} order by role
      `,
    );
    expect(members).toHaveLength(2);
    expect(members.find((row) => row.user_id === INVITED)).toMatchObject({
      role: 'member',
      status: 'active',
    });
  });

  it('refuses the same link to anybody it was not addressed to', async () => {
    const hash = await invite('invited@members.test');
    expect(await accept(PEOPLE[2], hash)).toMatchObject({ state: 'wrongAccount' });

    const joined = await sql<{ n: number }[]>`
      select count(*)::int as n from app.household_members
       where household_id = ${householdId} and user_id = ${STRANGER}
    `;
    expect(joined[0]?.n).toBe(0);
  });

  it('refuses a link that has already been used', async () => {
    const hash = await invite('invited@members.test');
    expect(await accept(PEOPLE[1], hash)).toMatchObject({ state: 'ok' });
    // Same token, second time. «Used» and «never existed» answer alike: the
    // link is a bearer credential and the difference is worth nothing to its
    // holder and something to an attacker.
    expect(await accept(PEOPLE[1], hash)).toMatchObject({ state: 'invalid' });
  });

  it('refuses an expired link', async () => {
    const { hash } = inviteToken();
    await sql`
      insert into app.household_invitations
        (household_id, email, role, token_hash, invited_by, expires_at)
      values (${householdId}, 'invited@members.test', 'member', ${hash}, ${OWNER},
              now() - interval '1 day')
    `;
    expect(await accept(PEOPLE[1], hash)).toMatchObject({ state: 'invalid' });
  });

  it('gives a member the whole household: read, write and edit what somebody else entered', async () => {
    const hash = await invite('invited@members.test');
    await accept(PEOPLE[1], hash);

    const owned = await as(
      PEOPLE[0],
      (tx) => tx<{ id: string }[]>`
        insert into app.accounts (household_id, name, account_type, currency, created_by)
        values (${householdId}, 'Cuenta del dueño', 'checking', 'USD', ${OWNER})
        returning id
      `,
    );
    const accountId = owned[0]?.id ?? '';

    // The invited person sees it, adds their own, and corrects the owner's.
    const seen = await as(
      PEOPLE[1],
      (tx) => tx<{ name: string }[]>`
        select name from app.accounts where household_id = ${householdId}
      `,
    );
    expect(seen.map((row) => row.name)).toContain('Cuenta del dueño');

    const edited = await as(
      PEOPLE[1],
      (tx) => tx<{ name: string }[]>`
        update app.accounts set name = 'Corregida por el invitado'
         where id = ${accountId} returning name
      `,
    );
    expect(edited[0]?.name).toBe('Corregida por el invitado');

    const entered = await as(
      PEOPLE[1],
      (tx) => tx<{ id: string }[]>`
        insert into app.transactions (
          household_id, account_id, transaction_date, amount, currency, direction,
          description_original, description_normalized, scope, status, source, fingerprint
        )
        values (${householdId}, ${accountId}, current_date, -45.50, 'USD', 'outflow',
                'SUPER 99', 'super 99', 'household', 'posted', 'user', ${randomBytes(8).toString('hex')})
        returning id
      `,
    );
    expect(entered[0]?.id).toBeTruthy();

    const ownerSees = await as(
      PEOPLE[0],
      (tx) => tx<{ n: number }[]>`
        select count(*)::int as n from app.transactions where household_id = ${householdId}
      `,
    );
    expect(ownerSees[0]?.n).toBe(1);
  });

  it('shows members each other by name, and shows nobody else anything', async () => {
    const hash = await invite('invited@members.test');
    await accept(PEOPLE[1], hash);

    // The access screen inner-joins members to profiles. Before the peer
    // policy existed this returned one row instead of two — silently, because
    // an inner join across a row-level filter does not error, it just drops.
    const roster = await as(
      PEOPLE[0],
      (tx) => tx<{ email: string }[]>`
        select p.email from app.household_members m
          join app.profiles p on p.id = m.user_id
         where m.household_id = ${householdId}
      `,
    );
    expect(roster.map((row) => row.email).sort()).toEqual([
      'invited@members.test',
      'owner@members.test',
    ]);

    const outsider = await as(
      PEOPLE[2],
      (tx) => tx<{ accounts: number; profiles: number }[]>`
        select
          (select count(*)::int from app.accounts where household_id = ${householdId}) as accounts,
          (select count(*)::int from app.profiles where id = ${OWNER}) as profiles
      `,
    );
    expect(outsider[0]).toMatchObject({ accounts: 0, profiles: 0 });
  });

  it('does not let a member re-role the owner', async () => {
    const hash = await invite('invited@members.test');
    await accept(PEOPLE[1], hash);

    const attempt = await as(
      PEOPLE[1],
      (tx) => tx<{ role: string }[]>`
        update app.household_members set role = 'viewer'
         where household_id = ${householdId} and user_id = ${OWNER}
        returning role
      `,
    );
    // Refused by the policy, and refused quietly: an update that matches no
    // visible row changes nothing rather than raising.
    expect(attempt).toHaveLength(0);
  });

  it('gives a household its categories, so a member has somewhere to file things', async () => {
    const seeded = await sql<{ n: number }[]>`
      select count(*)::int as n from app.categories where household_id = ${householdId}
    `;
    expect(seeded[0]?.n).toBeGreaterThan(0);
  });
});
