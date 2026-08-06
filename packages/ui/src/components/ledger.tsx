import type { ReactNode } from 'react';

import { cn } from '../utils/cn';

/**
 * Tabular financial data.
 *
 * Rows are separated by hairline gradations rather than enclosed in cards. A
 * card around a transaction row adds a border, a radius and a shadow to
 * something whose only job is to let the eye run down a column of figures — and
 * every one of those makes the column harder to scan.
 *
 * Amount columns are right-aligned and tabular, always. That is not a
 * preference; misaligned figures are how a reader misreads a magnitude.
 */

export interface LedgerProps {
  readonly caption?: string;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Ledger({ caption, children, className }: LedgerProps) {
  return (
    <table className={cn('w-full border-collapse text-sm', className)}>
      {caption && <caption className="sr-only">{caption}</caption>}
      {children}
    </table>
  );
}

export function LedgerHead({ children }: { readonly children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-[color:var(--color-rule-strong)]">{children}</tr>
    </thead>
  );
}

export interface LedgerColumnProps {
  readonly children: ReactNode;
  readonly align?: 'start' | 'end';
  readonly className?: string;
}

export function LedgerColumn({ children, align = 'start', className }: LedgerColumnProps) {
  return (
    <th
      scope="col"
      className={cn(
        'gradation-label pb-2 font-normal uppercase',
        align === 'end' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function LedgerBody({ children }: { readonly children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export interface LedgerRowProps {
  readonly children: ReactNode;
  /** Dims the row without hiding it — for excluded or duplicate entries. */
  readonly muted?: boolean;
  readonly className?: string;
}

export function LedgerRow({ children, muted, className }: LedgerRowProps) {
  return (
    <tr
      className={cn(
        'border-b border-[color:var(--color-rule)]',
        'transition-colors duration-(--duration-quick) ease-(--ease-settle)',
        'hover:bg-[color:var(--color-ground-sunk)]',
        muted && 'opacity-55',
        className,
      )}
    >
      {children}
    </tr>
  );
}

export interface LedgerCellProps {
  readonly children: ReactNode;
  readonly align?: 'start' | 'end';
  /** Secondary information — a date, a category, an account. */
  readonly secondary?: boolean;
  readonly className?: string;
}

export function LedgerCell({ children, align = 'start', secondary, className }: LedgerCellProps) {
  return (
    <td
      className={cn(
        'py-3 align-baseline',
        align === 'end' ? 'text-right' : 'text-left',
        secondary && 'text-[color:var(--color-ink-secondary)]',
        className,
      )}
    >
      {children}
    </td>
  );
}
