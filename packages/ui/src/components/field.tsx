'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

import { cn } from '../utils/cn';

/**
 * Form fields.
 *
 * Errors are announced, not merely colored, and they name the recovery rather
 * than the rule that was broken. A field bound to a wrong value in this product
 * eventually becomes a wrong number in a ledger, so validation is surfaced
 * inline as the user works, not withheld until submit.
 */

export interface FieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
  readonly children: (props: {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
  readonly className?: string;
}

export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-[color:var(--color-ink)]">
        {label}
        {required && (
          <span aria-hidden className="ml-1 text-[color:var(--color-ink-tertiary)]">
            *
          </span>
        )}
      </label>

      {children({ id, describedBy: describedBy || undefined, invalid: Boolean(error) })}

      {hint && !error && (
        <p id={hintId} className="text-xs text-[color:var(--color-ink-secondary)]">
          {hint}
        </p>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-xs text-[color:var(--color-negative)]">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL_BASE = cn(
  'w-full rounded-(--radius-sm) border bg-[color:var(--color-ground-raised)] px-3 text-[color:var(--color-ink)]',
  'placeholder:text-[color:var(--color-ink-tertiary)]',
  'transition-[border-color,box-shadow] duration-(--duration-quick) ease-(--ease-settle)',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--color-ink)]',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean;
  /** Renders in the measurement face. For amounts, account numbers, dates. */
  readonly numeric?: boolean;
}

export function Input({ invalid, numeric, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid ? true : undefined}
      className={cn(
        CONTROL_BASE,
        'h-10',
        numeric && 'readout text-right',
        invalid
          ? 'border-[color:var(--color-negative)]'
          : 'border-[color:var(--color-rule-strong)]',
        className,
      )}
      {...props}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly invalid?: boolean;
}

export function Select({ invalid, className, children, ...props }: SelectProps) {
  return (
    <select
      aria-invalid={invalid ? true : undefined}
      className={cn(
        CONTROL_BASE,
        'h-10 appearance-none pr-8',
        invalid
          ? 'border-[color:var(--color-negative)]'
          : 'border-[color:var(--color-rule-strong)]',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
