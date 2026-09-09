'use server';

import { recurringSeries } from '@app/database/schema';
import { addMonths, todayIn, type PlainDate } from '@app/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { currencyOf } from './household-context';
import { firstIssueKey, optionalPlainDate, positiveAmount, recordName } from './record-input';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Income: what the household earns, and when.
 *
 * An income is a recurring series with `direction = 'inflow'`. It is the same
 * object the recurrence engine produces from a statement, deliberately: a
 * salary a person declared and a salary the engine detected are the same
 * financial fact seen from two sides, and the difference between what was said
 * and what actually landed is only visible because both are stored the same way.
 *
 * The questionnaire created these and nothing could ever see them again. That
 * is what this file fixes.
 */

const FREQUENCIES = [
  'weekly',
  'biweekly',
  'semimonthly',
  'monthly',
  'quarterly',
  'annual',
] as const;

/**
 * How much the amount is allowed to wander. Zero is a stated figure — «2,400 on
 * the 15th». Fifteen percent is an approximation — «about 2,400 in a good
 * month» — and the plan is entitled to know which one it was told.
 */
const APPROXIMATE_VARIATION = '0.1500';
const EXACT_VARIATION = '0';

/**
 * Si el monto declarado ya trae descontado lo que sale de la planilla.
 *
 * `net` por defecto porque es lo que la gente escribe —lo que ve en el banco— y
 * porque es el lado conservador de los dos: sobreestimar el ingreso de alguien
 * es el error que hace daño. Sólo cambia una cifra para quien tenga compromisos
 * marcados «se descuenta de la planilla»; para todos los demás, los dos valores
 * producen exactamente el mismo plan.
 */
const BASES = ['net', 'gross'] as const;

const incomeInput = z.object({
  name: recordName,
  amount: positiveAmount,
  frequency: z.enum(FREQUENCIES),
  nextExpectedDate: optionalPlainDate,
  isApproximate: z.preprocess((value) => value === 'true' || value === 'on', z.boolean()),
  statedBasis: z.enum(BASES).default('net'),
});

const FIELD_ERRORS = {
  name: 'nameRequired',
  amount: 'amountInvalid',
  frequency: 'frequencyInvalid',
  nextExpectedDate: 'dateInvalid',
} as const;

function parse(formData: FormData) {
  return incomeInput.safeParse({
    name: formData.get('name'),
    amount: formData.get('amount'),
    frequency: formData.get('frequency'),
    nextExpectedDate: formData.get('nextExpectedDate'),
    isApproximate: formData.get('isApproximate'),
    statedBasis: formData.get('statedBasis') ?? 'net',
  });
}

export async function createIncome(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;
  const today = todayIn('America/Panama');
  const next = parsed.data.nextExpectedDate ?? nextFor(today, parsed.data.frequency);

  const [created] = await queryAsUser(session, (tx) =>
    tx
      .insert(recurringSeries)
      .values({
        householdId,
        ownerId: session.user.id,
        name: parsed.data.name,
        direction: 'inflow',
        expectedAmount: parsed.data.amount,
        statedBasis: parsed.data.statedBasis,
        currency: currencyOf(session, householdId),
        frequency: parsed.data.frequency,
        lastSeenOn: today,
        nextExpectedDate: next,
        // Stated by a person, so confidence in the *statement* is total. What is
        // uncertain is the amount, and the variation is where that is recorded.
        confidence: '1.000',
        amountVariation: parsed.data.isApproximate ? APPROXIMATE_VARIATION : EXACT_VARIATION,
        occurrenceCount: 0,
        isEssential: true,
        isActive: true,
        detectedBy: 'user',
        confirmedBy: session.user.id,
        confirmedAt: new Date(),
      })
      .returning({ id: recurringSeries.id }),
  );

  if (!created) return { error: 'createFailed' };

  revalidateFinancials(formData);
  return { created: created.id };
}

export async function updateIncome(
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
      .update(recurringSeries)
      .set({
        name: parsed.data.name,
        expectedAmount: parsed.data.amount,
        statedBasis: parsed.data.statedBasis,
        frequency: parsed.data.frequency,
        amountVariation: parsed.data.isApproximate ? APPROXIMATE_VARIATION : EXACT_VARIATION,
        ...(parsed.data.nextExpectedDate ? { nextExpectedDate: parsed.data.nextExpectedDate } : {}),
        // A corrected figure is a stated one again, whatever produced the row
        // first. Leaving it marked `system` would credit the engine with a
        // number a person typed.
        detectedBy: 'user',
        confirmedBy: session.user.id,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(recurringSeries.id, id.data),
          eq(recurringSeries.householdId, householdId),
          eq(recurringSeries.direction, 'inflow'),
          isNull(recurringSeries.deletedAt),
        ),
      )
      .returning({ id: recurringSeries.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * Retires an income.
 *
 * A soft delete, because the plan a household accepted last month was built on
 * this row and the record of that decision has to keep making sense. The series
 * stops counting toward what the month expects; it does not stop having existed.
 */
export async function removeIncome(
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
      .update(recurringSeries)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(recurringSeries.id, id.data),
          eq(recurringSeries.householdId, householdId),
          eq(recurringSeries.direction, 'inflow'),
          isNull(recurringSeries.deletedAt),
        ),
      )
      .returning({ id: recurringSeries.id }),
  );

  if (!removed) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

const FREQUENCY_MONTHS = {
  weekly: 0,
  biweekly: 0,
  semimonthly: 0,
  monthly: 1,
  quarterly: 3,
  annual: 12,
} as const;

const FREQUENCY_DAYS = { weekly: 7, biweekly: 14, semimonthly: 15 } as const;

/** When the next payment lands, if the household did not say. */
function nextFor(today: PlainDate, frequency: keyof typeof FREQUENCY_MONTHS): PlainDate {
  const months = FREQUENCY_MONTHS[frequency];
  if (months > 0) return addMonths(today, months);

  const days = FREQUENCY_DAYS[frequency as keyof typeof FREQUENCY_DAYS];
  const millis = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10)) + days,
  );
  return new Date(millis).toISOString().slice(0, 10) as PlainDate;
}
