'use client';

import { Button, Field, Input, Problem, Select, Status } from '@app/ui';
import { useActionState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { grantAccountant } from '@/server/access-actions';

/**
 * Handing an accountant a key.
 *
 * Scope and expiry sit on one form because they are one decision: «read only,
 * ninety days» is a sentence a person can hold in their head, and three
 * separate settings is a policy they will get wrong.
 */
export function GrantForm({
  locale,
  scopes,
  labels,
}: {
  readonly locale: string;
  readonly scopes: readonly { readonly value: string; readonly label: string }[];
  readonly labels: {
    readonly email: string;
    readonly scope: string;
    readonly expires: string;
    readonly expiresHint: string;
    readonly submit: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    grantAccountant,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label={labels.email} required>
          {({ id }) => <Input id={id} name="email" type="email" required autoComplete="email" />}
        </Field>

        <Field label={labels.scope}>
          {({ id }) => (
            <Select id={id} name="scope" defaultValue="read">
              {scopes.map((scope) => (
                <option key={scope.value} value={scope.value}>
                  {scope.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={labels.expires} hint={labels.expiresHint}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              name="expiresInDays"
              numeric
              inputMode="numeric"
              defaultValue="90"
              aria-describedby={describedBy}
              className="max-w-28 text-left"
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" loading={pending}>
          {labels.submit}
        </Button>
        {state.ok && <Status tone="positive">{labels.submit}</Status>}
      </div>
    </form>
  );
}
