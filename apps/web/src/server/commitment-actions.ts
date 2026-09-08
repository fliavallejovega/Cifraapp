'use server';

import { obligations } from '@app/database/schema';
import { addMonths, plainDateFromParts, todayIn, type PlainDate } from '@app/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { currencyOf } from './household-context';
import {
  checkbox,
  dayOfMonth,
  firstIssueKey,
  optionalUuid,
  positiveAmount,
  recordName,
} from './record-input';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Commitments: rent, the school, the light bill, the internet.
 *
 * These are what «available» actually means. A balance of $4,350 with $1,610 of
 * this already promised is not $4,350, and the difference between those two
 * figures is the whole reason the product exists.
 *
 * A commitment is entered as a day of the month, not a date, because that is
 * how people hold it: rent is «the first», not «2026-09-01». The day is
 * resolved into the next occurrence here, clamped into short months so the 31st
 * lands on the 28th of February rather than failing.
 */

const FREQUENCIES = ['monthly', 'weekly', 'biweekly', 'quarterly', 'annual'] as const;

const commitmentInput = z.object({
  name: recordName,
  expectedAmount: positiveAmount,
  dueDay: dayOfMonth,
  frequency: z.enum(FREQUENCIES),
  isEssential: checkbox,
  categoryId: optionalUuid,
});

const FIELD_ERRORS = {
  name: 'nameRequired',
  expectedAmount: 'amountInvalid',
  dueDay: 'dayInvalid',
  frequency: 'frequencyInvalid',
} as const;

function parse(formData: FormData) {
  return commitmentInput.safeParse({
    name: formData.get('name'),
    expectedAmount: formData.get('expectedAmount'),
    dueDay: formData.get('dueDay'),
    frequency: formData.get('frequency') ?? 'monthly',
    isEssential: formData.get('isEssential'),
    categoryId: formData.get('categoryId'),
  });
}

export async function createCommitment(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;
  const due = nextDueOn(todayIn('America/Panama'), parsed.data.dueDay);

  const [created] = await queryAsUser(session, (tx) =>
    tx
      .insert(obligations)
      .values({
        householdId,
        name: parsed.data.name,
        expectedAmount: parsed.data.expectedAmount,
        currency: currencyOf(session, householdId),
        dueDate: due,
        frequency: parsed.data.frequency,
        nextExpectedDate: addMonths(due, 1),
        isEssential: parsed.data.isEssential,
        detectedBy: 'user',
        ...(parsed.data.categoryId ? { categoryId: parsed.data.categoryId } : {}),
      })
      .returning({ id: obligations.id }),
  );

  if (!created) return { error: 'createFailed' };

  revalidateFinancials(formData);
  return { created: created.id };
}

export async function updateCommitment(
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
  const due = nextDueOn(todayIn('America/Panama'), parsed.data.dueDay);

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(obligations)
      .set({
        name: parsed.data.name,
        expectedAmount: parsed.data.expectedAmount,
        dueDate: due,
        frequency: parsed.data.frequency,
        nextExpectedDate: addMonths(due, 1),
        isEssential: parsed.data.isEssential,
        categoryId: parsed.data.categoryId ?? null,
        detectedBy: 'user',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(obligations.id, id.data),
          eq(obligations.householdId, householdId),
          isNull(obligations.deletedAt),
        ),
      )
      .returning({ id: obligations.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

export async function removeCommitment(
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
      .update(obligations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(obligations.id, id.data),
          eq(obligations.householdId, householdId),
          isNull(obligations.deletedAt),
        ),
      )
      .returning({ id: obligations.id }),
  );

  if (!removed) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * The next time a claim falls due.
 *
 * Today still counts as due: rent due today is not next month's problem, and
 * hiding it would overstate what is available right now.
 */
function nextDueOn(today: PlainDate, day: number): PlainDate {
  const [year = '0', month = '1'] = today.split('-');
  const lastDayThisMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const candidate = plainDateFromParts(
    Number(year),
    Number(month),
    Math.min(day, lastDayThisMonth),
  );
  return candidate >= today ? candidate : addMonths(candidate, 1);
}
