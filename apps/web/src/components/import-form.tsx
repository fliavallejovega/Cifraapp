'use client';

import { Button, Field, Input, Problem } from '@app/ui';
import { useActionState } from 'react';

import { importStatement, type ImportActionResult } from '@/server/import-actions';

/**
 * Statement upload.
 *
 * The result is a summary the user can check — found, new, duplicate, needing
 * review — rather than the word "done". A number a person can verify is worth
 * more than a reassurance they cannot (spec §105).
 */
export interface ImportFormProps {
  readonly locale: string;
  readonly labels: {
    readonly file: string;
    readonly fileHint: string;
    readonly submit: string;
    readonly errorTitle: string;
    readonly errors: Record<string, string>;
  };
}

export function ImportForm({ locale, labels }: ImportFormProps) {
  const [state, formAction, pending] = useActionState<ImportActionResult, FormData>(
    importStatement,
    {},
  );

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={state.detail ?? labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      {state.summary && (
        <div
          role="status"
          className="border-l border-[color:var(--color-positive)] bg-[color:var(--color-positive-sunk)] px-4 py-3"
        >
          <p className="tabular text-sm">
            {state.summary.found} · {state.summary.created} · {state.summary.duplicate} ·{' '}
            {state.summary.review}
          </p>
          <p className="mt-1 text-xs text-[color:var(--color-ink-secondary)]">
            {state.summaryLabel}
          </p>
        </div>
      )}

      <Field label={labels.file} hint={labels.fileHint} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="file"
            type="file"
            accept=".csv,.ofx,.qfx,text/csv,application/x-ofx"
            required
            aria-describedby={describedBy}
            className="file:mr-3 file:border-0 file:bg-transparent file:text-sm"
          />
        )}
      </Field>

      <Button type="submit" loading={pending} className="self-start">
        {labels.submit}
      </Button>
    </form>
  );
}
