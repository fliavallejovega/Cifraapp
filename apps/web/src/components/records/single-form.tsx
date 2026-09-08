'use client';

import { Button, Problem, Status } from '@app/ui';
import { useActionState } from 'react';

import { RecordFieldset } from './record-fieldset';
import type { FieldSpec, RecordAction, RecordActionResult, RecordValues } from './spec';

/**
 * One settings form, saved in place.
 *
 * The difference from a managed list is that there is nothing to create and
 * nothing to remove — the row always exists, and the only question is what it
 * says. So there is no «add», no confirmation, and the form keeps its values
 * after saving rather than collapsing: a person adjusting a buffer usually
 * wants to see the figure they just set, not an empty field.
 *
 * Success is stated, not implied. A form that saves silently and looks
 * identical afterwards leaves the person wondering whether it took, and on a
 * screen that changes what «available» means, wondering is not acceptable.
 */

export interface SingleFormProps {
  readonly locale: string;
  readonly fields: readonly FieldSpec[];
  readonly values: RecordValues;
  readonly currencySymbol: string;
  readonly action: RecordAction;
  readonly labels: {
    readonly submit: string;
    readonly saved: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
  readonly context?: Readonly<Record<string, string>>;
  /** Rendered between the fields and the button — a note, a warning, a link. */
  readonly children?: React.ReactNode;
}

export function SingleForm({
  locale,
  fields,
  values,
  currencySymbol,
  action,
  labels,
  context,
  children,
}: SingleFormProps) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      {Object.entries(context ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.name} className={field.half ? '' : 'sm:col-span-2'}>
            <RecordFieldset
              field={field}
              currencySymbol={currencySymbol}
              value={values[field.name] ?? ''}
            />
          </div>
        ))}
      </div>

      {children}

      <div className="mt-2 flex flex-wrap items-center gap-4">
        <Button type="submit" loading={pending} size="lg">
          {labels.submit}
        </Button>
        {state.ok && <Status tone="positive">{labels.saved}</Status>}
      </div>
    </form>
  );
}
