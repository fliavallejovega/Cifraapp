import 'server-only';

import { Money, type CurrencyCode, type PlainDate } from '@app/domain';
import type { Baseline } from '@app/scenario-engine';

import type { Session } from '../session';

import { loadCommitments, loadDebts, loadGoals, loadIncomes } from './administration';
import { loadPlan } from './plan';
import { buildBaseline } from './projection';

/**
 * The household's position, as a value the scenario engine can project from.
 *
 * Assembled in one place because two screens need exactly the same snapshot and
 * a projection built from a slightly different baseline than the scenario it is
 * compared against is worse than no projection: the difference between them
 * would be an artefact of how they were loaded.
 */
export async function loadBaseline(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
  today: PlainDate,
): Promise<{ baseline: Baseline; hasData: boolean }> {
  const [plan, incomes, debts, goals, commitments] = await Promise.all([
    loadPlan(session, householdId),
    loadIncomes(session, householdId, currency),
    loadDebts(session, householdId, currency),
    loadGoals(session, householdId, currency),
    loadCommitments(session, householdId, currency),
  ]);

  const monthlyCommitments = Money.sum(
    commitments
      .filter((commitment) => !commitment.isSettled)
      .map((commitment) => commitment.expectedAmount),
    currency,
  );

  const baseline = buildBaseline({
    currency,
    today,
    plan,
    incomes,
    debts,
    goals,
    monthlyCommitments,
  });

  return {
    baseline,
    // Nothing coming in and nothing held is not a projection worth drawing; it
    // is a flat line at zero, and the screen should say what is missing.
    hasData: baseline.monthlyIncome.isPositive() || baseline.liquid.isPositive(),
  };
}
