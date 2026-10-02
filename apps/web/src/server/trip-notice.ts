/**
 * What, if anything, a trip has to say today — one sentence at most.
 *
 * Before the trip it speaks only when an errand is due (or overdue) or the
 * trip leaves tomorrow; during it, once each morning; after it, the day after
 * it ends, until the trip is closed. Never two in a day: a family on holiday
 * that gets three notices mutes all of them.
 */

export type TripNotice =
  | { readonly kind: 'errands'; readonly errands: readonly string[] }
  | { readonly kind: 'tomorrow' }
  | { readonly kind: 'during'; readonly day: number; readonly days: number }
  | { readonly kind: 'after' };

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

export function tripNoticeFor(input: {
  readonly today: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly status: string;
  /** Errands not done, with their due date. */
  readonly errands: readonly { readonly kind: string; readonly dueOn: string | null }[];
}): TripNotice | null {
  if (input.status === 'completed' || input.status === 'cancelled') return null;
  const today = dayNumber(input.today);
  const start = dayNumber(input.startDate);
  const end = dayNumber(input.endDate);

  if (today < start) {
    if (start - today > 14) return null;
    const due = input.errands.filter((e) => e.dueOn !== null && dayNumber(e.dueOn) <= today);
    if (due.length > 0) return { kind: 'errands', errands: due.map((e) => e.kind) };
    return start - today === 1 ? { kind: 'tomorrow' } : null;
  }
  if (today <= end) return { kind: 'during', day: today - start + 1, days: end - start + 1 };
  return today === end + 1 ? { kind: 'after' } : null;
}
