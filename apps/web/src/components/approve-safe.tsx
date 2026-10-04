'use client';

import { Button, Card } from '@app/ui';
import { useActionState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { approveSafe } from '@/server/review-actions';

/** One button for everything the app is sure of, before the queues one by one. */
export function ApproveSafe({
  locale,
  labels,
}: {
  readonly locale: string;
  readonly labels: Readonly<Record<'title' | 'body' | 'action' | 'done' | 'error', string>>;
}) {
  const [state, action, pending] = useActionState<RecordActionResult, FormData>(approveSafe, {});

  return (
    <Card className="mb-8">
      <form action={action} className="grid gap-3">
        <input type="hidden" name="locale" value={locale} />
        <h2 className="text-base font-medium">{labels.title}</h2>
        <p className="text-sm text-pretty text-[color:var(--color-ink-secondary)]">{labels.body}</p>
        {state.ok ? (
          <p role="status" className="text-sm">
            {labels.done}
          </p>
        ) : (
          <Button type="submit" size="lg" loading={pending} className="justify-self-start">
            {labels.action}
          </Button>
        )}
        {state.error && (
          <p role="alert" className="text-sm text-[color:var(--color-negative)]">
            {labels.error}
          </p>
        )}
      </form>
    </Card>
  );
}
