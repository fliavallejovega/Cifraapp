'use client';

import { Button, Card } from '@app/ui';
import { useActionState, type ReactNode } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { Link } from '@/i18n/navigation';
import { confirmUnderstood } from '@/server/review-actions';

/**
 * «Esto entendimos»: the income and fixed payments the movements show, with
 * one button that confirms them all and one link to go through them one by one.
 */
export function UnderstoodCard({
  locale,
  rows,
  labels,
}: {
  readonly locale: string;
  readonly rows: readonly {
    readonly id: string;
    readonly name: string;
    readonly detail: string;
    readonly amount: ReactNode;
  }[];
  readonly labels: Readonly<
    Record<'title' | 'body' | 'confirm' | 'review' | 'done' | 'error', string>
  >;
}) {
  const [state, action, pending] = useActionState<RecordActionResult, FormData>(
    confirmUnderstood,
    {},
  );

  if (state.ok) {
    return (
      <Card className="mt-6">
        <p className="text-sm" role="status">
          {labels.done}
        </p>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <form action={action} className="grid gap-4">
        <input type="hidden" name="locale" value={locale} />
        <div className="grid gap-1">
          <h2 className="text-base font-medium">{labels.title}</h2>
          <p className="text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {labels.body}
          </p>
        </div>
        <ul className="grid list-none gap-2 p-0">
          {rows.map((row) => (
            <li key={row.id} className="flex items-baseline justify-between gap-4">
              <input type="hidden" name="id" value={row.id} />
              <span className="min-w-0">
                <span className="block text-sm font-medium break-words">{row.name}</span>
                <span className="block text-xs text-[color:var(--color-ink-secondary)]">
                  {row.detail}
                </span>
              </span>
              <span className="shrink-0">{row.amount}</span>
            </li>
          ))}
        </ul>
        {state.error && (
          <p role="alert" className="text-sm text-[color:var(--color-negative)]">
            {labels.error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Button type="submit" size="lg" loading={pending}>
            {labels.confirm}
          </Button>
          <Link
            href="/review/recurring"
            className="inline-flex min-h-11 items-center text-sm font-medium underline decoration-[color:var(--color-brand)] underline-offset-4"
          >
            {labels.review}
          </Link>
        </div>
      </form>
    </Card>
  );
}
