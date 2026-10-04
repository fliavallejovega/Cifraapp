import 'server-only';

import { recurringSeries } from '@app/database/schema';
import { Money } from '@app/domain';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * What the movements say about the household's month, waiting for a yes.
 *
 * The questionnaire asked a person to type their salary and their rent. The
 * statements already show both: the same amount arriving on the 15th and the
 * 30th, the same amount leaving on the 5th. Detection found them; this is the
 * short list of what it found, so the home screen can say «this is what we
 * understood» and a single tap confirms it.
 */
export interface UnderstoodSeries {
  readonly id: string;
  readonly name: string;
  readonly amount: Money;
  readonly direction: 'inflow' | 'outflow';
  readonly frequency: string;
}

const SHOWN = 8;

export async function loadUnderstood(
  session: Session,
  householdId: string,
): Promise<readonly UnderstoodSeries[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: recurringSeries.id,
        name: recurringSeries.name,
        amount: recurringSeries.expectedAmount,
        currency: recurringSeries.currency,
        direction: recurringSeries.direction,
        frequency: recurringSeries.frequency,
      })
      .from(recurringSeries)
      .where(
        and(
          eq(recurringSeries.householdId, householdId),
          eq(recurringSeries.detectedBy, 'system'),
          isNull(recurringSeries.confirmedAt),
          isNull(recurringSeries.deletedAt),
        ),
      )
      // The most confident first: the ones a person will recognise at a glance.
      .orderBy(desc(recurringSeries.confidence), desc(recurringSeries.occurrenceCount))
      .limit(SHOWN),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    amount: Money.fromDecimalString(
      row.amount,
      row.currency.trim() === 'PAB' ? 'PAB' : 'USD',
    ).abs(),
    direction: row.direction,
    frequency: row.frequency,
  }));
}
