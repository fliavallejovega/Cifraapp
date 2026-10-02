import { describe, expect, it } from 'vitest';

import { tripNoticeFor } from './trip-notice';

const trip = { startDate: '2026-12-10', endDate: '2026-12-14', status: 'planning' } as const;

describe('tripNoticeFor', () => {
  it('stays quiet more than two weeks out, even with errands', () => {
    expect(
      tripNoticeFor({
        ...trip,
        today: '2026-11-01',
        errands: [{ kind: 'notify_bank', dueOn: '2026-10-01' }],
      }),
    ).toBeNull();
  });

  it('names the errands due today or overdue, and only those', () => {
    expect(
      tripNoticeFor({
        ...trip,
        today: '2026-12-07',
        errands: [
          { kind: 'buy_insurance', dueOn: '2026-11-26' },
          { kind: 'notify_bank', dueOn: '2026-12-07' },
          { kind: 'get_cash', dueOn: '2026-12-08' },
        ],
      }),
    ).toEqual({ kind: 'errands', errands: ['buy_insurance', 'notify_bank'] });
  });

  it('says the trip leaves tomorrow when nothing is pending', () => {
    expect(tripNoticeFor({ ...trip, today: '2026-12-09', errands: [] })).toEqual({
      kind: 'tomorrow',
    });
    expect(tripNoticeFor({ ...trip, today: '2026-12-08', errands: [] })).toBeNull();
  });

  it('counts the days during the trip', () => {
    expect(tripNoticeFor({ ...trip, today: '2026-12-10', errands: [] })).toEqual({
      kind: 'during',
      day: 1,
      days: 5,
    });
    expect(tripNoticeFor({ ...trip, today: '2026-12-14', errands: [] })).toMatchObject({ day: 5 });
  });

  it('asks to close the day after, once, and never for a closed trip', () => {
    expect(tripNoticeFor({ ...trip, today: '2026-12-15', errands: [] })).toEqual({ kind: 'after' });
    expect(tripNoticeFor({ ...trip, today: '2026-12-16', errands: [] })).toBeNull();
    expect(
      tripNoticeFor({ ...trip, status: 'completed', today: '2026-12-15', errands: [] }),
    ).toBeNull();
  });
});
