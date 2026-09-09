'use server';

import { nextOccurrence } from '@app/budget-engine';
import type { Database } from '@app/database';
import { commitmentSettlements, obligations } from '@app/database/schema';
import { addDays, addMonths, plainDateFromParts, todayIn, type PlainDate } from '@app/domain';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
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
import { currentOccurrenceUnpaid } from './repositories/commitment-settlement';
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

/**
 * How far ahead «estoy al día» reaches.
 *
 * The same thirty days the plan counts as committed, and deliberately the same
 * number: a button that settled a wider window than the screen showed would
 * clear claims the household never saw.
 */
const SETTLEMENT_HORIZON_DAYS = 30;

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

/**
 * Recording that a commitment has been paid.
 *
 * This is what the product was missing on the day a household finished paying
 * everything and still read that it owed $1,835.99. Both figures came from the
 * same rows; the difference was that nothing let anybody say «that one is
 * done». A commitment could only be settled by a real transaction, and until a
 * statement is imported there are no transactions.
 *
 * Settling does two things, and the second is the one that keeps the answer
 * honest a month later. It writes the settlement — which occurrence, how much,
 * who said so — and then rolls the commitment on to its next occurrence. Rent
 * paid in September is not rent cancelled: it is rent due again in October, and
 * a product that quietly retired it would replace a wrong number with a
 * comfortable one, which is worse.
 *
 * A one-off has nowhere to roll to. It keeps its date and is excluded from what
 * is owed by its settlement row instead (`currentOccurrenceUnpaid`).
 */

/** What the household is asserting, per row. */
const SETTLE_INTENTS = ['settle', 'unsettle'] as const;

