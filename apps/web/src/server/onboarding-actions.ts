'use server';

import {
  accounts,
  debts,
  goals,
  householdPeople,
  householdSettings,
  households,
  obligations,
  recurringSeries,
} from '@app/database/schema';
import { addMonths, plainDateFromParts, todayIn, type PlainDate } from '@app/domain';
import { and, eq, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { normalizeTypedAmount } from './amount';
import { loadSession, queryAsUser } from './session';

/**
 * Setup: what the household tells us before there is any data to read.
 *
 * The engines were all built to read rows — obligations, debts, goals, a buffer,
 * a household size — and nothing in the product ever created them. A person
 * could sign up, land on a plan screen and be told, correctly and uselessly,
 * that nothing claims their money. The questionnaire is what makes the first
 * plan real on day one, before a single statement has been imported.
 *
 * Everything it collects already had a home in the schema. An income is a
 * recurring series; a monthly commitment is an obligation with a due date; a
 * card is a debt with its rate and minimum; a plan for the future is a goal.
 * Nothing is stored as an answer to a question — it is stored as the financial
 * object it describes, so the engines read it without knowing where it came
 * from.
 *
 * Every figure is provenance-marked `user`: stated, not measured. When
 * statements arrive and the recurrence engine sees the real amounts, the
 * difference between what was said and what happened is a fact worth having,
 * and it only exists because the stated version was recorded honestly.
 */

export interface SetupResult {
  readonly error?: string;
  readonly ok?: true;
}

const amount = z.preprocess(
  normalizeTypedAmount,
  z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .refine((value) => (value.split('.')[0] ?? '').length <= 12),
);

const optionalAmount = z.preprocess(
  (value) => (value === '' || value === undefined || value === null ? undefined : value),
  amount.optional(),
);

const name = z.string().trim().min(1).max(120);

/**
 * The row this answer corrects, when there is one.
 *
 * Absent on a first pass and on anything added later, so absence means insert
 * and presence means update. Carrying it is what turns a second visit to the
 * questionnaire into a correction instead of a second helping — without it,
 * somebody fixing a mistyped salary would end up with both the wrong figure
 * and the right one, and the plan would add them together.
 */
const rowId = z.uuid().optional();

const dueDay = z.coerce.number().int().min(1).max(31);

const RELATIONSHIPS = ['self', 'partner', 'child', 'parent', 'sibling', 'other'] as const;

const setupInput = z.object({
  // Who lives here, by name. The counts below are derived from this list by the
  // form, so the figure the plan reads and the list a person can edit are the
  // same fact rather than two records of it.
  people: z
    .array(
      z.object({
        id: rowId,
        name,
        relationship: z.enum(RELATIONSHIPS),
        isDependent: z.boolean(),
      }),
    )
    .max(20)
    .default([]),
  memberCount: z.coerce.number().int().min(1).max(50),
  dependentCount: z.coerce.number().int().min(0).max(50),
  bufferMinimum: optionalAmount,
  incomes: z
    .array(
      z.object({
        id: rowId,
        name,
        amount,
        frequency: z.enum(['weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'annual']),
        // "About 2,400 in a good month" and "2,400 on the 15th" are different
        // claims, and a plan built on the first should not pretend otherwise.
        isApproximate: z.boolean(),
      }),
    )
    .max(20),
  accounts: z
    .array(
      z.object({
        id: rowId,
        name,
        accountType: z.enum(['checking', 'savings', 'cash', 'digital_wallet']),
        balance: amount,
      }),
    )
    .max(20),
  commitments: z
    .array(z.object({ id: rowId, name, amount, dueDay, isEssential: z.boolean() }))
    .max(40),
  debts: z
    .array(
      z.object({
        id: rowId,
        name,
        balance: amount,
        /** Present when the debt is a credit card: what it can be spent up to. */
        creditLimit: optionalAmount,
        /** Whose card, by the name given on the first step. Empty is the household's. */
        personName: z.string().trim().max(120).optional(),
        // A percentage: "24.5" means 24.5%. Bounded because a rate past 200%
        // is a figure entered in the wrong field, not a loan.
        apr: z.preprocess(
          normalizeTypedAmount,
          z
            .string()
            .regex(/^\d+(\.\d{1,3})?$/)
            .refine((value) => Number(value) <= 200),
        ),
        minimumPayment: amount,
      }),
    )
    .max(20),
  goals: z
    .array(z.object({ id: rowId, name, targetAmount: amount, targetDate: z.string().optional() }))
    .max(20),
});

export type SetupInput = z.infer<typeof setupInput>;

/**
 * The rows that must survive an archive sweep.
 *
 * Not «the ids the form sent» — that was the first version and it was wrong in
 * the worst possible way: on a first pass no row carries an id yet, so the
 * sweep that follows the inserts archived everything that had just been
 * inserted, and a household finished the questionnaire with nothing to show
 * for it. What survives is what the save touched, which means the ids updated
 * *and* the ids created, collected as the loop goes.
 *
 * The sentinel keeps `not in ()` from being empty, which Postgres would read
 * as «archive nothing» — the opposite mistake, and just as silent.
 */
const survivors = (ids: readonly string[]): string[] =>
  ids.length > 0 ? [...ids] : ['00000000-0000-0000-0000-000000000000'];

export async function completeSetup(
  _previous: SetupResult,
  formData: FormData,
): Promise<SetupResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const raw = formData.get('payload');
  if (typeof raw !== 'string') return { error: 'invalid' };

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { error: 'invalid' };
  }

  const parsed = setupInput.safeParse(decoded);
  if (!parsed.success) return { error: 'invalid' };

  const answers = parsed.data;
  if (answers.dependentCount > answers.memberCount) return { error: 'dependentsExceedMembers' };

  const householdId = session.activeHouseholdId;

  try {
    await queryAsUser(session, async (tx) => {
      const [household] = await tx
        .select({ currency: households.baseCurrency, timeZone: households.timeZone })
        .from(households)
        .where(eq(households.id, householdId))
        .limit(1);

      const currency = household?.currency.trim() ?? 'USD';
      const today = todayIn(household?.timeZone ?? 'America/Panama');

      // One transaction for all of it. A setup that created the accounts and
      // then failed on the debts would leave a household in a state it never
      // described, and no screen would say so.
      await tx
        .insert(householdSettings)
        .values({
          householdId,
          memberCount: answers.memberCount,
          dependentCount: answers.dependentCount,
          onboardingCompletedAt: new Date(),
          ...(answers.bufferMinimum ? { bufferMinimum: answers.bufferMinimum } : {}),
        })
        .onConflictDoUpdate({
          target: householdSettings.householdId,
          set: {
            memberCount: answers.memberCount,
            dependentCount: answers.dependentCount,
            onboardingCompletedAt: new Date(),
            ...(answers.bufferMinimum ? { bufferMinimum: answers.bufferMinimum } : {}),
            updatedAt: new Date(),
          },
        });

      // The category tree, which no household had ever been given. Thirty-eight
      // templates sat in `category_templates` from the second migration and
      // nothing copied them in, so the classifier had nowhere to file anything
      // and every budget had nothing to budget.
      await tx.execute(sql`select app.seed_household_categories(${householdId})`);

      /**
       * What the person took out of the questionnaire is archived, never
       * deleted.
       *
       * A household that removes an account here may have transactions hanging
       * off it, and «archived on the 14th» and «never existed» are different
       * answers — the second is not available to a financial system. Written
       * per table rather than through one helper because the tables are not
       * interchangeable: goals have no `deleted_at` and are paused instead,
       * and income is archived by direction so an outflow series the
       * recurrence engine found — which this form never showed — is never
       * touched by it.
       */
      // People first: a card can name its holder, and the holder has to exist
      // before anything can point at them.
      const peopleByName = new Map<string, string>();
      const keptPeople: string[] = [];
      for (const person of answers.people) {
        const values = {
          displayName: person.name,
          relationship: person.relationship,
          isDependent: person.isDependent,
        };
        if (person.id) {
          await tx
            .update(householdPeople)
            .set({ ...values, updatedAt: new Date() })
            .where(
              and(eq(householdPeople.id, person.id), eq(householdPeople.householdId, householdId)),
            );
          peopleByName.set(person.name, person.id);
          keptPeople.push(person.id);
        } else {
          const [created] = await tx
            .insert(householdPeople)
            .values({ householdId, createdBy: session.user.id, ...values })
            .returning({ id: householdPeople.id });
          if (created) {
            peopleByName.set(person.name, created.id);
            keptPeople.push(created.id);
          }
        }
      }
      await tx
        .update(householdPeople)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(householdPeople.householdId, householdId),
            isNull(householdPeople.deletedAt),
            notInArray(householdPeople.id, survivors(keptPeople)),
          ),
        );

      // Accounts. Cards are not in scope here — the questionnaire asks about
      // them on the debts step, and this sweep must not archive one it never
      // showed.
      const keptAccounts: string[] = [];
      for (const entry of answers.accounts) {
        const values = {
          name: entry.name,
          accountType: entry.accountType,
          currentBalance: entry.balance,
        };
        if (entry.id) {
          await tx
            .update(accounts)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(accounts.id, entry.id), eq(accounts.householdId, householdId)));
          keptAccounts.push(entry.id);
        } else {
          const [created] = await tx
            .insert(accounts)
            .values({
              householdId,
              ownerId: session.user.id,
              createdBy: session.user.id,
              currency,
              status: 'active' as const,
              source: 'user' as const,
              ...values,
            })
            .returning({ id: accounts.id });
          if (created) keptAccounts.push(created.id);
        }
      }
      await tx
        .update(accounts)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(accounts.householdId, householdId),
            isNull(accounts.deletedAt),
            ne(accounts.accountType, 'credit_card'),
            notInArray(accounts.id, survivors(keptAccounts)),
          ),
        );

      // Income
      const keptIncomes: string[] = [];
      for (const entry of answers.incomes) {
        const values = {
          name: entry.name,
          expectedAmount: entry.amount,
          frequency: entry.frequency,
          amountVariation: entry.isApproximate ? '0.1500' : '0',
        };
        if (entry.id) {
          await tx
            .update(recurringSeries)
            .set({ ...values, updatedAt: new Date() })
            .where(
              and(eq(recurringSeries.id, entry.id), eq(recurringSeries.householdId, householdId)),
            );
          keptIncomes.push(entry.id);
        } else {
          const [created] = await tx
            .insert(recurringSeries)
            .values({
              householdId,
              ownerId: session.user.id,
              direction: 'inflow' as const,
              currency,
              lastSeenOn: today,
              nextExpectedDate: nextFor(today, entry.frequency),
              // Stated by a person, so confidence in the statement is total; what
              // is uncertain is the amount, and that is what the variation says.
              confidence: '1.000',
              occurrenceCount: 0,
              isEssential: true,
              isActive: true,
              detectedBy: 'user' as const,
              confirmedBy: session.user.id,
              confirmedAt: new Date(),
              ...values,
            })
            .returning({ id: recurringSeries.id });
          if (created) keptIncomes.push(created.id);
        }
      }
      // Only the household's stated income is in scope here. An outflow series
      // the recurrence engine found is not something this form ever showed, so
      // it is not something this form may archive.
      await tx
        .update(recurringSeries)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(recurringSeries.householdId, householdId),
            eq(recurringSeries.direction, 'inflow'),
            isNull(recurringSeries.deletedAt),
            notInArray(recurringSeries.id, survivors(keptIncomes)),
          ),
        );

      // Monthly commitments
      const keptCommitments: string[] = [];
      for (const entry of answers.commitments) {
        const due = nextDueOn(today, entry.dueDay);
        const values = {
          name: entry.name,
          expectedAmount: entry.amount,
          dueDate: due,
          nextExpectedDate: addMonths(due, 1),
          isEssential: entry.isEssential,
        };
        if (entry.id) {
          await tx
            .update(obligations)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(obligations.id, entry.id), eq(obligations.householdId, householdId)));
          keptCommitments.push(entry.id);
        } else {
          const [created] = await tx
            .insert(obligations)
            .values({
              householdId,
              currency,
              frequency: 'monthly',
              detectedBy: 'user' as const,
              ...values,
            })
            .returning({ id: obligations.id });
          if (created) keptCommitments.push(created.id);
        }
      }
      await tx
        .update(obligations)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(obligations.householdId, householdId),
            isNull(obligations.deletedAt),
            notInArray(obligations.id, survivors(keptCommitments)),
          ),
        );

      /**
       * Debts, and the cards among them.
       *
       * A credit card is two facts and the product needs both: what is owed,
       * which drives the payoff plan, and what is still available on it, which
       * is a spending limit the position has to know about. So a debt with a
       * limit also gets an account of type `credit_card` and the debt points at
       * it. Without that, a card entered during setup was a debt with no card
       * behind it, and «how much room is left on it» had no answer anywhere.
       *
       * The balance is stored positive on the debt, which is what is owed, and
       * negative on the account, which is what the account holds. Both are the
       * same fact from the two directions the system reads it from.
       */
      const keptDebts: string[] = [];
      for (const entry of answers.debts) {
        const isCard = Boolean(entry.creditLimit);
        const holder = entry.personName?.trim()
          ? (peopleByName.get(entry.personName.trim()) ?? null)
          : null;

        const values = {
          name: entry.name,
          currentBalance: entry.balance,
          apr: entry.apr,
          minimumPayment: entry.minimumPayment,
          ...(entry.creditLimit ? { creditLimit: entry.creditLimit } : {}),
        };

        let debtId = entry.id;
        if (debtId) {
          await tx
            .update(debts)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(debts.id, debtId), eq(debts.householdId, householdId)));
        } else {
          const [created] = await tx
            .insert(debts)
            .values({
              householdId,
              currency,
              // Nothing here knows the original amount borrowed, and inventing
              // one would put a number nobody stated into a financial column.
              principal: entry.balance,
              ...values,
            })
            .returning({ id: debts.id });
          debtId = created?.id;
        }
        if (debtId) keptDebts.push(debtId);

        if (!isCard || !debtId) continue;

        const [existing] = await tx
          .select({ id: accounts.id })
          .from(debts)
          .innerJoin(accounts, eq(accounts.id, debts.accountId))
          .where(and(eq(debts.id, debtId), isNull(accounts.deletedAt)))
          .limit(1);

        const cardValues = {
          name: entry.name,
          accountType: 'credit_card' as const,
          // What the account holds, which for a card is what is owed on it.
          currentBalance: `-${entry.balance}`,
          creditLimit: entry.creditLimit ?? null,
          personId: holder,
        };

        if (existing) {
          await tx
            .update(accounts)
            .set({ ...cardValues, updatedAt: new Date() })
            .where(eq(accounts.id, existing.id));
        } else {
          const [card] = await tx
            .insert(accounts)
            .values({
              householdId,
              ownerId: session.user.id,
              createdBy: session.user.id,
              currency,
              status: 'active' as const,
              source: 'user' as const,
              ...cardValues,
            })
            .returning({ id: accounts.id });
          if (card) {
            await tx.update(debts).set({ accountId: card.id }).where(eq(debts.id, debtId));
          }
        }
      }
      await tx
        .update(debts)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(debts.householdId, householdId),
            isNull(debts.deletedAt),
            notInArray(debts.id, survivors(keptDebts)),
          ),
        );

      // Goals. No `deleted_at` here — a goal that is set aside is paused, which
      // is a state the goal screen already understands and can undo.
      const keptGoals: string[] = [];
      for (const [index, entry] of answers.goals.entries()) {
        const values = {
          name: entry.name,
          targetAmount: entry.targetAmount,
          // The order they were written in is the order they matter in, until
          // the person says otherwise.
          priority: 100 + index,
          ...(isPlainDateString(entry.targetDate) ? { targetDate: entry.targetDate } : {}),
        };
        if (entry.id) {
          await tx
            .update(goals)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(goals.id, entry.id), eq(goals.householdId, householdId)));
          keptGoals.push(entry.id);
        } else {
          const [created] = await tx
            .insert(goals)
            .values({
              householdId,
              createdBy: session.user.id,
              currency,
              status: 'active' as const,
              ...values,
            })
            .returning({ id: goals.id });
          if (created) keptGoals.push(created.id);
        }
      }
      await tx
        .update(goals)
        .set({ status: 'paused' as const, updatedAt: new Date() })
        .where(
          and(
            eq(goals.householdId, householdId),
            eq(goals.status, 'active'),
            notInArray(goals.id, survivors(keptGoals)),
          ),
        );
    });
  } catch {
    return { error: 'saveFailed' };
  }

  const locale = formData.get('locale') === 'en' ? 'en' : 'es';
  for (const path of [
    'overview',
    'plan',
    'advice',
    'alerts',
    'reports',
    'accounts',
    'categories',
    'people',
    'documents',
    'welcome',
  ]) {
    revalidatePath(`/${locale}/${path}`);
  }

  // Straight to the advice, because a plan of action is what the questions
  // were for. It is the same figures the plan screen renders, put in the order
  // they should be acted on, and it links through to the line-by-line detail.
  // Landing back on the position would show a balance and hide the answer.
  // `redirect` throws, so the revalidations above have to come first.
  redirect(`/${locale}/advice`);
}

/** The next time a monthly claim falls due, clamped into a short month. */
function nextDueOn(today: PlainDate, day: number): PlainDate {
  const [year = '0', month = '1'] = today.split('-');
  const lastDayThisMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const candidate = plainDateFromParts(
    Number(year),
    Number(month),
    Math.min(day, lastDayThisMonth),
  );
  // Today still counts as due: a rent payment due today is not next month's
  // problem, and hiding it would overstate what is available right now.
  return candidate >= today ? candidate : addMonths(candidate, 1);
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

function isPlainDateString(value: string | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
