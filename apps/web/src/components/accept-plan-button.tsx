'use client';

import { Button, Problem, Status } from '@app/ui';
import { useActionState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { acceptPlan } from '@/server/plan-actions';

/**
 * Turning a suggestion into a decision.
 *
 * The plan is stored exactly as it stands when the button is pressed. That is
 * the whole value: a plan recomputed later from new balances is not the plan
 * anybody agreed to, and comparing against it would tell a household they
 * failed at something they never chose.
 */
export function AcceptPlanButton({
  locale,
  labels,
}: {
  readonly locale: string;
  readonly labels: {
    readonly action: string;
    readonly accepted: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(acceptPlan, {});

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-4">
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" size="lg" loading={pending}>
        {labels.action}
      </Button>
      {state.created && <Status tone="positive">{labels.accepted}</Status>}
      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}
    </form>
  );
}
