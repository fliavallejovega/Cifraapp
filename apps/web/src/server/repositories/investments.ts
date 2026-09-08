import 'server-only';

import { goals, investmentProfiles, investmentWatchlist } from '@app/database/schema';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';
import {
  DEFAULT_BANDS,
  planForGoal,
  type GoalPlan,
  type RiskBand,
  type RiskLevel,
} from '@app/investment-engine';
import { asc, eq } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

import { loadGoals } from './administration';

/**
 * The investing module's own reading of the household.
 *
 * Two things come from rows the household wrote — the profile and the
 * watchlist — and everything else is arithmetic over goals they already have.
 * Nothing here fetches a price, a rating or a recommendation, because the
 * product does not make any.
 */

export interface InvestmentProfileView {
  readonly riskLevel: RiskLevel;
  readonly monthlyCapacity: Money;
  readonly interests: readonly string[];
  readonly hasEmergencyFund: boolean;
  readonly acknowledgedAt: Date | null;
  /** The band in force: the household's own overrides, or the defaults. */
  readonly bands: Readonly<Record<RiskLevel, RiskBand>>;
  /** True when the band is the product's rather than the household's. */
  readonly usingDefaultBand: boolean;
}

export interface WatchedSymbol {
  readonly id: string;
  readonly symbol: string;
  readonly label: string;
  readonly note: string | null;
  readonly goalId: string | null;
  readonly goalName: string | null;
}

export interface InvestmentView {
  readonly profile: InvestmentProfileView;
  readonly watchlist: readonly WatchedSymbol[];
  readonly plans: readonly GoalPlan[];
  /** Goals with no date: they cannot be modelled, and the screen says why. */
  readonly undatedGoals: readonly { readonly id: string; readonly name: string }[];
}

/**
 * The household's band, or the product's.
 *
 * An override replaces the whole band for every level rather than one rate,
 * because a household that thinks the product is optimistic thinks so about all
 * of it, and a band with one edited edge is one nobody can reason about.
 */
function bandsFrom(
  level: RiskLevel,
  low: string | null,
  expected: string | null,
  high: string | null,
): { bands: Readonly<Record<RiskLevel, RiskBand>>; usingDefault: boolean } {
  if (low === null || expected === null || high === null) {
    return { bands: DEFAULT_BANDS, usingDefault: true };
  }

  const base = DEFAULT_BANDS[level];

  return {
    bands: { ...DEFAULT_BANDS, [level]: { ...base, low, expected, high } },
    usingDefault: false,
  };
}

/** Whole months from today to a target date, floored at zero. */
function monthsUntil(today: PlainDate, target: PlainDate): number {
  const [fromYear = 0, fromMonth = 1] = today.split('-').map(Number);
  const [toYear = 0, toMonth = 1] = target.split('-').map(Number);
  return Math.max(0, (toYear - fromYear) * 12 + (toMonth - fromMonth));
}

export async function loadInvestments(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
  today: PlainDate,
): Promise<InvestmentView> {
  const [rows, watchRows, householdGoals] = await Promise.all([
    queryAsUser(session, (tx) =>
      tx
        .select()
        .from(investmentProfiles)
        .where(eq(investmentProfiles.householdId, householdId))
        .limit(1),
    ),
    queryAsUser(session, (tx) =>
      tx
        .select({
          id: investmentWatchlist.id,
          symbol: investmentWatchlist.symbol,
          label: investmentWatchlist.label,
          note: investmentWatchlist.note,
          goalId: investmentWatchlist.goalId,
          goalName: goals.name,
        })
        .from(investmentWatchlist)
        .leftJoin(goals, eq(goals.id, investmentWatchlist.goalId))
        .where(eq(investmentWatchlist.householdId, householdId))
        .orderBy(asc(investmentWatchlist.createdAt)),
    ),
    loadGoals(session, householdId, currency),
  ]);

  const row = rows[0];
  const level = row?.riskLevel ?? 'balanced';

  const { bands, usingDefault } = bandsFrom(
    level,
    row?.assumedLow ?? null,
    row?.assumedExpected ?? null,
    row?.assumedHigh ?? null,
  );

  const active = householdGoals.filter(
    (goal) => goal.status === 'active' && goal.targetAmount.greaterThan(goal.currentAmount),
  );

  // A goal with no date cannot be modelled: every figure this module produces
  // divides by a number of months. Reported as such rather than given an
  // invented horizon, which would be the product deciding when they want it.
  const dated = active.filter((goal) => goal.targetDate !== null);

  return {
    profile: {
      riskLevel: level,
      monthlyCapacity: Money.fromDecimalString(row?.monthlyCapacity ?? '0', currency),
      interests: row?.interests ?? [],
      hasEmergencyFund: row?.hasEmergencyFund ?? false,
      acknowledgedAt: row?.acknowledgedAt ?? null,
      bands,
      usingDefaultBand: usingDefault,
    },
    watchlist: watchRows,
    plans: dated.map((goal) =>
      planForGoal(
        {
          id: goal.id,
          name: goal.name,
          target: goal.targetAmount,
          current: goal.currentAmount,
          months: monthsUntil(today, goal.targetDate ?? today),
        },
        bands,
      ),
    ),
    undatedGoals: active
      .filter((goal) => goal.targetDate === null)
      .map((goal) => ({ id: goal.id, name: goal.name })),
  };
}

/** The goals a symbol can be attached to. */
export async function loadGoalOptions(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<readonly { id: string; name: string }[]> {
  const all = await loadGoals(session, householdId, currency);
  return all
    .filter((goal) => goal.status === 'active')
    .map((goal) => ({ id: goal.id, name: goal.name }));
}
