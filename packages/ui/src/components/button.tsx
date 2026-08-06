'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../utils/cn';

/**
 * The primary action is solid ink, not a brand color. There is no brand accent
 * in this system — hue is reserved for financial meaning, so a blue button
 * would compete with the one thing color is supposed to say.
 *
 * Feedback lands on pointer-down via `:active`, not on release. Waiting for the
 * click event to show that a press registered is the single most common way an
 * interface stops feeling direct.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly loading?: boolean;
  readonly children: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[color:var(--color-ink)] text-[color:var(--color-ink-inverse)] hover:opacity-88 active:opacity-80',
  secondary:
    'border border-[color:var(--color-rule-strong)] text-[color:var(--color-ink)] hover:bg-[color:var(--color-ground-sunk)]',
  ghost: 'text-[color:var(--color-ink-secondary)] hover:text-[color:var(--color-ink)]',
  destructive:
    'bg-[color:var(--color-negative)] text-[color:var(--color-ink-inverse)] hover:opacity-88 active:opacity-80',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-(--radius-sm) font-medium whitespace-nowrap',
        'transition-[opacity,background-color,transform] duration-(--duration-tap) ease-(--ease-settle)',
        'active:scale-[0.985]',
        'disabled:pointer-events-none disabled:opacity-45',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-ink)]',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 animate-spin"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      <circle cx="8" cy="8" r="6" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" strokeLinecap="round" />
    </svg>
  );
}
