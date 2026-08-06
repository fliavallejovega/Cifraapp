import { formatMoney, type Money, type MoneyLocale } from '@app/domain';

import { cn } from '../utils/cn';

/**
 * The instrument gauge — this design system's signature device.
 *
 * A progress bar reports a fraction. A gauge reports a quantity against a
 * marked scale, which is what this product actually needs: knowing you have
 * $2,340 matters far less than knowing $2,340 sits above your buffer minimum
 * and below what next week's obligations will claim.
 *
 * Three regions, each meaning something different:
 *
 *   - **Level** — solid, to the left of the surface. Money that is actually
 *     available.
 *   - **Surface** — a 2px line. A level has a top edge, so it is drawn as one,
 *     never as a rounded pill cap.
 *   - **Claimed** — hatched, to the right. Borrowed from technical drawing,
 *     where hatching has always meant "spoken for". It is not texture for its
 *     own sake; it is the region a reader must not count as theirs.
 *
 * See DESIGN.md for the rules that govern it.
 */

export type ThresholdKind = 'buffer' | 'committed' | 'target';

export interface GaugeThreshold {
  readonly at: Money;
  readonly label: string;
  readonly kind: ThresholdKind;
}

export interface GaugeProps {
  /** The current level — what is actually available. */
  readonly value: Money;
  /** Top of the scale. A real ceiling, not an arbitrary round number. */
  readonly max: Money;
  /** Accessible name. Required — a gauge with no name is unreadable aloud. */
  readonly label: string;
  readonly thresholds?: readonly GaugeThreshold[];
  readonly locale?: MoneyLocale;
  readonly size?: 'full' | 'inline';
  readonly tone?: 'neutral' | 'negative' | 'caution';
  readonly className?: string;
}

const SCALE_FACTOR = 10_000;
const MINORS_PER_MAJOR = 5;

/**
 * Gradations a person would actually engrave: steps of 1, 2, 2.5 or 5 at some
 * power of ten, landing on four to six majors. Splitting the range into equal
 * fifths produces labels like 1,847 that nobody can read at a glance.
 */
function niceGradations(maxUnits: bigint): { majors: number[]; minors: number[] } {
  const max = Number(maxUnits);
  if (max <= 0) return { majors: [], minors: [] };

  const rough = max / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step =
    (normalized <= 1
      ? 1
      : normalized <= 2
        ? 2
        : normalized <= 2.5
          ? 2.5
          : normalized <= 5
            ? 5
            : 10) * magnitude;

  const majors: number[] = [];
  const minors: number[] = [];

  for (let tick = 0; tick <= max + step / 2; tick += step) {
    majors.push(tick);
    for (let sub = 1; sub < MINORS_PER_MAJOR; sub += 1) {
      const minor = tick + (step / MINORS_PER_MAJOR) * sub;
      if (minor < max) minors.push(minor);
    }
  }

  return { majors, minors };
}

function ratio(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(1, Math.max(0, part / whole));
}

