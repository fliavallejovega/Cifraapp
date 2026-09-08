'use client';

import { Button, Card, Field, Input, Problem, Status } from '@app/ui';
import { useActionState, useState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { createAnotherHousehold, switchHousehold } from '@/server/household-actions';

/**
 * Choosing which household you are looking at, and starting another.
 *
 * Switching is a full navigation rather than a client-side swap, because every
 * screen behind it is server-rendered from the household's own rows. Swapping
 * the id and re-fetching piecemeal is how one screen ends up showing one
 * household's figures under another household's name.
 */
export function HouseholdSwitcher({
  locale,
  households,
  labels,
}: {
  readonly locale: string;
  readonly households: readonly {
    readonly id: string;
    readonly name: string;
    readonly roleLabel: string;
    readonly isCurrent: boolean;
  }[];
  readonly labels: {
    readonly current: string;
    readonly switch: string;
    readonly createTitle: string;
    readonly createDetail: string;
    readonly name: string;
    readonly createSubmit: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}) {
  const [switchState, switchAction, switchPending] = useActionState<RecordActionResult, FormData>(
    switchHousehold,
    {},
  );
  const [createState, createAction, createPending] = useActionState<RecordActionResult, FormData>(
    createAnotherHousehold,
    {},
  );
  const [creating, setCreating] = useState(false);

  const error = switchState.error ?? createState.error;

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      <ul className="grid gap-4 sm:grid-cols-2">
        {households.map((household) => (
          <li key={household.id}>
            <Card tone={household.isCurrent ? 'sunk' : 'surface'}>
              <div className="flex h-full flex-col gap-3">
                <span className="font-medium text-[color:var(--color-ink)]">{household.name}</span>
                <span className="text-sm text-[color:var(--color-ink-secondary)]">
                  {household.roleLabel}
                </span>
                <div className="mt-auto pt-2">
                  {household.isCurrent ? (
                    <Status tone="positive">{labels.current}</Status>
                  ) : (
                    <form action={switchAction}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="id" value={household.id} />
                      <Button type="submit" size="sm" variant="secondary" loading={switchPending}>
                        {labels.switch}
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-medium text-[color:var(--color-ink)]">
            {labels.createTitle}
          </h3>
          <p className="mt-1 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {labels.createDetail}
          </p>
        </div>

        {creating ? (
          <form action={createAction} className="flex flex-col gap-4">
            <input type="hidden" name="locale" value={locale} />
            <Field label={labels.name} required>
              {({ id }) => <Input id={id} name="name" required maxLength={120} />}
            </Field>
            <Button type="submit" loading={createPending} className="self-start">
              {labels.createSubmit}
            </Button>
          </form>
        ) : (
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              setCreating(true);
            }}
          >
            {labels.createTitle}
          </Button>
        )}
      </section>
    </div>
  );
}
