'use client';

import { Button, Field, Input, Problem } from '@app/ui';
import { useActionState } from 'react';

import { Link } from '@/i18n/navigation';
import { importStatement, type ImportActionResult } from '@/server/import-actions';

/**
 * Statement upload.
 *
 * The result is a summary the user can check — found, new, duplicate, needing
 * review — rather than the word "done". A number a person can verify is worth
 * more than a reassurance they cannot (spec §105).
 *
 * The summary now ends where it always should have: a link to the rows. Parsing
 * a file and reporting four new movements, with no way to reach them, was a
 * promise the screen could not keep.
 */
export interface ImportFormProps {
  readonly locale: string;
  readonly labels: {
    readonly file: string;
    readonly fileHint: string;
    readonly submit: string;
    readonly errorTitle: string;
    readonly summaryHeading: string;
    readonly summaryDetail: string;
    readonly reviewLink: string;
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
          <p className="text-sm font-medium">{labels.summaryHeading}</p>
          <p className="tabular mt-1 text-xs text-[color:var(--color-ink-secondary)]">
            {fill(labels.summaryDetail, state.summary)}
          </p>
          {state.importId && (
            <p className="mt-2">
              <Link
                href={`/documents/${state.importId}`}
                className="text-sm underline underline-offset-4 hover:no-underline"
              >
                {labels.reviewLink}
              </Link>
            </p>
          )}
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

function fill(
  template: string,
  summary: { found: number; created: number; duplicate: number; review: number },
): string {
  return template
    .replace('{found}', String(summary.found))
    .replace('{new}', String(summary.created))
    .replace('{duplicate}', String(summary.duplicate))
    .replace('{review}', String(summary.review));
}
