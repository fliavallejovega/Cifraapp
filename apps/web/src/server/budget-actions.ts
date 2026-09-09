'use server';

import { budgetLines, budgets } from '@app/database/schema';
import { startOfMonth, todayIn } from '@app/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { currencyOf } from './household-context';
import {
  firstIssueKey,
  optionalPlainDate,
  optionalUuid,
  positiveAmount,
  recordName,
} from './record-input';
import { localeOf, revalidateFinancials, revalidateScreen } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Budgets: what the household means to spend.
 *
 * A budget is a header and its lines, and they are edited separately because
 * they are decided separately — the shape of the month is chosen once, and the
 * grocery figure gets argued with every few weeks.
 *
 * The default period is the current month with no end date, which is what makes
 * a monthly budget keep working in November without anybody re-creating it. The
 * reader recomputes the window each time it is read.
 */

const PERIODS = ['monthly', 'weekly', 'annual', 'sinking'] as const;

const budgetInput = z.object({
  name: recordName,
  period: z.enum(PERIODS),
  startsOn: optionalPlainDate,
  endsOn: optionalPlainDate,
});

const FIELD_ERRORS = {
  name: 'nameRequired',
  period: 'periodInvalid',
  startsOn: 'dateInvalid',
  endsOn: 'dateInvalid',
} as const;

function parse(formData: FormData) {
  return budgetInput.safeParse({
    name: formData.get('name'),
    period: formData.get('period') ?? 'monthly',
    startsOn: formData.get('startsOn'),
    endsOn: formData.get('endsOn'),
  });
}

export async function createBudget(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;
  const today = todayIn('America/Panama');

  const [created] = await queryAsUser(session, (tx) =>
    tx
      .insert(budgets)
      .values({
        householdId,
        createdBy: session.user.id,
        name: parsed.data.name,
        period: parsed.data.period,
        startsOn: parsed.data.startsOn ?? startOfMonth(today),
        ...(parsed.data.endsOn ? { endsOn: parsed.data.endsOn } : {}),
      })
      .returning({ id: budgets.id }),
  );

  if (!created) return { error: 'createFailed' };

  revalidateFinancials(formData);
  return { created: created.id };
}

export async function updateBudget(
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
      .update(budgets)
      .set({
        name: parsed.data.name,
        period: parsed.data.period,
        ...(parsed.data.startsOn ? { startsOn: parsed.data.startsOn } : {}),
        endsOn: parsed.data.endsOn ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(budgets.id, id.data),
          eq(budgets.householdId, householdId),
          isNull(budgets.deletedAt),
        ),
      )
      .returning({ id: budgets.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  revalidateScreen(formData, `budgets/${id.data}`);
  return { ok: true };
}

export async function removeBudget(
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
      .update(budgets)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(budgets.id, id.data),
          eq(budgets.householdId, householdId),
          isNull(budgets.deletedAt),
        ),
      )
      .returning({ id: budgets.id }),
  );

  if (!removed) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

const lineInput = z.object({
  budgetId: z.uuid(),
  categoryId: optionalUuid,
  plannedAmount: positiveAmount,
});

/** Adds a line, or changes the figure on one that exists. */
export async function saveBudgetLine(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = lineInput.safeParse({
    budgetId: formData.get('budgetId'),
    categoryId: formData.get('categoryId'),
    plannedAmount: formData.get('plannedAmount'),
  });

  if (!parsed.success) {
    return { error: firstIssueKey(parsed.error, { plannedAmount: 'amountInvalid' }, 'notFound') };
  }

  const lineId = optionalUuid.safeParse(formData.get('id'));
  if (!lineId.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    const [budget] = await tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(
        and(
          eq(budgets.id, parsed.data.budgetId),
          eq(budgets.householdId, householdId),
          isNull(budgets.deletedAt),
        ),
      )
      .limit(1);

    if (!budget) return 'notFound' as const;

    if (lineId.data) {
      await tx
        .update(budgetLines)
        .set({
          categoryId: parsed.data.categoryId ?? null,
          plannedAmount: parsed.data.plannedAmount,
          updatedAt: new Date(),
        })
        .where(and(eq(budgetLines.id, lineId.data), eq(budgetLines.budgetId, budget.id)));
      return 'ok' as const;
    }

    await tx.insert(budgetLines).values({
      budgetId: budget.id,
      plannedAmount: parsed.data.plannedAmount,
      currency: currencyOf(session, householdId),
      ...(parsed.data.categoryId ? { categoryId: parsed.data.categoryId } : {}),
    });

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  revalidateScreen(formData, `budgets/${parsed.data.budgetId}`);
  return { ok: true };
}

export async function removeBudgetLine(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  const budgetId = z.uuid().safeParse(formData.get('budgetId'));
  if (!id.success || !budgetId.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    const [budget] = await tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.id, budgetId.data), eq(budgets.householdId, householdId)))
      .limit(1);

    if (!budget) return 'notFound' as const;

    await tx
      .delete(budgetLines)
      .where(and(eq(budgetLines.id, id.data), eq(budgetLines.budgetId, budget.id)));

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  revalidateScreen(formData, `budgets/${budgetId.data}`);
  return { ok: true };
}