export async function settleCommitment(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const intent = z.enum(SETTLE_INTENTS).safeParse(formData.get('intent') ?? 'settle');
  if (!intent.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;
  // «Today» belongs to where the household stands, not to the server.
  const timeZone =
    session.households.find((entry) => entry.id === householdId)?.timeZone ?? 'America/Panama';
  const settledOn = todayIn(timeZone);

  const changed = await queryAsUser(session, async (tx) => {
    const [row] = await tx
      .select({
        id: obligations.id,
        dueDate: obligations.dueDate,
        expectedAmount: obligations.expectedAmount,
        currency: obligations.currency,
        frequency: obligations.frequency,
        anchorDays: obligations.anchorDays,
      })
      .from(obligations)
      .where(
        and(
          eq(obligations.id, id.data),
          eq(obligations.householdId, householdId),
          isNull(obligations.deletedAt),
        ),
      )
      .limit(1);

    if (!row) return false;

    if (intent.data === 'unsettle') {
      return undoSettlement(tx, householdId, row);
    }

    return applySettlement(tx, householdId, session.user.id, settledOn, row);
  });

  if (!changed) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/** Every cadence the recurrence engine knows how to step forward. */
const CADENCES = [
  'daily',
  'weekly',
  'biweekly',
  'semimonthly',
  'monthly',
  'quarterly',
  'annual',
] as const;

type Cadence = (typeof CADENCES)[number];

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

interface SettleableRow {
  readonly id: string;
  readonly dueDate: string;
  readonly expectedAmount: string;
  readonly currency: string;
  readonly frequency: string | null;
  readonly anchorDays: number[] | null;
}

function cadenceOf(frequency: string | null): Cadence | null {
  return CADENCES.find((value) => value === frequency) ?? null;
}

/**
 * Writes the settlement and rolls the commitment to its next occurrence.
 *
 * The insert is `do nothing` on conflict rather than an error: two taps on the
 * same button is a slip, not an attempt to pay the rent twice, and the unique
 * constraint on (obligation, occurrence) is what makes ignoring it safe. But a
 * conflict must not roll the date on a second time — that would skip a month —
 * so the advance is conditional on the insert having actually written a row.
 */
async function applySettlement(
  tx: Tx,
  householdId: string,
  userId: string,
  settledOn: PlainDate,
  row: SettleableRow,
): Promise<boolean> {
  const dueOn = row.dueDate as PlainDate;

  const written = await tx
    .insert(commitmentSettlements)
    .values({
      householdId,
      obligationId: row.id,
      dueOn,
      amount: row.expectedAmount,
      currency: row.currency,
      method: 'declared',
      settledOn,
      declaredBy: userId,
    })
    .onConflictDoNothing({
      target: [commitmentSettlements.obligationId, commitmentSettlements.dueOn],
    })
    .returning({ id: commitmentSettlements.id });

  if (written.length === 0) return true;

  const cadence = cadenceOf(row.frequency);
  if (!cadence) return true;

  const anchors = row.anchorDays ?? undefined;
  const nextDue = nextOccurrence(cadence, dueOn, anchors);

  await tx
    .update(obligations)
    .set({
      dueDate: nextDue,
      nextExpectedDate: nextOccurrence(cadence, nextDue, anchors),
      updatedAt: new Date(),
    })
    .where(and(eq(obligations.id, row.id), eq(obligations.householdId, householdId)));

  return true;
}

/**
 * Takes back the most recent settlement, and the roll-forward with it.
 *
 * Undo has to move the date back as well as delete the row, or the commitment
 * keeps the October date it was given while October's payment no longer exists
 * — a month silently skipped, which is the exact failure the settlement record
 * was built to prevent.
 */
async function undoSettlement(tx: Tx, householdId: string, row: SettleableRow): Promise<boolean> {
  const [latest] = await tx
    .select({ id: commitmentSettlements.id, dueOn: commitmentSettlements.dueOn })
    .from(commitmentSettlements)
    .where(
      and(
        eq(commitmentSettlements.obligationId, row.id),
        eq(commitmentSettlements.householdId, householdId),
      ),
    )
    .orderBy(desc(commitmentSettlements.dueOn))
    .limit(1);

  if (!latest) return false;

  await tx
    .delete(commitmentSettlements)
    .where(
      and(
        eq(commitmentSettlements.id, latest.id),
        eq(commitmentSettlements.householdId, householdId),
      ),
    );

  const cadence = cadenceOf(row.frequency);
  const restored = latest.dueOn as PlainDate;

  await tx
    .update(obligations)
    .set({
      dueDate: restored,
      ...(cadence
        ? { nextExpectedDate: nextOccurrence(cadence, restored, row.anchorDays ?? undefined) }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(obligations.id, row.id), eq(obligations.householdId, householdId)));

  return true;
}

/**
 * «Estoy al día»: every claim in the current window, declared paid at once.
 *
 * Scoped to the same thirty-day window the plan counts, and never wider. A
 * button that silently settled a commitment falling in March would be the
 * product deciding something the household did not say, on a financial record —
 * and the household would have no way to see that it had happened.
 *
 * The screen shows the count and the total before this runs, so what is being
 * asserted is on screen in figures before it is asserted. Each one still
 * becomes its own settlement row, so a single wrong one can be taken back
 * without undoing the rest.
 */
export async function settleDueCommitments(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;
  const timeZone =
    session.households.find((entry) => entry.id === householdId)?.timeZone ?? 'America/Panama';
  const settledOn = todayIn(timeZone);
  const horizon = addDays(settledOn, SETTLEMENT_HORIZON_DAYS);

  await queryAsUser(session, async (tx) => {
    const rows = await tx
      .select({
        id: obligations.id,
        dueDate: obligations.dueDate,
        expectedAmount: obligations.expectedAmount,
        currency: obligations.currency,
        frequency: obligations.frequency,
        anchorDays: obligations.anchorDays,
      })
      .from(obligations)
      .where(
        and(
          eq(obligations.householdId, householdId),
          isNull(obligations.deletedAt),
          isNull(obligations.settledTransactionId),
          eq(obligations.isDeductedAtSource, false),
          lte(obligations.dueDate, horizon),
          currentOccurrenceUnpaid,
        ),
      );

    // Sequential on purpose: each settlement reads and then rewrites its own
    // commitment's due date, and running them together on one connection buys
    // nothing while making a partial failure harder to reason about.
    for (const row of rows) {
      await applySettlement(tx, householdId, session.user.id, settledOn, row);
    }
  });

  revalidateFinancials(formData);
  return { ok: true };
}
