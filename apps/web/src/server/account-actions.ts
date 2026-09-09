'use server';

import { accounts } from '@app/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { normalizeTypedAmount } from './amount';
import { ACCOUNT_TYPES } from './repositories/accounts';
import { loadSession, queryAsUser } from './session';

/**
 * Account management.
 *
 * The entry point for every figure in the product: nothing can be imported,
 * planned or reported before an account exists to file it against. It stayed
 * missing for a long time and every engine downstream was reading rows the
 * interface could not create.
 *
 * Two rules shape what these actions will and will not do:
 *
 *   - A balance is a decimal string all the way to the column. `Money` parses
 *     it, and no step in between is allowed to be a `number` (ADR-005).
 *   - An account is never deleted. Movements point at it, and destroying it
 *     would silently rewrite history. It is archived, and archiving says so.
 */

export interface AccountActionResult {
  readonly error?: string;
  readonly created?: string;
}

const amountSchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,4})?$/)
  // A household balance past a trillion is a typo, not a fortune, and the
  // column is numeric(19,4).
  .refine((value) => (value.replace(/^-/, '').split('.')[0] ?? '').length <= 12);

const accountInput = z.object({
  name: z.string().trim().min(1).max(120),
  accountType: z.enum(ACCOUNT_TYPES),
  balance: amountSchema,
  maskedNumber: z.string().trim().max(4).regex(/^\d*$/).optional(),
  /**
   * Whose account this is.
   *
   * Empty means the household's, which is a real answer and not a missing one.
   * Without it a house of two people holding six accounts between them can see
   * one total and never each person's, which is the number they actually argue
   * about — and it is also what tells «Visa Davo» from «Visa Blei» when a
   * statement is imported.
   */
  personId: z.union([z.uuid(), z.literal('')]).optional(),
});

function parse(formData: FormData) {
  return accountInput.safeParse({
    name: formData.get('name'),
    accountType: formData.get('accountType'),
    balance: normalizeTypedAmount(formData.get('balance')),
    maskedNumber: normalizeMask(formData.get('maskedNumber')),
    personId: formData.get('personId') ?? '',
  });
}

function normalizeMask(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const digits = raw.replace(/\D/g, '');
  // Only the last four are ever kept. A full account number pasted in here is
  // truncated rather than rejected, and never reaches the database.
  return digits === '' ? undefined : digits.slice(-4);
}

function messageFor(issuePath: PropertyKey | undefined): string {
  if (issuePath === 'name') return 'nameRequired';
  if (issuePath === 'balance') return 'balanceInvalid';
  if (issuePath === 'maskedNumber') return 'maskInvalid';
  return 'typeInvalid';
}

export async function createAccount(
  _previous: AccountActionResult,
  formData: FormData,
): Promise<AccountActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: messageFor(parsed.error.issues[0]?.path[0]) };

  const householdId = session.activeHouseholdId;
  // An empty choice means the household's, which is an answer and not a blank.
  const owner = parsed.data.personId === '' ? null : (parsed.data.personId ?? null);
  const currency =
    session.households.find((household) => household.id === householdId)?.baseCurrency.trim() ??
    'USD';

  const [created] = await queryAsUser(session, (tx) =>
    tx
      .insert(accounts)
      .values({
        householdId,
        ownerId: session.user.id,
        createdBy: session.user.id,
        name: parsed.data.name,
        accountType: parsed.data.accountType,
        currency,
        currentBalance: parsed.data.balance,
        ...(parsed.data.maskedNumber ? { maskedNumber: parsed.data.maskedNumber } : {}),
        status: 'active',
        source: 'user',
        personId: owner,
        // Personal when it belongs to somebody, the household's otherwise. The
        // two travel together so a screen never has to guess one from the other.
        scope: owner === null ? 'household' : 'personal',
      })
      .returning({ id: accounts.id }),
  );

  if (!created) return { error: 'createFailed' };

  revalidateProduct(formData);
  return { created: created.id };
}

export async function updateAccount(
  _previous: AccountActionResult,
  formData: FormData,
): Promise<AccountActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: messageFor(parsed.error.issues[0]?.path[0]) };

  const householdId = session.activeHouseholdId;
  // An empty choice means the household's, which is an answer and not a blank.
  const owner = parsed.data.personId === '' ? null : (parsed.data.personId ?? null);

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(accounts)
      .set({
        name: parsed.data.name,
        accountType: parsed.data.accountType,
        currentBalance: parsed.data.balance,
        maskedNumber: parsed.data.maskedNumber ?? null,
        personId: owner,
        scope: owner === null ? 'household' : 'personal',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(accounts.id, id.data),
          eq(accounts.householdId, householdId),
          isNull(accounts.deletedAt),
        ),
      )
      .returning({ id: accounts.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateProduct(formData);
  return {};
}

/**
 * Archives an account, or brings an archived one back.
 *
 * Never a delete. The movements filed against it stay where they are and keep
 * pointing at an account that still exists; an archived account simply stops
 * counting toward the position and stops being offered as an import target.
 */
export async function setAccountStatus(
  _previous: AccountActionResult,
  formData: FormData,
): Promise<AccountActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  const status = z.enum(['active', 'archived']).safeParse(formData.get('status'));
  if (!id.success || !status.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(accounts)
      .set({ status: status.data, updatedAt: new Date() })
      .where(
        and(
          eq(accounts.id, id.data),
          eq(accounts.householdId, householdId),
          isNull(accounts.deletedAt),
        ),
      )
      .returning({ id: accounts.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateProduct(formData);
  return {};
}

/**
 * An account balance moves the position, the plan and the statements at once.
 * Refreshing only the page that submitted would leave the other three showing a
 * figure that is no longer true.
 */
function revalidateProduct(formData: FormData): void {
  const raw = formData.get('locale');
  const locale = raw === 'en' ? 'en' : 'es';
  for (const path of ['accounts', 'overview', 'plan', 'reports', 'documents']) {
    revalidatePath(`/${locale}/${path}`);
  }
}