/** `3,000` reads as `3k` on a scale, and should. */
function gradationLabel(units: number): string {
  const amount = units / SCALE_FACTOR;
  if (amount === 0) return '0';
  if (Math.abs(amount) >= 1000) {
    const thousands = amount / 1000;
    return `${Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
  }
  return amount.toFixed(0);
}

const THRESHOLD_COLOR: Record<ThresholdKind, string> = {
  buffer: 'var(--color-caution)',
  committed: 'var(--color-signal)',
  target: 'var(--color-positive)',
};

export function Gauge({
  value,
  max,
  label,
  thresholds = [],
  locale = 'es-PA',
  size = 'full',
  tone = 'neutral',
  className,
}: GaugeProps) {
  const maxUnits = Number(max.scaledUnits);
  const level = ratio(Number(value.scaledUnits), maxUnits);
  const { majors, minors } = niceGradations(max.scaledUnits);

  const isFull = size === 'full';
  const levelColor =
    tone === 'negative'
      ? 'var(--color-negative)'
      : tone === 'caution'
        ? 'var(--color-caution)'
        : 'var(--color-ink)';

  const belowBuffer = thresholds.find(
    (threshold) => threshold.kind === 'buffer' && value.scaledUnits < threshold.at.scaledUnits,
  );

  return (
    <div className={cn('w-full', className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={Number(value.toCurrencyString())}
        aria-valuemin={0}
        aria-valuemax={Number(max.toCurrencyString())}
        aria-valuetext={`${formatMoney(value, { locale })} — ${label}`}
        className={cn(
          'relative w-full overflow-hidden',
          'border-y border-[color:var(--color-rule-strong)]',
          'bg-[color:var(--color-ground-sunk)]',
          isFull ? 'h-12' : 'h-6',
        )}
      >
        {/* Claimed. Hatched because in technical drawing hatching means
            "spoken for" — the reader must not count this as theirs. */}
        <div
          aria-hidden
          className="absolute inset-y-0 right-0 transition-[left] duration-(--duration-settle) ease-(--ease-settle)"
          style={{
            left: `${String(level * 100)}%`,
            backgroundImage:
              'repeating-linear-gradient(-45deg, var(--color-rule) 0 1px, transparent 1px 7px)',
          }}
        />

        {/* The level, solid. At 13% opacity it was indistinguishable from the
            chamber, which left the hatch boundary doing all the work — an
            instrument's reading has to be unmistakable at a glance. */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 transition-[width] duration-(--duration-settle) ease-(--ease-settle)"
          style={{ width: `${String(level * 100)}%`, backgroundColor: levelColor }}
        />

        {/* Threshold marks. Drawn last so they read over the solid level, at
            2px so they survive being crossed by it. */}
        {thresholds.map((threshold) => (
          <div
            key={threshold.label}
            aria-hidden
            className="absolute inset-y-0 w-0.5"
            style={{
              left: `calc(${String(ratio(Number(threshold.at.scaledUnits), maxUnits) * 100)}% - 1px)`,
              backgroundColor: THRESHOLD_COLOR[threshold.kind],
            }}
          />
        ))}
      </div>

      {/* Gradations hang below the rule, the way a ruler's do. Majors carry a
          number; minors are there so the eye can interpolate between them. */}
      <div aria-hidden className="relative h-2">
        {minors.map((tick) => (
          <span
            key={`minor-${String(tick)}`}
            className="absolute top-0 h-1 w-px bg-[color:var(--color-rule)]"
            style={{ left: `${String(ratio(tick, maxUnits) * 100)}%` }}
          />
        ))}
        {majors.map((tick) => (
          <span
            key={`major-${String(tick)}`}
            className="absolute top-0 h-2 w-px bg-[color:var(--color-rule-strong)]"
            style={{ left: `${String(ratio(tick, maxUnits) * 100)}%` }}
          />
        ))}
      </div>

      <div aria-hidden className="relative mt-1 h-4 w-full">
        {majors.map((tick, index) => {
          const position = ratio(tick, maxUnits);
          const isLast = index === majors.length - 1;
          return (
            <span
              key={tick}
              className="gradation-label absolute top-0 whitespace-nowrap"
              style={{
                left: `${String(position * 100)}%`,
                transform: isLast ? 'translateX(-100%)' : index === 0 ? 'none' : 'translateX(-50%)',
              }}
            >
              {gradationLabel(tick)}
            </span>
          );
        })}
      </div>

      {/* Threshold names in words. The mark alone is decoration; the name is
          the information, and a colorblind reader needs it (spec §64). */}
      {thresholds.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5">
          {thresholds.map((threshold) => (
            <li
              key={threshold.label}
              className="flex items-center gap-2 text-xs text-[color:var(--color-ink-secondary)]"
            >
              <span
                aria-hidden
                className="h-3 w-px shrink-0"
                style={{ backgroundColor: THRESHOLD_COLOR[threshold.kind] }}
              />
              {threshold.label}
              <span className="tabular text-[color:var(--color-ink-tertiary)]">
                {formatMoney(threshold.at, { locale })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {belowBuffer && (
        <p className="mt-3 text-sm text-[color:var(--color-caution)]">{belowBuffer.label}</p>
      )}
    </div>
  );
}
