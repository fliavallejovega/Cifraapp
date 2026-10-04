import { Card, Status, type StatusTone } from '@app/ui';

import { Link } from '@/i18n/navigation';
import { daysFrom, formatAmount, formatDateRange, shareOf } from '@/lib/trip-format';

/**
 * One trip in the list: where, when, and the one figure that matters for its
 * moment — how much is saved before it, how much is spent during it.
 *
 * The whole card is the link; the action line at the bottom says what the tap
 * will do. Long names wrap to two lines and long city lists truncate, so a
 * twelve-city tour and a weekend in Boquete sit in the same grid.
 */

export type TripMoment = 'current' | 'upcoming' | 'idea' | 'past';

export interface TripCardData {
  readonly id: string;
  readonly name: string;
  /** A typographic mark — the country code — instead of an emoji, which DESIGN.md refuses. */
  readonly mark: string;
  readonly cities: readonly string[];
  readonly startDate: string;
  readonly endDate: string;
  readonly moment: TripMoment;
  readonly currency: string;
  readonly totalBudget: string;
  readonly spent: string;
  readonly goal: { readonly current: string; readonly target: string } | null;
}

export interface TripCardLabels {
  readonly moment: Record<TripMoment, string>;
  readonly startsIn: (days: number) => string;
  readonly saved: (saved: string, target: string) => string;
  readonly spentOf: (spent: string, total: string) => string;
  readonly action: Record<TripMoment, string>;
  readonly noCities: string;
}

const TONE: Record<TripMoment, StatusTone> = {
  current: 'signal',
  upcoming: 'neutral',
  idea: 'neutral',
  past: 'neutral',
};

export function TripCard({
  trip,
  locale,
  today,
  labels,
  featured = false,
}: {
  readonly trip: TripCardData;
  readonly locale: string;
  readonly today: string;
  readonly labels: TripCardLabels;
  readonly featured?: boolean;
}) {
  const progress =
    trip.moment === 'current' || trip.moment === 'past'
      ? {
          value: shareOf(trip.spent, trip.totalBudget),
          text: labels.spentOf(
            formatAmount(trip.spent, trip.currency, locale),
            formatAmount(trip.totalBudget, trip.currency, locale),
          ),
        }
      : trip.goal
        ? {
            value: shareOf(trip.goal.current, trip.goal.target),
            text: labels.saved(
              formatAmount(trip.goal.current, trip.currency, locale),
              formatAmount(trip.goal.target, trip.currency, locale),
            ),
          }
        : null;
  const days = daysFrom(today, trip.startDate);
  const href = trip.moment === 'current' ? `/trips/${trip.id}/today` : `/trips/${trip.id}`;

  return (
    <Link
      href={href}
      className="group block min-w-0 rounded-(--radius-lg) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-ink)]"
    >
      <Card
        interactive
        tone={featured ? 'panel' : 'surface'}
        className="flex h-full flex-col gap-4"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-(--radius-md) border border-[color:var(--color-rule)] text-sm font-medium tracking-[0.06em] text-[color:var(--color-ink-secondary)]"
          >
            {trip.mark}
          </span>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-lg leading-snug font-medium break-words">{trip.name}</p>
            <p className="mt-1 truncate text-sm text-[color:var(--color-ink-secondary)]">
              {trip.cities.length > 0 ? trip.cities.join(' · ') : labels.noCities}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-[color:var(--color-ink-secondary)] tabular-nums">
            {formatDateRange(trip.startDate, trip.endDate, locale)}
          </span>
          <Status tone={TONE[trip.moment]}>
            {trip.moment === 'upcoming' && days > 0
              ? labels.startsIn(days)
              : labels.moment[trip.moment]}
          </Status>
        </div>

        {progress && (
          <div className="flex flex-col gap-2">
            <div
              className="h-2 overflow-hidden rounded-full bg-[color:var(--color-ground-sunk)]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress.value)}
              aria-label={progress.text}
            >
              <div
                className="h-full origin-left rounded-full bg-[color:var(--color-brand)] transition-transform duration-(--duration-quick)"
                style={{ transform: `scaleX(${String(progress.value / 100)})` }}
              />
            </div>
            <p className="text-sm text-[color:var(--color-ink-secondary)] tabular-nums">
              {progress.text}
            </p>
          </div>
        )}

        <p className="mt-auto text-sm font-medium underline decoration-[color:var(--color-rule-strong)] underline-offset-4 group-hover:decoration-[color:var(--color-brand)]">
          {labels.action[trip.moment]}
        </p>
      </Card>
    </Link>
  );
}