/**
 * Builds a first budget out of what the household actually spends.
 *
 * A budget generated from percentages someone read in a magazine gets abandoned
 * in week two. «You spend about $420 on groceries» is a statement a household
 * recognises, and can then decide to argue with — which is the whole point.
 *
 * Only categories with at least three months behind them are proposed, and
 * lines that already exist are left alone. Overwriting a figure a person chose
 * with one the engine preferred would be the machine deciding, and it does not.
 */
export async function buildSuggestedBudget(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;
  const today = todayIn('America/Panama');
  const currency = currencyOf(session, householdId);

  const budgetId = await queryAsUser(session, async (tx) => {
    const [existing] = await tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(
        and(
          eq(budgets.householdId, householdId),
          eq(budgets.period, 'monthly'),
          isNull(budgets.endsOn),
          isNull(budgets.deletedAt),
        ),
      )
      .limit(1);

    const target =
      existing ??
      (
        await tx
          .insert(budgets)
          .values({
            householdId,
            createdBy: session.user.id,
            name: 'Presupuesto mensual',
            period: 'monthly',
            startsOn: startOfMonth(today),
          })
          .returning({ id: budgets.id })
      )[0];

    if (!target) return null;

    const lines = await tx
      .select({ categoryId: budgetLines.categoryId })
      .from(budgetLines)
      .where(eq(budgetLines.budgetId, target.id));

    const covered = new Set(lines.map((line) => line.categoryId));

    const lookback = new Date(`${startOfMonth(today)}T00:00:00Z`);
    lookback.setUTCMonth(lookback.getUTCMonth() - 6);

    // The median of a category's monthly totals, in SQL, over the last six
    // months. The month with the birthday party should not set the grocery
    // budget for the year — which is exactly what a mean would let it do.
    const proposals = await tx.execute<{ category_id: string; suggested: string; months: number }>(
      sql`
        with monthly as (
          select category_id,
                 to_char(transaction_date, 'YYYY-MM') as month,
                 -- Outflows are stored negative; a budget line is a magnitude.
                 abs(sum(amount)) as total
            from app.transactions
           where household_id = ${householdId}
             and direction = 'outflow'
             and status in ('posted', 'pending', 'reconciled')
             and deleted_at is null
             and category_id is not null
             and transaction_date >= ${lookback.toISOString().slice(0, 10)}
             and transaction_date < ${startOfMonth(today)}
           group by category_id, month
        )
        select category_id,
               -- Discrete, not continuous. percentile_cont interpolates
               -- between the two middle months and so returns double
               -- precision: float arithmetic on an amount, which this codebase
               -- does not do -- and round(double precision, integer) does not
               -- exist in Postgres, so this crashed the screen outright.
               -- percentile_disc returns an actual month total, in numeric,
               -- which is exact and is also the better suggestion: a month the
               -- household actually lived through.
               (percentile_disc(0.5) within group (order by total))::text as suggested,
               count(*)::int as months
          from monthly
         group by category_id
        having count(*) >= 3
      `,
    );

    const fresh = proposals.filter(
      (row) => !covered.has(row.category_id) && Number(row.suggested) > 0,
    );

    if (fresh.length > 0) {
      await tx.insert(budgetLines).values(
        fresh.map((row) => ({
          budgetId: target.id,
          categoryId: row.category_id,
          plannedAmount: row.suggested,
          currency,
        })),
      );
    }

    return target.id;
  });

  if (!budgetId) return { error: 'createFailed' };

  revalidateFinancials(formData);
  redirect(`/${localeOf(formData)}/budgets/${budgetId}`);
}
