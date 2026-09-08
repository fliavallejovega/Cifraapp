'use client';

import { Button, Card, Problem, Status } from '@app/ui';
import { useActionState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { startCheckout } from '@/server/billing-actions';

/**
 * The plan catalogue, with the one honest control on it.
 *
 * When no payment processor is configured the buttons are absent rather than
 * disabled: a greyed-out button invites a click and then explains itself, and
 * the explanation is already stated above the list.
 */
export function PlanChooser({
  locale,
  plans,
  checkoutAvailable,
  labels,
}: {
  readonly locale: string;
  readonly checkoutAvailable: boolean;
  readonly plans: readonly {
    readonly code: string;
    readonly name: string;
    readonly price: string;
    readonly interval: string;
    readonly isCurrent: boolean;
  }[];
  readonly labels: {
    readonly current: string;
    readonly choose: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    startCheckout,
    {},
  );

  return (
    <div className="flex flex-col gap-4">
      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <li key={plan.code}>
            <Card tone={plan.isCurrent ? 'sunk' : 'surface'}>
              <div className="flex h-full flex-col gap-3">
                <span className="font-medium text-[color:var(--color-ink)]">{plan.name}</span>
                <span className="readout text-2xl text-[color:var(--color-ink)]">{plan.price}</span>
                <span className="text-sm text-[color:var(--color-ink-secondary)]">
                  {plan.interval}
                </span>

                <div className="mt-auto pt-3">
                  {plan.isCurrent ? (
                    <Status tone="positive">{labels.current}</Status>
                  ) : (
                    checkoutAvailable && (
                      <form action={formAction}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="planCode" value={plan.code} />
                        <Button type="submit" size="sm" variant="secondary" loading={pending}>
                          {labels.choose}
                        </Button>
                      </form>
                    )
                  )}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
