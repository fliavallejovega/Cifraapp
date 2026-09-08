'use client';

import { Button, Card, Field, Input, Problem, Select, Status } from '@app/ui';
import { useActionState } from 'react';

import { createHousehold, type CreateHouseholdResult } from '@/server/household-actions';

/**
 * A household, created for somebody.
 *
 * Three fields and two defaults. Currency and time zone are prefilled with
 * what every Panamanian household has so far chosen, so the usual case is
 * «type a name and an email». The button says what will happen.
 *
 * When an account had to be made, the password is shown once, here, and the
 * form is not cleared until the person has had a chance to copy it: clearing
 * it on success would erase the one thing the administrator came for.
 */

const ERRORS: Record<NonNullable<CreateHouseholdResult['error']>, string> = {
  forbidden: 'Your role cannot create households.',
  invalidName: 'The household needs a name between 2 and 80 characters.',
  invalidEmail: 'The owner needs a valid email address.',
  authFailed:
    'The sign-in for that address could not be created. If it already exists in Supabase without a profile, sign in once on the product first.',
  generic: 'The household was not created. Nothing was written.',
};

export function NewHouseholdForm({ productUrl }: { readonly productUrl: string }) {
  const [state, action, pending] = useActionState<CreateHouseholdResult, FormData>(
    createHousehold,
    {},
  );

  return (
    <Card padding="lg">
      <h2 className="text-lg font-medium">New household</h2>
      <p className="mt-2 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        For an existing customer, enter the email they sign in with. For an address that has no
        account, one is created and its temporary password is shown once, below.
      </p>

      {state.created && (
        <div className="mt-6 rounded-(--radius-sm) border border-[color:var(--color-rule-strong)] p-4">
          <Status tone="positive">Created</Status>
          <p className="mt-3 text-sm">
            <span className="font-medium">{state.created.name}</span>, owned by{' '}
            <span className="font-medium">{state.created.ownerEmail}</span>.
          </p>
          {state.created.temporaryPassword ? (
            <div className="mt-3">
              <p className="text-sm text-[color:var(--color-ink-secondary)]">
                Temporary password. It is not stored and will not be shown again.
              </p>
              <code className="mt-2 block rounded-(--radius-sm) bg-[color:var(--color-ground-sunk)] px-3 py-2 text-sm break-all select-all">
                {state.created.temporaryPassword}
              </code>
              <p className="mt-2 text-xs text-[color:var(--color-ink-tertiary)]">
                Sign in at {productUrl}/es/sign-in and change it from Settings.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-[color:var(--color-ink-tertiary)]">
              The owner already had an account; it now lists this household.
            </p>
          )}
        </div>
      )}

      {state.error && <Problem className="mt-6" title="Not created" body={ERRORS[state.error]} />}

      <form action={action} className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="Household name" required className="sm:col-span-2">
          {(props) => (
            <Input
              {...props}
              name="name"
              required
              minLength={2}
              maxLength={80}
              autoComplete="off"
            />
          )}
        </Field>

        <Field label="Owner email" required className="sm:col-span-2">
          {(props) => (
            <Input {...props} name="ownerEmail" type="email" required autoComplete="off" />
          )}
        </Field>

        <Field label="Currency">
          {(props) => (
            <Select {...props} name="currency" defaultValue="USD">
              <option value="USD">USD — US dollar</option>
              <option value="PAB">PAB — Balboa</option>
            </Select>
          )}
        </Field>

        <Field label="Time zone">
          {(props) => <Input {...props} name="timeZone" defaultValue="America/Panama" />}
        </Field>

        <div className="sm:col-span-2">
          <Button type="submit" loading={pending}>
            Create the household
          </Button>
        </div>
      </form>
    </Card>
  );
}
