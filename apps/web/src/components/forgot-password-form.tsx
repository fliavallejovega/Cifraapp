'use client';

import { Button, Field, Input, Problem } from '@app/ui';
import { useState } from 'react';

import { getBrowserClient } from '@/lib/supabase-browser';

/**
 * Asking for a password reset.
 *
 * Runs in the browser rather than through a server action, and that is not a
 * shortcut: `resetPasswordForEmail` from the browser client generates a PKCE
 * challenge and stores its verifier locally, so the link that arrives carries a
 * one-time `code` for `/auth/callback` to exchange. A reset requested on the
 * server would produce a link whose tokens land in the URL fragment, where no
 * server can see them — which is exactly the dead end this form exists to close.
 *
 * The response never says whether the address has an account. "We sent it if it
 * exists" is the only answer that does not turn this form into a way to find out
 * who banks here.
 */

export interface ForgotPasswordLabels {
  readonly email: string;
  readonly submit: string;
  readonly sent: string;
  readonly errorTitle: string;
  readonly errorBody: string;
}

export function ForgotPasswordForm({
  labels,
  locale,
}: {
  labels: ForgotPasswordLabels;
  locale: string;
}) {
  const [state, setState] = useState<'idle' | 'pending' | 'sent' | 'failed'>('idle');

  async function send(form: FormData) {
    setState('pending');

    const email = form.get('email');
    if (typeof email !== 'string') {
      setState('failed');
      return;
    }

    const { error } = await getBrowserClient().auth.resetPasswordForEmail(email, {
      // Through the callback, so the one-time code becomes a session server-side
      // before the person ever reaches the form that sets a new password.
      redirectTo: `${window.location.origin}/auth/callback?next=/${locale}/reset-password`,
    });

    // A failure here is a transport or rate-limit problem. An unknown address is
    // not an error and must not look like one.
    setState(error && error.status !== 400 ? 'failed' : 'sent');
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
