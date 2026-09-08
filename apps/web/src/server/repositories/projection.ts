import 'server-only';

import { scenarios as scenarioRows } from '@app/database/schema';
import { Money, startOfMonth, type CurrencyCode, type PlainDate } from '@app/domain';
import {
  compare,
  project,
  type Baseline,
  type Projection,
  type Scenario,
  type ScenarioChange,
  type ScenarioComparison,
  type ScenarioKind,
} from '@app/scenario-engine';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

import type { DebtView, GoalView, IncomeView } from './administration';
import type { PlanView } from './plan';

/**
 * «What happens if…», on the household's own position.
 *
 * The scenario engine takes a snapshot — a plain value copied out of the
 * position — and projects forward from it. Nothing in the engine can reach a
 * database, which is the isolation that matters here: a household must be able
 * to model losing their job without any risk that modelling it changes
 * something.
 *
 * This module's whole job is building that snapshot honestly, and it is the
 * part where a projection goes wrong. Monthly income is the declared series
 * converted to monthly equivalents; monthly expenses are what the household has
 * committed, not what the engine wishes they were.
 */

/** Twelve months over the payments in a year, per cadence. */
const MONTHLY_EQUIVALENT: Readonly<Record<string, { times: number; over: number }>> = {
  weekly: { times: 52, over: 12 },
  biweekly: { times: 26, over: 12 },
  semimonthly: { times: 24, over: 12 },
  monthly: { times: 1, over: 1 },
  quarterly: { times: 1, over: 3 },
  annual: { times: 1, over: 12 },
};

export interface BaselineInputs {
  readonly currency: CurrencyCode;
  readonly today: PlainDate;
  readonly plan: PlanView;
  readonly incomes: readonly IncomeView[];
  readonly debts: readonly DebtView[];
  readonly goals: readonly GoalView[];
  /** What the household commits every month, from its obligations. */
  readonly monthlyCommitments: Money;
}

export function buildBaseline(inputs: BaselineInputs): Baseline {
  const monthlyIncome = Money.sum(
    inputs.incomes
      .filter((income) => income.isActive)
      .map((income) => {
        const ratio = MONTHLY_EQUIVALENT[income.frequency];
        // Multiply before dividing, so a weekly figure keeps its cents through
        // the 52/12 conversion rather than rounding twice.
        return ratio ? income.amount.multiply(ratio.times).divide(ratio.over) : income.amount;
      }),
    inputs.currency,
  );

  return {
    currency: inputs.currency,
    startMonth: startOfMonth(inputs.today),
    liquid: inputs.plan.safeToSpend.liquid,
    monthlyIncome,
    // Debt payments are derived by the engine from the debts themselves, so
    // including the minimums here would charge the household twice.
    monthlyExpenses: inputs.monthlyCommitments,
    debts: inputs.debts
      .filter((debt) => debt.currentBalance.isPositive())
      .map((debt) => ({
        id: debt.id,
        name: debt.name,
        currentBalance: debt.currentBalance,
        apr: debt.apr,
        minimumPayment: debt.minimumPayment,
        creditLimit: debt.creditLimit,
      })),
    goals: inputs.goals
      .filter((goal) => goal.status === 'active')
      .map((goal) => ({
        id: goal.id,
        name: goal.name,
        current: goal.currentAmount,
        target: goal.targetAmount,
        // Nothing in the product records a per-goal monthly contribution yet.
        // Zero is the honest snapshot: the projection shows what happens if the
        // household changes nothing, and today it contributes nothing on a
        // schedule.
        monthlyContribution: Money.zero(inputs.currency),
      })),
  };
}

/** The do-nothing case, over a horizon. */
export function projectBaseline(baseline: Baseline, horizonMonths: number): Projection {
  return project(baseline, {
    id: 'baseline',
    name: 'baseline',
    kind: 'debt_payoff',
    changes: [],
    horizonMonths,
  });
}

export interface StoredScenario {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly horizonMonths: number;
  readonly changes: readonly StoredChange[];
}

/**
 * A change as the form collects it.
 *
 * Deliberately narrower than `ScenarioChange`: three fields a person can fill
 * in, and a start month. Financed purchases — «buy the car with a loan» — need
 * a whole debt and are not offered by the builder yet; a stored scenario that
 * carries one still projects, because it is read into the engine's own shape.
 */
export interface StoredChange {
  readonly label: string;
  readonly startsInMonths: number;
  readonly durationMonths: number | null;
  readonly oneTimeCost: string | null;
  readonly monthlyExpenseDelta: string | null;
  readonly monthlyIncomeDelta: string | null;
}

export async function loadScenarios(
  session: Session,
  householdId: string,
): Promise<readonly StoredScenario[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select()
      .from(scenarioRows)
      .where(and(eq(scenarioRows.householdId, householdId), isNull(scenarioRows.deletedAt)))
      .orderBy(desc(scenarioRows.createdAt)),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    horizonMonths: row.horizonMonths,
    changes: readChanges(row.changes),
  }));
}

/**
 * Reads the stored JSON into the shape the form edits.
 *
 * Validated on read, like a stored rule. The column is `jsonb` and what comes
 * back is whatever was written — including by an earlier version of this code —
 * so anything that does not parse is dropped rather than projected from.
 */
function readChanges(stored: unknown): readonly StoredChange[] {
  if (!Array.isArray(stored)) return [];

  const changes: StoredChange[] = [];

  for (const entry of stored) {
    if (typeof entry !== 'object' || entry === null) continue;

    const change = entry as Record<string, unknown>;
    const label = typeof change['label'] === 'string' ? change['label'] : '';
    if (label === '') continue;

    changes.push({
      label,
      startsInMonths: numberOf(change['startsInMonths']) ?? 0,
      durationMonths: numberOf(change['durationMonths']),
      oneTimeCost: decimalOf(change['oneTimeCost']),
      monthlyExpenseDelta: decimalOf(change['monthlyExpenseDelta']),
      monthlyIncomeDelta: decimalOf(change['monthlyIncomeDelta']),
    });
  }

  return changes;
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function decimalOf(value: unknown): string | null {
  return typeof value === 'string' && /^-?\d+(\.\d{1,4})?$/.test(value) ? value : null;
}

/** Turns the stored shape into the engine's, with money parsed. */
export function toScenario(stored: StoredScenario, currency: CurrencyCode): Scenario {
  const changes: ScenarioChange[] = stored.changes.map((change) => ({
    label: change.label,
    startsInMonths: change.startsInMonths,
    durationMonths: change.durationMonths,
    oneTimeCost: change.oneTimeCost ? Money.fromDecimalString(change.oneTimeCost, currency) : null,
    monthlyExpenseDelta: change.monthlyExpenseDelta
      ? Money.fromDecimalString(change.monthlyExpenseDelta, currency)
      : null,
    monthlyIncomeDelta: change.monthlyIncomeDelta
      ? Money.fromDecimalString(change.monthlyIncomeDelta, currency)
      : null,
    addedDebt: null,
  }));

  return {
    id: stored.id,
    name: stored.name,
    kind: stored.kind as ScenarioKind,
    changes,
    horizonMonths: stored.horizonMonths,
  };
}

/** The scenario against the same household with nothing changed. */
export function compareScenario(
  baseline: Baseline,
  stored: StoredScenario,
  currency: CurrencyCode,
): ScenarioComparison {
  return compare(baseline, toScenario(stored, currency));
}
