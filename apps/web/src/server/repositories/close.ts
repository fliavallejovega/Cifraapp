import 'server-only';

import {
  accountingPeriods,
  duplicateCandidates,
  transactions,
  transfers,
} from '@app/database/schema';
import { endOfMonth, startOfMonth, type PlainDate } from '@app/domain';
import {
  buildCloseChecklist,
  CLOSE_STEPS,
  type CloseChecklist,
  type CloseStep,
} from '@app/reporting';
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';

import { needsACategory } from './needs-category';
import { queryAsUser, type Session } from '../session';

/**
 * Closing a month.
 *
 * A closed period is a promise: the figures quoted from it will not change
 * underneath whoever quoted them. The checklist is what makes that promise
 * keepable — closing over eleven uncategorized movements would seal a month
 * whose numbers are known to be wrong.
 *
 * Two of the steps block and the rest do not, and the distinction is the
 * engine's rather than this reader's. A household may knowingly close with
 * unreconciled accounts; it may not close with movements nobody has classified.
 */

export interface PeriodView {
  readonly id: string;
  readonly periodStart: PlainDate;
  readonly periodEnd: PlainDate;
  readonly status: 'open' | 'closing' | 'closed' | 'reopened';
  readonly closedAt: Date | null;
  readonly reopenedAt: Date | null;
  readonly reopenReason: string | null;
}

export interface CloseView {
  readonly period: { readonly start: PlainDate; readonly end: PlainDate };
  readonly checklist: CloseChecklist;
  readonly current: PeriodView | null;
  readonly history: readonly PeriodView[];
  /** Movements inside the period, so the screen can say what it is sealing. */
  readonly movementCount: number;
}

export async function loadClose(
  session: Session,
  householdId: string,
  today: PlainDate,
  month?: PlainDate,
): Promise<CloseView> {
  // The month being closed is the previous one by default: closing the month
  // you are still living in seals a period that is still happening.
  const anchor = month ?? previousMonth(today);
  const start = startOfMonth(anchor);
  const end = endOfMonth(anchor);

  return queryAsUser(session, async (tx) => {
    const inPeriod = and(
      eq(transactions.householdId, householdId),
      isNull(transactions.deletedAt),
      gte(transactions.transactionDate, start),
      lte(transactions.transactionDate, end),
    );

    const [uncategorized, needsReview, unconfirmedTransfers, openDuplicates, total, periods] =
      await Promise.all([
        tx
          .select({ total: sql<number>`count(*)::int` })
          .from(transactions)
          .where(and(inPeriod, needsACategory())),

        tx
          .select({ total: sql<number>`count(*)::int` })
          .from(transactions)
          .where(and(inPeriod, eq(transactions.status, 'needs_review'))),

        tx
          .select({ total: sql<number>`count(*)::int` })
          .from(transfers)
          .where(and(eq(transfers.householdId, householdId), isNull(transfers.confirmedAt))),

        tx
          .select({ total: sql<number>`count(*)::int` })
          .from(duplicateCandidates)
          .where(
            and(
              eq(duplicateCandidates.householdId, householdId),
              isNull(duplicateCandidates.resolvedAt),
            ),
          ),

        tx
          .select({ total: sql<number>`count(*)::int` })
          .from(transactions)
          .where(inPeriod),

        tx
          .select()
          .from(accountingPeriods)
          .where(eq(accountingPeriods.householdId, householdId))
          .orderBy(desc(accountingPeriods.periodStart))
          .limit(24),
      ]);

    const outstanding = {
      uncategorized: uncategorized[0]?.total ?? 0,
      duplicates: openDuplicates[0]?.total ?? 0,
      transfers: unconfirmedTransfers[0]?.total ?? 0,
      reconciliation: needsReview[0]?.total ?? 0,
    } as Record<CloseStep, number>;

    // Any step the engine knows about and this reader does not count yet is
    // zero rather than absent — an undefined would make the checklist NaN.
    for (const step of CLOSE_STEPS) {
      outstanding[step] ??= 0;
    }

    const views: PeriodView[] = periods.map((row) => ({
      id: row.id,
      periodStart: row.periodStart as PlainDate,
      periodEnd: row.periodEnd as PlainDate,
      status: row.status,
      closedAt: row.closedAt,
      reopenedAt: row.reopenedAt,
      reopenReason: row.reopenReason,
    }));

    return {
      period: { start, end },
      checklist: buildCloseChecklist({ start, end }, outstanding),
      current: views.find((view) => view.periodStart === start) ?? null,
      history: views,
      movementCount: total[0]?.total ?? 0,
    };
  });
}

/** The calendar month before the one this date falls in. */
export function previousMonth(today: PlainDate): PlainDate {
  const [year = 0, month = 1] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return date.toISOString().slice(0, 10) as PlainDate;
}
