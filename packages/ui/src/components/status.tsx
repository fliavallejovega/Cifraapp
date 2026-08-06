import type { ReactNode } from 'react';

import { cn } from '../utils/cn';

/**
 * Status marks.
 *
 * Every one carries a word. Color is a second signal, never the only one — a
 * reader who cannot distinguish the hues must still be able to tell a reconciled
 * transaction from one that needs review (spec §64).
 *
 * No pill shapes with saturated fills. A status is a small mark against a
 * gradation, in the same register as everything else on the page.
 */

export type StatusTone = 'neutral' | 'positive' | 'negative' | 'caution' | 'signal';

export interface StatusProps {
  readonly tone?: StatusTone;
  readonly children: ReactNode;
  readonly className?: string;
}

const TONES: Record<StatusTone, { text: string; mark: string }> = {
  neutral: {
    text: 'text-[color:var(--color-ink-secondary)]',
    mark: 'bg-[color:var(--color-ink-tertiary)]',
  },
  positive: {
    text: 'text-[color:var(--color-positive)]',
    mark: 'bg-[color:var(--color-positive)]',
  },
  negative: {
    text: 'text-[color:var(--color-negative)]',
    mark: 'bg-[color:var(--color-negative)]',
  },
  caution: {
    text: 'text-[color:var(--color-caution)]',
    mark: 'bg-[color:var(--color-caution)]',
  },
  signal: { text: 'text-[color:var(--color-signal)]', mark: 'bg-[color:var(--color-signal)]' },
};

export function Status({ tone = 'neutral', children, className }: StatusProps) {
  const { text, mark } = TONES[tone];

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', text, className)}>
      <span aria-hidden className={cn('h-2.5 w-0.5 shrink-0', mark)} />
      {children}
    </span>
  );
}

/**
 * Provenance — where a classification came from.
 *
 * Shown wherever the system decided something on the user's behalf, because a
 * recommendation nobody can trace is a recommendation nobody should trust
 * (spec §98). The label is the value; there is no icon standing in for it.
 */
export type ProvenanceSource = 'system' | 'user' | 'ai' | 'accountant' | 'imported' | 'rule';

export interface ProvenanceProps {
  readonly source: ProvenanceSource;
  readonly label: string;
  readonly confidence?: 'high' | 'medium' | 'low';
  readonly confidenceLabel?: string;
  readonly className?: string;
}

export function Provenance({
  source,
  label,
  confidence,
  confidenceLabel,
  className,
}: ProvenanceProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 text-xs text-[color:var(--color-ink-tertiary)]',
        className,
      )}
      data-source={source}
    >
      {label}
      {confidence && confidenceLabel && (
        <span className={cn(confidence === 'low' && 'text-[color:var(--color-caution)]')}>
          {confidenceLabel}
        </span>
      )}
    </span>
  );
}
