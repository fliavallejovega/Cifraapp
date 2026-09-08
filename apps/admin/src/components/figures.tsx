import { EmptyState } from '@app/ui';
import type { ReactNode } from 'react';

/**
 * The console's own display pieces.
 *
 * Three of them, and each exists because the product's components do not cover
 * this case: a reading with its own label, a series drawn from rows, and a
 * proportion drawn as a bar. No library — every one is a handful of elements,
 * and a chart dependency in an internal tool is a dependency that has to be
 * upgraded forever.
 *
 * All three are built for the state this console is actually in most of the
 * time on a young product: nothing to show. A zero here is a real answer and
 * says so; an empty series does not draw a flat line pretending to be data.
 */

/** A figure with its label, in the measurement face. */
export function Reading({
  label,
  value,
  detail,
  tone = 'plain',
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
  readonly tone?: 'plain' | 'brand' | 'muted';
}) {
  return (
    <div>
      <p className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
        {label}
      </p>
      <p
        className={[
          'readout mt-2 text-3xl leading-none',
          tone === 'brand' ? 'text-[color:var(--color-brand-strong)]' : '',
          tone === 'muted' ? 'text-[color:var(--color-ink-secondary)]' : '',
        ].join(' ')}
      >
        {value}
      </p>
      {detail && (
        <p className="mt-2 text-xs text-pretty text-[color:var(--color-ink-tertiary)]">{detail}</p>
      )}
    </div>
  );
}

/** A card carrying one reading. */
export function Metric(props: Parameters<typeof Reading>[0]) {
  return (
    <div className="rounded-(--radius-lg) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] p-5 shadow-(--shadow-card)">
      <Reading {...props} />
    </div>
  );
}

/**
 * A series of counts, as columns.
 *
 * Every bucket is drawn, including the empty ones — the shape of a quiet month
 * is information, and a chart that skips its zeros draws a different shape than
 * the truth. When every bucket is zero, no bars are drawn at all and the
 * caption says what would appear here, because twelve flat stubs read as a
 * broken chart rather than as an honest nothing.
 */
export function Series({
  buckets,
  label,
  emptyTitle,
  emptyBody,
}: {
  readonly buckets: readonly { start: string; value: number }[];
  readonly label: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
}) {
  const peak = Math.max(...buckets.map((bucket) => bucket.value), 0);

  if (peak === 0) {
    return <EmptyState title={emptyTitle} body={emptyBody} />;
  }

  const month = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });

  return (
    <figure>
      <figcaption className="sr-only">{label}</figcaption>
      <div className="flex h-40 items-end gap-1.5" role="img" aria-label={label}>
        {buckets.map((bucket) => (
          // `h-full` matters: the bar's height is a percentage, and a
          // percentage resolves against a parent with a definite height. In an
          // auto-height column it resolved to nothing and the chart drew its
          // labels above an empty strip.
          <div
            key={bucket.start}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
          >
            <span className="gradation-label">{bucket.value > 0 ? bucket.value : ''}</span>
            <div
              className="w-full rounded-t-(--radius-xs) bg-[color:var(--color-brand)] transition-[height] duration-(--duration-settle) ease-(--ease-settle)"
              style={{
                // A bucket with something in it never draws as nothing: the
                // floor is a visible sliver, so «one» and «none» differ.
                height: `${String(Math.max((bucket.value / peak) * 100, bucket.value > 0 ? 4 : 0))}%`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5 border-t border-[color:var(--color-rule)] pt-2">
        {buckets.map((bucket, index) => (
          <span
            key={bucket.start}
            className="gradation-label min-w-0 flex-1 truncate text-center"
            // Twelve dates do not fit; every third one does, and the axis reads
            // as an axis rather than as a smear.
            aria-hidden={index % 3 !== 0}
          >
            {index % 3 === 0 ? month(bucket.start) : ''}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** A share of a whole, as a bar. Used for plan mix and queue composition. */
export function Share({
  rows,
  total,
  empty,
}: {
  readonly rows: readonly { key: string; label: string; value: number; detail?: string }[];
  readonly total: number;
  readonly empty: ReactNode;
}) {
  if (total === 0) return <>{empty}</>;

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-4">
            <span className="min-w-0 truncate text-sm">{row.label}</span>
            <span className="tabular shrink-0 text-sm">
              {row.value}
              {row.detail && (
                <span className="ml-2 text-[color:var(--color-ink-tertiary)]">{row.detail}</span>
              )}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-ground-sunk)]">
            <div
              className="h-full rounded-full bg-[color:var(--color-brand)] transition-[width] duration-(--duration-settle) ease-(--ease-settle)"
              style={{ width: `${String((row.value / total) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A page heading with room around it, matching the product's. */
export function ConsolePage({
  title,
  detail,
  actions,
  children,
}: {
  readonly title: string;
  readonly detail?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-10 sm:py-12">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <h1
            className="text-3xl font-medium text-balance sm:text-4xl"
            style={{ letterSpacing: 'var(--tracking-display)', lineHeight: 1.1 }}
          >
            {title}
          </h1>
          {detail && (
            <p className="mt-2 max-w-[72ch] text-pretty text-[color:var(--color-ink-secondary)]">
              {detail}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
