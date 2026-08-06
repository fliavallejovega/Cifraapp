import type { ReactNode } from 'react';

import { cn } from '../utils/cn';

/**
 * Empty, loading and error surfaces.
 *
 * An empty state teaches rather than apologizes. "No transactions yet" tells a
 * user what they already know; "Import your first statement" tells them what to
 * do about it (spec §75).
 */

export interface EmptyStateProps {
  readonly title: string;
  readonly body?: string;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function EmptyState({ title, body, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 border-t border-[color:var(--color-rule)] py-12',
        className,
      )}
    >
      <p className="text-lg text-[color:var(--color-ink)]">{title}</p>
      {body && (
        <p className="max-w-[60ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {body}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * A loading placeholder that matches the shape of what is arriving. A spinner
 * where a table belongs tells the reader nothing about what to expect.
 */
export interface SkeletonProps {
  readonly className?: string;
  /** Renders as a figure-width block, so a money column does not shift on load. */
  readonly numeric?: boolean;
}

export function Skeleton({ className, numeric }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'block animate-pulse rounded-(--radius-xs) bg-[color:var(--color-ground-sunk)]',
        numeric ? 'h-4 w-20' : 'h-4 w-full',
        className,
      )}
    />
  );
}

/**
 * A recoverable problem, stated in the user's terms.
 *
 * Never the underlying error: a database message can carry account numbers and
 * connection strings, and this component renders in surfaces that touch both
 * (spec §74).
 */
export interface ProblemProps {
  readonly title: string;
  readonly body?: string;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function Problem({ title, body, action, className }: ProblemProps) {
  return (
    <div
      role="alert"
      className={cn(
        // A 1px rule, not a thick accent bar — the mark identifies the region
        // without becoming the loudest thing on the page.
        'flex flex-col items-start gap-2 border-l border-[color:var(--color-negative)] bg-[color:var(--color-negative-sunk)] px-4 py-3',
        className,
      )}
    >
      <p className="text-sm font-medium text-[color:var(--color-ink)]">{title}</p>
      {body && (
        <p className="max-w-[60ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {body}
        </p>
      )}
      {action}
    </div>
  );
}
