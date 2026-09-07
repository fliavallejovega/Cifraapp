import type { ReactNode } from 'react';

import { cn } from '../utils/cn';

/**
 * The surface.
 *
 * The first design system refused cards on principle — structure came from
 * hairlines and space, and the page was one continuous sheet of paper. It was
 * coherent and it read as empty. The redesign overturns that refusal
 * deliberately: a household's position, its plan and its statements are
 * documents, and a document sits ON the desk, not printed into it.
 *
 * What survives from the old principle is restraint about how a surface is
 * held: a hairline border plus a soft offset shadow, never a heavy outline,
 * never a zero-offset halo, and never a card inside a card — nesting is the
 * failure mode that made cards worth refusing in the first place.
 */

export type CardTone = 'surface' | 'panel' | 'sunk';

export interface CardProps {
  readonly children: ReactNode;
  readonly tone?: CardTone;
  /** `md` for content regions; `lg` for the screen's one hero surface. */
  readonly padding?: 'none' | 'md' | 'lg';
  /** Lifts slightly on hover. Only for a card that is itself a link target. */
  readonly interactive?: boolean;
  readonly className?: string;
}

const TONES: Record<CardTone, string> = {
  surface:
    'bg-[color:var(--color-surface)] border border-[color:var(--color-surface-border)] shadow-(--shadow-card)',
  /* The inverse world: deep ink, ivory text, for the one surface per screen
     that carries the headline reading. */
  panel:
    'panel-scope bg-[color:var(--color-panel)] text-[color:var(--color-panel-ink)] border border-[color:var(--color-panel-rule)] shadow-(--shadow-card)',
  /* Recessed, borderless — a quiet region inside the page, not an object. */
  sunk: 'bg-[color:var(--color-ground-sunk)]',
};

const PADDING: Record<NonNullable<CardProps['padding']>, string> = {
  none: '',
  md: 'p-5 sm:p-6',
  lg: 'p-6 sm:p-8',
};

export function Card({
  children,
  tone = 'surface',
  padding = 'md',
  interactive = false,
  className,
}: CardProps) {
  return (
    <div
      className={cn(
        'rounded-(--radius-lg)',
        TONES[tone],
        PADDING[padding],
        interactive &&
          'transition-[box-shadow,transform] duration-(--duration-quick) ease-(--ease-settle) hover:-translate-y-px hover:shadow-(--shadow-card-hover)',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A single figure with its label, inside a card row. The building block of the
 * summary strip at the top of a screen — label above, reading below, in the
 * measurement face.
 */
export interface StatProps {
  readonly label: string;
  readonly children: ReactNode;
  readonly detail?: string;
  readonly className?: string;
}

export function Stat({ label, children, detail, className }: StatProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
        {label}
      </span>
      <span className="readout text-xl text-[color:var(--color-ink)] sm:text-2xl">{children}</span>
      {detail && <span className="text-xs text-[color:var(--color-ink-secondary)]">{detail}</span>}
    </div>
  );
}
