import { formatAmount, formatDay } from '@/lib/trip-format';

/**
 * The report's two charts, drawn by hand in the product's own marks.
 *
 * Actual is the one series and wears the brand's brass; the plan is a
 * reference — a tick on each bar, a dashed line over the days — in neutral
 * ink, so the eye reads «where did we land against where we meant to». Every
 * figure is also written out, and the cumulative chart carries a table for
 * anyone who cannot see it.
 */

const units = (value: string): number => {
  // Display geometry only: a position on screen, never money arithmetic.
  const [w = '0', f = ''] = value.replace(/^-/, '').split('.');
  return Number(w) + Number(`0.${f || '0'}`);
};

export function CategoryBars({
  rows,
  currency,
  locale,
  labels,
}: {
  readonly rows: readonly { key: string; label: string; planned: string; actual: string }[];
  readonly currency: string;
  readonly locale: string;
  readonly labels: { readonly actual: string; readonly planned: string };
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [units(r.planned), units(r.actual)]));
  return (
    <ul className="flex flex-col gap-5">
      {rows.map((row) => {
        const actualPct = (units(row.actual) / max) * 100;
        const plannedPct = (units(row.planned) / max) * 100;
        const text = `${row.label}: ${labels.actual} ${formatAmount(row.actual, currency, locale)}, ${labels.planned} ${formatAmount(row.planned, currency, locale)}`;
        return (
          <li key={row.key} className="flex flex-col gap-2" title={text}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="font-medium">{row.label}</span>
              <span className="text-[color:var(--color-ink-secondary)] tabular-nums">
                {formatAmount(row.actual, currency, locale)} · {labels.planned}{' '}
                {formatAmount(row.planned, currency, locale)}
              </span>
            </div>
            <div
              className="relative h-3 rounded-full bg-[color:var(--color-ground-sunk)]"
              role="img"
              aria-label={text}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--color-brand)]"
                style={{ width: `${String(actualPct)}%` }}
              />
              <div
                className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-[color:var(--color-ink)]"
                style={{ left: `calc(${String(plannedPct)}% - 1px)` }}
                aria-hidden="true"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function CumulativeLine({
  days,
  currency,
  locale,
  labels,
}: {
  readonly days: readonly { key: string; cumulativePlanned: string; cumulativeActual: string }[];
  readonly currency: string;
  readonly locale: string;
  readonly labels: {
    readonly actual: string;
    readonly planned: string;
    readonly day: string;
    readonly caption: string;
  };
}) {
  const width = 600;
  const height = 200;
  const pad = { top: 8, right: 0, bottom: 8, left: 0 };
  const max = Math.max(
    1,
    ...days.flatMap((d) => [units(d.cumulativePlanned), units(d.cumulativeActual)]),
  );
  const x = (i: number) =>
    pad.left + (days.length <= 1 ? 0 : (i / (days.length - 1)) * (width - pad.left - pad.right));
  const y = (v: string) => pad.top + (1 - units(v) / max) * (height - pad.top - pad.bottom);
  const path = (pick: (d: (typeof days)[number]) => string) =>
    days
      .map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pick(d)).toFixed(1)}`)
      .join(' ');
  const last = days[days.length - 1];
  const step = days.length > 1 ? (width - pad.left - pad.right) / (days.length - 1) : width;

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-0.5 w-5 rounded-full bg-[color:var(--color-brand)]"
          />
          {labels.actual}
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="w-5 border-t-2 border-dashed border-[color:var(--color-ink-tertiary)]"
          />
          {labels.planned}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <svg
          viewBox={`0 0 ${String(width)} ${String(height)}`}
          preserveAspectRatio="none"
          className="h-48 w-full sm:h-64"
          role="img"
          aria-label={labels.caption}
        >
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={height - pad.bottom}
            y2={height - pad.bottom}
            stroke="var(--color-rule)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={path((d) => d.cumulativePlanned)}
            fill="none"
            stroke="var(--color-ink-tertiary)"
            strokeWidth="2"
            strokeDasharray="6 5"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={path((d) => d.cumulativeActual)}
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth="2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {days.map((d, i) => (
            <rect
              key={d.key}
              x={x(i) - step / 2}
              y={0}
              width={step}
              height={height}
              fill="transparent"
            >
              <title>
                {`${formatDay(d.key, locale, { day: 'numeric', month: 'short' })} — ${labels.actual}: ${formatAmount(d.cumulativeActual, currency, locale)} · ${labels.planned}: ${formatAmount(d.cumulativePlanned, currency, locale)}`}
              </title>
            </rect>
          ))}
        </svg>
        <div
          aria-hidden="true"
          className="flex justify-between gap-2 text-sm text-[color:var(--color-ink-secondary)] tabular-nums"
        >
          {days.map((d, i) => (
            <span
              key={d.key}
              className={i === 0 || i === days.length - 1 ? '' : 'hidden sm:inline'}
            >
              {formatDay(d.key, locale, { day: 'numeric', month: 'short' })}
            </span>
          ))}
        </div>
        {last && (
          <p className="text-sm text-[color:var(--color-ink-secondary)] tabular-nums">
            {labels.actual} {formatAmount(last.cumulativeActual, currency, locale)} ·{' '}
            {labels.planned} {formatAmount(last.cumulativePlanned, currency, locale)}
          </p>
        )}
      </div>
      <figcaption className="sr-only">
        <table>
          <caption>{labels.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{labels.day}</th>
              <th scope="col">{labels.actual}</th>
              <th scope="col">{labels.planned}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.key}>
                <th scope="row">{d.key}</th>
                <td>{formatAmount(d.cumulativeActual, currency, locale)}</td>
                <td>{formatAmount(d.cumulativePlanned, currency, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
