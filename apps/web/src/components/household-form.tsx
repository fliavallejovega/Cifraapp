'use client';

import { Button, Field, Input, Problem, Select } from '@app/ui';
import { useActionState } from 'react';

import { createFirstHousehold, type ActionResult } from '@/server/auth-actions';

export interface HouseholdFormProps {
  readonly locale: string;
  readonly labels: {
    readonly name: string;
    readonly nameHint: string;
    readonly currency: string;
    readonly submit: string;
    readonly errorTitle: string;
    readonly errors: Record<string, string>;
  };
}

export function HouseholdForm({ locale, labels }: HouseholdFormProps) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    createFirstHousehold,
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

      <Field label={labels.name} hint={labels.nameHint} required>
        {({ id, describedBy }) => (
          <Input id={id} name="name" required maxLength={120} aria-describedby={describedBy} />
        )}
      </Field>

      <Field label={labels.currency}>
        {({ id }) => (
          <Select id={id} name="currency" defaultValue="USD">
            {/* Both circulate in Panama at par, and reporting has to be able to
                tell them apart. */}
            <option value="USD">USD — $</option>
            <option value="PAB">PAB — B/.</option>
          </Select>
        )}
      </Field>

      <Button type="submit" loading={pending} size="lg" className="mt-2 w-full">
        {labels.submit}
      </Button>
    </form>
  );
}
