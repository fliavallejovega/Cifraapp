'use client';

import { Button, Problem, Status } from '@app/ui';
import { useActionState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { rescanNow } from '@/server/review-actions';

/**
 * Running the four analyses again, on demand.
 *
 * They already run after every confirmed import, so this is not the normal
 * path. It exists because a household that has just written a merchant rule, or
 * corrected twenty categories, has changed what the engines would conclude — and
 * waiting for the next statement to find out is not an answer.
 */
export function RescanButton({
  locale,
  labels,
}: {
  readonly locale: string;
  readonly labels: {
    readonly action: string;
    readonly queued: string;
    readonly errorTitle: string;
    readonly generic: string;
  };
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(rescanNow, {});

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-4">
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" variant="secondary" loading={pending}>
        {labels.action}
      </Button>
      {state.ok && <Status tone="positive">{labels.queued}</Status>}
      {state.error && <Problem title={labels.errorTitle} body={labels.generic} />}
    </form>
  );
}
