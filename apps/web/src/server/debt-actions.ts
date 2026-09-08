'use server';

import { debts } from '@app/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { currencyOf } from './household-context';
import {
  firstIssueKey,
  optionalAmount,
  percentageRate,
  positiveAmount,
  recordName,
} from './record-input';
import { revalidateFinancials, revalidateScreen } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Debts: what is owed, at what rate, and what has to be paid this month.
 *
 * The rate is the figure that earns the product its keep. «Put $2,590 against
 * this card because it charges 24.5%» is only defensible because 24.5 is a
 * number the household stated and can correct — which, until this file, it
 * could not.
 *
 * A balance is never inferred from the linked account. The account holds what
 * the bank says today; the debt holds what the household is managing. They are
 * usually the same figure and the day they differ, silently overwriting one
 * with the other would destroy the discrepancy that matters.
 */

const optionalDay = z.preprocess(
  (value) => (value === '' || value === undefined || value === null ? undefined : value),
  z.coerce.number().int().min(1).max(31).optional(),
);

const debtInput = z.object({
  name: recordName,
  currentBalance: positiveAmount,
  apr: percentageRate,
  minimumPayment: positiveAmount,
  dueDay: optionalDay,
  statementDay: optionalDay,
  creditLimit: optionalAmount,
});

const FIELD_ERRORS = {
  name: 'nameRequired',
  currentBalance: 'balanceInvalid',
  apr: 'aprInvalid',
  minimumPayment: 'minimumInvalid',
  dueDay: 'dayInvalid',
  statementDay: 'dayInvalid',
  creditLimit: 'limitInvalid',
} as const;

function parse(formData: FormData) {
  return debtInput.safeParse({
    name: formData.get('name'),
    currentBalance: formData.get('currentBalance'),
    apr: formData.get('apr'),
    minimumPayment: formData.get('minimumPayment'),
    dueDay: formData.get('dueDay'),
    statementDay: formData.get('statementDay'),
    creditLimit: formData.get('creditLimit'),
  });
}

export async function createDebt(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;

  const [created] = await queryAsUser(session, (tx) =>
    tx
      .insert(debts)
      .values({
        householdId,
        name: parsed.data.name,
        // Nothing here knows the original amount borrowed, and inventing one
        // would put a figure nobody stated into a financial column.
        principal: parsed.data.currentBalance,
        currentBalance: parsed.data.currentBalance,
        currency: currencyOf(session, householdId),
        apr: parsed.data.apr,
        minimumPayment: parsed.data.minimumPayment,
        ...(parsed.data.dueDay === undefined ? {} : { dueDay: parsed.data.dueDay }),
        ...(parsed.data.statementDay === undefined
          ? {}
          : { statementDay: parsed.data.statementDay }),
        ...(parsed.data.creditLimit ? { creditLimit: parsed.data.creditLimit } : {}),
      })
      .returning({ id: debts.id }),
  );

  if (!created) return { error: 'createFailed' };

  revalidateFinancials(formData);
  return { created: created.id };
}

export async function updateDebt(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(debts)
      .set({
        name: parsed.data.name,
        currentBalance: parsed.data.currentBalance,
        apr: parsed.data.apr,
        minimumPayment: parsed.data.minimumPayment,
        dueDay: parsed.data.dueDay ?? null,
        statementDay: parsed.data.statementDay ?? null,
        creditLimit: parsed.data.creditLimit ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(debts.id, id.data), eq(debts.householdId, householdId), isNull(debts.deletedAt)),
      )
      .returning({ id: debts.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  revalidateScreen(formData, `debts/${id.data}`);
  return { ok: true };
}

/**
 * Removes a debt.
 *
 * Soft, and for the same reason as everywhere else: a payoff plan the household
 * accepted names this balance, and a plan whose lines point at nothing is not a
 * record of a decision.
 */
export async function removeDebt(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const [removed] = await queryAsUser(session, (tx) =>
    tx
      .update(debts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(debts.id, id.data), eq(debts.householdId, householdId), isNull(debts.deletedAt)),
      )
      .returning({ id: debts.id }),
  );

  if (!removed) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}
