'use server';

import { scenarios } from '@app/database/schema';
import { MAX_HORIZON_MONTHS } from '@app/scenario-engine';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { firstIssueKey, optionalAmount, recordName } from './record-input';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * «What if we had a child.» «What if rent goes up $150.» «What if I lose this
 * contract.»
 *
 * A scenario is stored as its changes rather than as its result. The projection
 * is recomputed from the household's position every time it is opened, which is
 * the opposite of the accepted plan: a plan is a decision and must not move, and
 * a scenario is a question whose answer depends on where the household is
 * *today*.
 *
 * The builder collects one change with three optional figures. That is narrow
 * on purpose — it covers rent going up, a salary changing, and a one-off cost,
 * which is what people actually ask — and a scenario stored with more changes
 * still projects, because the reader hands them all to the engine.
 */

const KINDS = [
  'vehicle_purchase',
  'marriage',
  'child',
  'income_loss',
  'bonus',
  'debt_payoff',
  'vacation',
  'move',
  'rent_increase',
  'job_change',
] as const;

const scenarioInput = z.object({
  name: recordName,
  kind: z.enum(KINDS),
  horizonMonths: z.coerce.number().int().min(1).max(MAX_HORIZON_MONTHS),
  label: z.string().trim().min(1).max(120),
  startsInMonths: z.coerce.number().int().min(0).max(600),
  durationMonths: z.preprocess(
    (value) => (value === '' || value === undefined || value === null ? undefined : value),
    z.coerce.number().int().min(1).max(600).optional(),
  ),
  oneTimeCost: optionalAmount,
  monthlyExpenseDelta: optionalAmount,
  monthlyIncomeDelta: optionalAmount,
});

const FIELD_ERRORS = {
  name: 'nameRequired',
  kind: 'kindInvalid',
  horizonMonths: 'horizonInvalid',
  label: 'labelRequired',
  startsInMonths: 'monthsInvalid',
  durationMonths: 'monthsInvalid',
  oneTimeCost: 'amountInvalid',
  monthlyExpenseDelta: 'amountInvalid',
  monthlyIncomeDelta: 'amountInvalid',
} as const;

function parse(formData: FormData) {
  return scenarioInput.safeParse({
    name: formData.get('name'),
    kind: formData.get('kind') ?? 'move',
    horizonMonths: formData.get('horizonMonths') ?? '60',
    label: formData.get('label'),
    startsInMonths: formData.get('startsInMonths') ?? '0',
    durationMonths: formData.get('durationMonths'),
    oneTimeCost: formData.get('oneTimeCost'),
    monthlyExpenseDelta: formData.get('monthlyExpenseDelta'),
    monthlyIncomeDelta: formData.get('monthlyIncomeDelta'),
  });
}

function changesFrom(data: z.infer<typeof scenarioInput>) {
  return [
    {
      label: data.label,
      startsInMonths: data.startsInMonths,
      durationMonths: data.durationMonths ?? null,
      oneTimeCost: data.oneTimeCost ?? null,
      monthlyExpenseDelta: data.monthlyExpenseDelta ?? null,
      monthlyIncomeDelta: data.monthlyIncomeDelta ?? null,
    },
  ];
}

export async function createScenario(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  // A change that costs nothing and earns nothing projects the do-nothing case
  // under a different name, which is a scenario in form only.
  if (
    !parsed.data.oneTimeCost &&
    !parsed.data.monthlyExpenseDelta &&
    !parsed.data.monthlyIncomeDelta
  ) {
    return { error: 'changeIsEmpty' };
  }

  const householdId = session.activeHouseholdId;

  const [created] = await queryAsUser(session, (tx) =>
    tx
      .insert(scenarios)
      .values({
        householdId,
        createdBy: session.user.id,
        name: parsed.data.name,
        kind: parsed.data.kind,
        horizonMonths: parsed.data.horizonMonths,
        changes: changesFrom(parsed.data),
      })
      .returning({ id: scenarios.id }),
  );

  if (!created) return { error: 'createFailed' };

  revalidateFinancials(formData);
  return { created: created.id };
}

export async function updateScenario(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  if (
    !parsed.data.oneTimeCost &&
    !parsed.data.monthlyExpenseDelta &&
    !parsed.data.monthlyIncomeDelta
  ) {
    return { error: 'changeIsEmpty' };
  }

  const householdId = session.activeHouseholdId;

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(scenarios)
      .set({
        name: parsed.data.name,
        kind: parsed.data.kind,
        horizonMonths: parsed.data.horizonMonths,
        changes: changesFrom(parsed.data),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scenarios.id, id.data),
          eq(scenarios.householdId, householdId),
          isNull(scenarios.deletedAt),
        ),
      )
      .returning({ id: scenarios.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

export async function removeScenario(
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
      .update(scenarios)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(scenarios.id, id.data),
          eq(scenarios.householdId, householdId),
          isNull(scenarios.deletedAt),
        ),
      )
      .returning({ id: scenarios.id }),
  );

  if (!removed) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}
