'use client';

import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

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
  'w-full rounded-(--radius-sm) border bg-[color:var(--color-surface)] px-3 text-[color:var(--color-ink)]',
  'shadow-[inset_0_1px_2px_var(--c-shadow-near)]',
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
          : 'border-[color:var(--color-surface-border)] hover:border-[color:var(--color-rule-strong)]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A password field that can show what is being typed.
 *
 * Hidden by default, because a password field on a shared screen is the reason
 * the masking exists. But a person who cannot see what they typed retypes it,
 * and on a phone keyboard a long password entered blind is where sign-up is
 * abandoned — so the choice belongs to whoever is at the keyboard.
 *
 * Three details make the difference between a reveal that works and one that
 * quietly breaks the form:
 *
 *   - `type="button"`, so pressing it never submits. A toggle that submits a
 *     half-typed password is worse than no toggle.
 *   - The input keeps its `name`, `autoComplete` and every other attribute
 *     when the type changes, so a password manager still recognises the field
 *     and still offers to save it.
 *   - The label says what the button will do next, and `aria-pressed` carries
 *     the current state, so a screen reader gets both. An icon alone would
 *     leave «is it showing or hiding?» to guesswork — and it is exactly the
 *     kind of guess a person makes wrong while typing a secret.
 *
 * It is deliberately not automatic on `type="password"` inside `Input`: a
 * field asking for a card's security code, or a one-time code already visible
 * on another screen, has no use for it.
 */
export interface PasswordInputProps extends Omit<InputProps, 'type'> {
  /** «Show password» — the action, not the state. */
  readonly showLabel: string;
  /** «Hide password». */
  readonly hideLabel: string;
}

export function PasswordInput({
  showLabel,
  hideLabel,
  invalid,
  className,
  ...props
}: PasswordInputProps) {
  const [shown, setShown] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? 'text' : 'password'}
        invalid={invalid ?? false}
        // Room for the button, so a long password never runs underneath it.
        className={cn('pr-12', className)}
      />
      <button
        type="button"
        onClick={() => {
          setShown((current) => !current);
        }}
        aria-pressed={shown}
        aria-label={shown ? hideLabel : showLabel}
        title={shown ? hideLabel : showLabel}
        className={cn(
          'absolute inset-y-0 right-0 flex w-11 items-center justify-center',
          'rounded-r-(--radius-sm) text-[color:var(--color-ink-tertiary)]',
          'transition-colors duration-(--duration-quick) ease-(--ease-settle)',
          'hover:text-[color:var(--color-ink)]',
          'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--color-ink)]',
        )}
      >
        <EyeIcon crossed={shown} />
      </button>
    </div>
  );
}

/**
 * One eye, with or without the stroke through it.
 *
 * Drawn here rather than imported: the design system's rule is a single icon
 * family at a single weight, and a password field is not a good enough reason
 * to introduce a second one.
 */
function EyeIcon({ crossed }: { readonly crossed: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1.8 10S4.9 4.7 10 4.7 18.2 10 18.2 10 15.1 15.3 10 15.3 1.8 10 1.8 10Z" />
      <circle cx="10" cy="10" r="2.4" />
      {crossed && <path d="M3.5 16.5 16.5 3.5" />}
    </svg>
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
          : 'border-[color:var(--color-surface-border)] hover:border-[color:var(--color-rule-strong)]',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
