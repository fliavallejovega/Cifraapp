'use client';

import { Button, Problem } from '@app/ui';
import { useActionState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { acceptInvitation } from '@/server/household-actions';

/**
 * Accepting, with the account it will be accepted as stated plainly.
 *
 * People forward these links, and people have two email addresses. Showing
 * which account is about to join the household is the difference between a
 * confusing failure and an obvious one.
 */
export function AcceptInvitation({
  locale,
  token,
  email,
  labels,
}: {
  readonly locale: string;
  readonly token: string;
  readonly email: string;
  readonly labels: {
    readonly accept: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    acceptInvitation,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      <p className="readout text-sm text-[color:var(--color-ink-secondary)]">{email}</p>

      <Button type="submit" size="lg" loading={pending} className="self-start">
        {labels.accept}
      </Button>
    </form>
  );
}
