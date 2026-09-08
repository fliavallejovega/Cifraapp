'use client';

import { Button, Field, Problem } from '@app/ui';
import { useActionState, useState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { reopenPeriod } from '@/server/close-actions';

/**
 * Unsealing a month, with the reason it took.
 *
 * The reason is required and stored. Somebody will eventually ask why the
 * figures they were given in March are not the figures in the system in June,
 * and «it was reopened on the 4th to correct a duplicated salary» is the only
 * acceptable answer.
 */
export function ReopenControl({
  locale,
  periodId,
  labels,
}: {
  readonly locale: string;
  readonly periodId: string;
  readonly labels: {
    readonly title: string;
    readonly detail: string;
    readonly reason: string;
    readonly action: string;
    readonly cancel: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    reopenPeriod,
    {},
  );

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        {labels.title}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={periodId} />

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      <p className="max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {labels.detail}
      </p>

      <Field label={labels.reason} required>
        {({ id }) => (
          <textarea
            id={id}
            name="reason"
            rows={2}
            required
            minLength={5}
            maxLength={500}
            className="w-full rounded-(--radius-sm) border border-[color:var(--color-rule-strong)] bg-[color:var(--color-surface)] px-3 py-2.5 text-sm text-[color:var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-[color:var(--color-brand)]"
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          {labels.action}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
          }}
        >
          {labels.cancel}
        </Button>
      </div>
    </form>
  );
}
