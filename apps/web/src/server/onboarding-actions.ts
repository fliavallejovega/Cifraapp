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
import { eq, sql } from 'drizzle-orm';
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

const dueDay = z.coerce.number().int().min(1).max(31);

const RELATIONSHIPS = ['self', 'partner', 'child', 'parent', 'sibling', 'other'] as const;

const setupInput = z.object({
  // Who lives here, by name. The counts below are derived from this list by the
  // form, so the figure the plan reads and the list a person can edit are the
  // same fact rather than two records of it.
  people: z
    .array(
      z.object({
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
        name,
        accountType: z.enum(['checking', 'savings', 'cash', 'digital_wallet']),
        balance: amount,
      }),
    )
    .max(20),
  commitments: z.array(z.object({ name, amount, dueDay, isEssential: z.boolean() })).max(40),
  debts: z
    .array(
      z.object({
        name,
        balance: amount,
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
    .array(z.object({ name, targetAmount: amount, targetDate: z.string().optional() }))
    .max(20),
});

export type SetupInput = z.infer<typeof setupInput>;

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

      if (answers.people.length > 0) {
        await tx.insert(householdPeople).values(
          answers.people.map((person) => ({
            householdId,
            createdBy: session.user.id,
            displayName: person.name,
            relationship: person.relationship,
            isDependent: person.isDependent,
          })),
        );
      }

      if (answers.accounts.length > 0) {
        await tx.insert(accounts).values(
          answers.accounts.map((entry) => ({
            householdId,
            ownerId: session.user.id,
            createdBy: session.user.id,
            name: entry.name,
            accountType: entry.accountType,
            currency,
            currentBalance: entry.balance,
            status: 'active' as const,
            source: 'user' as const,
          })),
        );
      }

      if (answers.incomes.length > 0) {
        await tx.insert(recurringSeries).values(
          answers.incomes.map((entry) => ({
            householdId,
            ownerId: session.user.id,
            name: entry.name,
            direction: 'inflow' as const,
            expectedAmount: entry.amount,
            currency,
            frequency: entry.frequency,
            lastSeenOn: today,
            nextExpectedDate: nextFor(today, entry.frequency),
            // Stated by a person, so confidence in the statement is total; what
            // is uncertain is the amount, and that is what the variation says.
            confidence: '1.000',
            amountVariation: entry.isApproximate ? '0.1500' : '0',
            occurrenceCount: 0,
            isEssential: true,
            isActive: true,
            detectedBy: 'user' as const,
            confirmedBy: session.user.id,
            confirmedAt: new Date(),
          })),
        );
      }

      if (answers.commitments.length > 0) {
        await tx.insert(obligations).values(
          answers.commitments.map((entry) => {
            const due = nextDueOn(today, entry.dueDay);
            return {
              householdId,
              name: entry.name,
              expectedAmount: entry.amount,
              currency,
              dueDate: due,
              frequency: 'monthly',
              nextExpectedDate: addMonths(due, 1),
              isEssential: entry.isEssential,
              detectedBy: 'user' as const,
            };
          }),
        );
      }

      if (answers.debts.length > 0) {
        await tx.insert(debts).values(
          answers.debts.map((entry) => ({
            householdId,
            name: entry.name,
            // Nothing here knows the original amount borrowed, and inventing one
            // would put a number nobody stated into a financial column.
            principal: entry.balance,
            currentBalance: entry.balance,
            currency,
            apr: entry.apr,
            minimumPayment: entry.minimumPayment,
          })),
        );
      }

      if (answers.goals.length > 0) {
        await tx.insert(goals).values(
          answers.goals.map((entry, index) => ({
            householdId,
            createdBy: session.user.id,
            name: entry.name,
            targetAmount: entry.targetAmount,
            currency,
            // The order they were written in is the order they matter in, until
            // the person says otherwise.
            priority: 100 + index,
            status: 'active' as const,
            ...(isPlainDateString(entry.targetDate) ? { targetDate: entry.targetDate } : {}),
          })),
        );
      }
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

/** Lets a household answer the questionnaire again without re-signing up. */
export async function skipSetup(_previous: SetupResult, formData: FormData): Promise<SetupResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;

  await queryAsUser(session, (tx) =>
    tx
      .insert(householdSettings)
      .values({ householdId, onboardingCompletedAt: new Date() })
      .onConflictDoUpdate({
        target: householdSettings.householdId,
        set: { onboardingCompletedAt: new Date(), updatedAt: new Date() },
      }),
  );

  const locale = formData.get('locale') === 'en' ? 'en' : 'es';
  revalidatePath(`/${locale}/overview`);
  revalidatePath(`/${locale}/welcome`);

  redirect(`/${locale}/overview`);
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
