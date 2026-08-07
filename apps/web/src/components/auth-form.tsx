'use client';

import { Button, Field, Input, Problem } from '@app/ui';
import { useActionState } from 'react';

import type { ActionResult } from '@/server/auth-actions';

/**
 * The sign-in and sign-up form.
 *
 * One component for both, because they differ by a single field and a label
 * set — and two near-identical forms drift apart until one of them loses its
 * error handling.
 *
 * Passwords are never echoed back into the form on failure. The browser's own
 * password manager is the right place for them to persist, not a server round
 * trip.
 */

export interface AuthFormLabels {
  readonly email: string;
  readonly password: string;
  readonly passwordHint: string;
  readonly displayName?: string;
  readonly submit: string;
  readonly errorTitle: string;
  readonly errors: Record<string, string>;
  readonly notices: Record<string, string>;
}

export interface AuthFormProps {
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly labels: AuthFormLabels;
  readonly locale: string;
  readonly next?: string;
  readonly withDisplayName?: boolean;
}

export function AuthForm({ action, labels, locale, next, withDisplayName }: AuthFormProps) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      {next && <input type="hidden" name="next" value={next} />}

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      {state.notice && (
        <p
          role="status"
          className="border-l border-[color:var(--color-positive)] bg-[color:var(--color-positive-sunk)] px-4 py-3 text-sm"
        >
          {labels.notices[state.notice] ?? state.notice}
        </p>
      )}

      {withDisplayName && labels.displayName && (
        <Field label={labels.displayName}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              name="displayName"
              autoComplete="name"
              aria-describedby={describedBy}
              maxLength={80}
            />
          )}
        </Field>
      )}

      <Field label={labels.email} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            aria-describedby={describedBy}
          />
        )}
      </Field>

      <Field label={labels.password} hint={labels.passwordHint} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="password"
            type="password"
            autoComplete={withDisplayName ? 'new-password' : 'current-password'}
            required
            minLength={8}
            aria-describedby={describedBy}
          />
        )}
      </Field>

      <Button type="submit" loading={pending} size="lg" className="mt-2 w-full">
        {labels.submit}
      </Button>
    </form>
  );
}
