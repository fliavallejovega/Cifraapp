'use client';

import { Button, Field, Input, Problem } from '@app/ui';
import { useActionState } from 'react';

import type { ActionResult } from '@/server/auth-actions';

export function AuthForm({
  action,
}: {
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && (
        <Problem
          title="Could not sign in"
          body={
            state.error === 'invalidCredentials'
              ? 'Enter a valid email and a password of at least eight characters.'
              : 'Check your email and password and try again.'
          }
        />
      )}

      <Field label="Email" required>
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

      <Field label="Password" required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            aria-describedby={describedBy}
          />
        )}
      </Field>

      <Button type="submit" loading={pending} size="lg" className="mt-2 w-full">
        Sign in
      </Button>
    </form>
  );
}
