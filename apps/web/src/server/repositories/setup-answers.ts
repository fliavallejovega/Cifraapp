import 'server-only';

import {
  accounts,
  debts,
  goals,
  householdPeople,
  householdSettings,
  obligations,
  recurringSeries,
} from '@app/database/schema';
import { and, asc, eq, isNull } from 'drizzle-orm';

import type { SetupInitial } from '@/components/setup-questionnaire';
import { trimAmount } from '@/lib/format';
import { queryAsUser, type Session } from '../session';

/**
 * What the household already told us, read back in the shape the questionnaire
 * asks it in.
 *
 * The questionnaire used to be a one-way door: answered once, then closed, and
 * `/welcome` bounced anybody who returned. That was wrong in the ordinary way
 * — a person mistypes a salary in the second minute of using a product and has
 * no way back to it — and wrong in a worse way too, because the settings screen
 * had been telling them they could re-answer it. A promise the code did not
 * keep.
 *
 * Reading the answers back is what makes returning a correction rather than a
 * second helping. Every row carries its id, so saving updates what is already
 * there instead of adding a duplicate beside it.
 *
 * Only what the questionnaire itself can express is read. A household that has
 * since imported statements has accounts with real balances and obligations the
 * recurrence engine found; those appear here as rows too, because hiding them
 * would let somebody "correct" their income and unknowingly leave a duplicate
 * of it standing.
 */

/**
 * The questionnaire's own shape, plus whether it has been answered.
 *
 * Typed as the form's `SetupInitial` rather than restated here, so a column
 * added to one of the six questions cannot quietly stop reaching the field
 * that asks about it.
 */
export interface SetupAnswers extends SetupInitial {
  /** Whether the questionnaire has been answered before. Changes every word. */
  readonly answered: boolean;
}

export async function loadSetupAnswers(
  session: Session,
  householdId: string,
): Promise<SetupAnswers> {
  return queryAsUser(session, async (tx) => {
    const [settings, peopleRows, accountRows, incomeRows, commitmentRows, debtRows, goalRows] =
      await Promise.all([
        tx
          .select({
            buffer: householdSettings.bufferMinimum,
            completedAt: householdSettings.onboardingCompletedAt,
          })
          .from(householdSettings)
          .where(eq(householdSettings.householdId, householdId))
          .limit(1),
        tx
          .select({
            id: householdPeople.id,
            name: householdPeople.displayName,
            relationship: householdPeople.relationship,
            isDependent: householdPeople.isDependent,
          })
          .from(householdPeople)
          .where(
            and(eq(householdPeople.householdId, householdId), isNull(householdPeople.deletedAt)),
          )
          .orderBy(asc(householdPeople.createdAt)),
        tx
          .select({
            id: accounts.id,
            name: accounts.name,
            accountType: accounts.accountType,
            balance: accounts.currentBalance,
          })
          .from(accounts)
          .where(
            and(
              and(eq(accounts.householdId, householdId), isNull(accounts.deletedAt)),
              eq(accounts.status, 'active'),
            ),
          )
          .orderBy(asc(accounts.createdAt)),
        tx
          .select({
            id: recurringSeries.id,
            name: recurringSeries.name,
            amount: recurringSeries.expectedAmount,
            frequency: recurringSeries.frequency,
            variation: recurringSeries.amountVariation,
          })
          .from(recurringSeries)
          .where(
            and(
              and(eq(recurringSeries.householdId, householdId), isNull(recurringSeries.deletedAt)),
              eq(recurringSeries.direction, 'inflow'),
              eq(recurringSeries.isActive, true),
            ),
          )
          .orderBy(asc(recurringSeries.createdAt)),
        tx
          .select({
            id: obligations.id,
            name: obligations.name,
            amount: obligations.expectedAmount,
            dueDate: obligations.dueDate,
            isEssential: obligations.isEssential,
          })
          .from(obligations)
          .where(and(eq(obligations.householdId, householdId), isNull(obligations.deletedAt)))
          .orderBy(asc(obligations.createdAt)),
        // The card behind a debt, when there is one, is where the limit and
        // the holder live — so the questionnaire can show them back.
        tx
          .select({
            id: debts.id,
            name: debts.name,
            balance: debts.currentBalance,
            apr: debts.apr,
            minimumPayment: debts.minimumPayment,
            creditLimit: debts.creditLimit,
            personName: householdPeople.displayName,
          })
          .from(debts)
          .leftJoin(accounts, eq(accounts.id, debts.accountId))
          .leftJoin(householdPeople, eq(householdPeople.id, accounts.personId))
          .where(and(eq(debts.householdId, householdId), isNull(debts.deletedAt)))
          .orderBy(asc(debts.createdAt)),
        tx
          .select({
            id: goals.id,
            name: goals.name,
            targetAmount: goals.targetAmount,
            targetDate: goals.targetDate,
            status: goals.status,
          })
          .from(goals)
          .where(and(eq(goals.householdId, householdId), eq(goals.status, 'active')))
          .orderBy(asc(goals.priority)),
      ]);

    return {
      people: peopleRows.map((row) => ({
        id: row.id,
        name: row.name,
        relationship: row.relationship,
        isDependent: row.isDependent,
      })),
      accounts: accountRows.map((row) => ({
        id: row.id,
        name: row.name,
        accountType: row.accountType as SetupInitial['accounts'][number]['accountType'],
        balance: trimAmount(row.balance),
      })),
      incomes: incomeRows.map((row) => ({
        id: row.id,
        name: row.name,
        amount: trimAmount(row.amount),
        frequency: row.frequency,
        // The variation is how "about 2,400" was recorded. Reading it back as
        // the checkbox keeps the two descriptions of one claim in step.
        isApproximate: Number(row.variation) > 0,
      })),
      commitments: commitmentRows.map((row) => ({
        id: row.id,
        name: row.name,
        amount: trimAmount(row.amount),
        // The questionnaire asks for a day of the month; the obligation stores
        // a date. The day is the part the person chose.
        dueDay: String(Number(row.dueDate.slice(8, 10))),
        isEssential: row.isEssential,
      })),
      debts: debtRows.map((row) => ({
        id: row.id,
        name: row.name,
        balance: trimAmount(row.balance),
        apr: trimAmount(row.apr),
        minimumPayment: trimAmount(row.minimumPayment),
        creditLimit: row.creditLimit ? trimAmount(row.creditLimit) : '',
        personName: row.personName ?? '',
      })),
      goals: goalRows.map((row) => ({
        id: row.id,
        name: row.name,
        targetAmount: trimAmount(row.targetAmount),
        targetDate: row.targetDate ?? '',
      })),
      bufferMinimum: settings[0]?.buffer ? trimAmount(settings[0].buffer) : '',
      answered: Boolean(settings[0]?.completedAt),
    };
  });
}
