'use client';

import { Button, Problem } from '@app/ui';
import { useActionState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { buildSuggestedBudget } from '@/server/budget-actions';

/**
 * Building a budget from what the household actually spends.
 *
 * There is no confirmation step because there is nothing to lose: the action
 * only ever *adds* lines for categories that have none, and never overwrites a
 * figure a person chose. A household that dislikes the result edits it, which
 * is the point — the proposal is there to be argued with.
 */
export function SuggestBudgetButton({
  locale,
  labels,
}: {
  readonly locale: string;
  readonly labels: {
    readonly action: string;
    readonly errorTitle: string;
    readonly generic: string;
  };
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    buildSuggestedBudget,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      {state.error && <Problem title={labels.errorTitle} body={labels.generic} />}
      <Button type="submit" size="lg" loading={pending} className="self-start">
        {labels.action}
      </Button>
    </form>
  );
}
