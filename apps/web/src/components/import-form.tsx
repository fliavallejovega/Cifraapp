'use client';

import { Button, Field, Input, Problem, Select } from '@app/ui';
import { useActionState } from 'react';

import { Link } from '@/i18n/navigation';
import { importStatement, type ImportActionResult } from '@/server/import-actions';

/**
 * Statement upload.
 *
 * The upload no longer reports a summary, because it no longer parses: it
 * hands the file to a background job and hands the person a link to watch it.
 * That is a real change in what the screen can honestly say. «1,284 found · 27
 * new» was a claim worth making and it can only be made once the work is done —
 * so it now lives on the screen that reports on the work.
 *
 * The account is chosen here rather than guessed. Filing a statement against
 * the wrong account is worse than not filing it, and the household is the only
 * one who knows which card this PDF belongs to.
 */
export interface ImportFormProps {
  readonly locale: string;
  readonly accounts: readonly { readonly id: string; readonly name: string }[];
  readonly labels: {
    readonly file: string;
    readonly fileHint: string;
    readonly account: string;
    readonly accountHint: string;
    readonly submit: string;
    readonly errorTitle: string;
    readonly queuedHeading: string;
    readonly queuedDetail: string;
    readonly watchLink: string;
    readonly errors: Record<string, string>;
  };
}

export function ImportForm({ locale, accounts, labels }: ImportFormProps) {
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

      {state.jobId && (
        <div
          role="status"
          className="border-l border-[color:var(--color-positive)] bg-[color:var(--color-positive-sunk)] px-4 py-3"
        >
          <p className="text-sm font-medium">{labels.queuedHeading}</p>
          <p className="mt-1 text-xs text-[color:var(--color-ink-secondary)]">
            {labels.queuedDetail}
          </p>
          <p className="mt-2">
            <Link
              href={`/documents/processing/${state.jobId}`}
              className="text-sm underline underline-offset-4 hover:no-underline"
            >
              {labels.watchLink}
            </Link>
          </p>
        </div>
      )}

      {accounts.length > 1 && (
        <Field label={labels.account} hint={labels.accountHint}>
          {({ id, describedBy }) => (
            <Select id={id} name="accountId" aria-describedby={describedBy}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {accounts.length === 1 && (
        <input type="hidden" name="accountId" value={accounts[0]?.id ?? ''} />
      )}

      <Field label={labels.file} hint={labels.fileHint} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="file"
            type="file"
            accept=".csv,.ofx,.qfx,.pdf,.xlsx,text/csv,application/x-ofx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
