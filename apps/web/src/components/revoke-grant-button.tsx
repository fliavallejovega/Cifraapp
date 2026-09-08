'use client';

import { Button, Problem } from '@app/ui';
import { useActionState, useState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { revokeAccountant } from '@/server/access-actions';

/** Taking the key back. Immediate, and never a delete: the grant is history. */
export function RevokeGrantButton({
  locale,
  grantId,
  labels,
}: {
  readonly locale: string;
  readonly grantId: string;
  readonly labels: {
    readonly revoke: string;
    readonly revokeConfirm: string;
    readonly cancel: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    revokeAccountant,
    {},
  );

  if (state.error) {
    return (
      <div className="max-w-sm">
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      </div>
    );
  }

  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setConfirming(true);
        }}
      >
        {labels.revoke}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={grantId} />
      <span className="text-xs text-[color:var(--color-ink-secondary)]">
        {labels.revokeConfirm}
      </span>
      <Button type="submit" size="sm" variant="destructive" loading={pending}>
        {labels.revoke}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setConfirming(false);
        }}
      >
        {labels.cancel}
      </Button>
    </form>
  );
}
