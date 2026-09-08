'use client';

import { Button, Problem } from '@app/ui';
import { useActionState } from 'react';

import { OtpInput } from './otp-input';
import { verifySignIn, type MfaResult } from '@/server/mfa-actions';

/**
 * The second step of signing in.
 *
 * A code, six boxes, no button to find. The button exists for keyboards and
 * for the case where the automatic submit did not fire, but the ordinary path
 * never touches it.
 */
export function TwoFactorForm({
  locale,
  next,
  labels,
}: {
  readonly locale: string;
  readonly next?: string;
  readonly labels: {
    readonly code: string;
    readonly submit: string;
    readonly errorTitle: string;
    readonly errors: Record<string, string>;
  };
}) {
  const [state, action, pending] = useActionState<MfaResult, FormData>(verifySignIn, {});

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="locale" value={locale} />
      {next && <input type="hidden" name="next" value={next} />}

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      <OtpInput label={labels.code} disabled={pending} invalid={Boolean(state.error)} />

      <Button type="submit" loading={pending} variant="secondary" className="sm:self-start">
        {labels.submit}
      </Button>
    </form>
  );
}
