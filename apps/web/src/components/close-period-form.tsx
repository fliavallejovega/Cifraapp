'use client';

import { Button, Problem, Status } from '@app/ui';
import { useActionState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { closePeriod } from '@/server/close-actions';

/**
 * The close button, and the sentence next to it.
 *
 * The consequence is stated before the click, not after: correcting anything in
 * a closed month means reopening it and giving a reason that will be kept. That
 * is the whole weight of the action, and hiding it behind a confirmation dialog
 * would be hiding it.
 */
export function ClosePeriodForm({
  locale,
  month,
  mayClose,
  alreadyClosed,
  labels,
}: {
  readonly locale: string;
  readonly month: string;
  readonly mayClose: boolean;
  readonly alreadyClosed: boolean;
  readonly labels: {
    readonly close: string;
    readonly closed: string;
    readonly blocked: string;
    readonly confirm: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    closePeriod,
    {},
  );

  if (alreadyClosed || state.ok) {
    return <Status tone="positive">{labels.closed}</Status>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="month" value={month} />

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      <p className="max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {labels.confirm}
      </p>

      {mayClose ? (
        <Button type="submit" size="lg" loading={pending} className="self-start">
          {labels.close}
        </Button>
      ) : (
        <Status tone="caution">{labels.blocked}</Status>
      )}
    </form>
  );
}
