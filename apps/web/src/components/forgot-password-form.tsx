'use client';

import { Button, Field, Input, Problem } from '@app/ui';
import type { AuthError } from '@supabase/supabase-js';
import { useState } from 'react';

import { getBrowserClient } from '@/lib/supabase-browser';
import { getRecoveryClient } from '@/lib/supabase-recovery';

/**
 * Asking for a password reset.
 *
 * Uses the implicit recovery flow so the email link carries tokens in the URL
 * fragment on the reset page. PKCE would require opening the link in the exact
 * same browser that submitted this form — email apps and prefetchers break that.
 *
 * The response never says whether the address has an account. "We sent it if it
 * exists" is the only answer that does not turn this form into a way to find out
 * who banks here.
 */

export interface ForgotPasswordLabels {
  readonly email: string;
  readonly submit: string;
  readonly sent: string;
  readonly rateLimited: string;
  readonly errorTitle: string;
  readonly errorBody: string;
}

type ForgotState = 'idle' | 'pending' | 'sent' | 'failed' | 'rateLimited';

function isRateLimited(error: AuthError): boolean {
  return (
    error.status === 429 ||
    error.code === 'over_email_send_rate_limit' ||
    (error.message?.toLowerCase().includes('rate limit') ?? false)
  );
}

export function ForgotPasswordForm({
  labels,
  redirectTo,
}: {
  labels: ForgotPasswordLabels;
  redirectTo: string;
}) {
  const [state, setState] = useState<ForgotState>('idle');

  async function send(form: FormData) {
    setState('pending');

    const email = form.get('email');
    if (typeof email !== 'string') {
      setState('failed');
      return;
    }

    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      setState('failed');
      return;
    }

    const { error } = await getRecoveryClient().auth.resetPasswordForEmail(trimmed, {
      redirectTo,
    });

    if (!error) {
      setState('sent');
      return;
    }

    if (isRateLimited(error)) {
      setState('rateLimited');
      return;
    }

    // A failure here is a transport or configuration problem. An unknown address is
    // not an error and must not look like one.
    setState(error.status === 400 ? 'sent' : 'failed');
  }

  if (state === 'sent') {
    return (
      <p role="status" className="max-w-[52ch] text-pretty">
        {labels.sent}
      </p>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send(new FormData(event.currentTarget));
      }}
      className="flex flex-col gap-5"
    >
      {state === 'rateLimited' && (
        <Problem title={labels.errorTitle} body={labels.rateLimited} />
      )}

      {state === 'failed' && <Problem title={labels.errorTitle} body={labels.errorBody} />}

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

      <Button type="submit" loading={state === 'pending'} size="lg" className="mt-2 w-full">
        {labels.submit}
      </Button>
    </form>
  );
}
