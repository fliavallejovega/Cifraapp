'use client';

import { Button, Card, EmptyState, Problem, Select, Status } from '@app/ui';
import { useActionState } from 'react';

import type { RecordAction, RecordActionResult, RecordBadge } from '@/components/records/spec';

/**
 * A queue of decisions a person has to make.
 *
 * All four review screens are the same interaction: here is what the engine
 * thinks, here is the evidence it thought it with, and here are the two or
 * three things you can do about it. Writing that four times would produce four
 * different answers to «what does the evidence look like», and the evidence is
 * the entire reason the screen is trustworthy.
 *
 * Two rules this encodes:
 *
 *   - The evidence is never optional. A row that asked «is this a duplicate?»
 *     without showing the confidence and the signals that fired would be asking
 *     a person to rubber-stamp something they cannot check.
 *   - Each row commits on its own. There is no «save all», because these are
 *     independent judgements and a bulk action over judgements is how a queue
 *     gets emptied without being read.
 */

export interface QueueChoice {
  readonly value: string;
  readonly label: string;
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
}

export interface QueueFact {
  readonly label: string;
  readonly value: string;
}

export interface QueueRow {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly amount?: string;
  readonly badges?: readonly RecordBadge[];
  /** The evidence: confidence, the signals that fired, the two sides of a pair. */
  readonly facts?: readonly QueueFact[];
  readonly evidence?: readonly string[];
  readonly choices: readonly QueueChoice[];
  /** A category picker, on the queue that needs one. */
  readonly select?: {
    readonly name: string;
    readonly value: string;
    readonly label: string;
    readonly options: readonly { readonly value: string; readonly label: string }[];
  };
  /** Extra hidden inputs this row submits — a toggle, a flag. */
  readonly extras?: Readonly<Record<string, string>>;
}

export interface ReviewQueueProps {
  readonly locale: string;
  readonly rows: readonly QueueRow[];
  readonly action: RecordAction;
  /** The form field the chosen button writes into. */
  readonly decisionName: string;
  readonly labels: {
    readonly emptyTitle: string;
    readonly emptyBody: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}

export function ReviewQueue({ locale, rows, action, decisionName, labels }: ReviewQueueProps) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState title={labels.emptyTitle} body={labels.emptyBody} />
      </Card>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {rows.map((row) => (
        <li key={row.id}>
          <QueueItem
            locale={locale}
            row={row}
            action={action}
            decisionName={decisionName}
            labels={labels}
          />
        </li>
      ))}
    </ul>
  );
}

function QueueItem({
  locale,
  row,
  action,
  decisionName,
  labels,
}: {
  readonly locale: string;
  readonly row: QueueRow;
  readonly action: RecordAction;
  readonly decisionName: string;
  readonly labels: ReviewQueueProps['labels'];
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(action, {});

  // A resolved row stays on screen, greyed, until the page is refetched. It
  // disappearing under the cursor would make the next row jump into the place
  // the person was about to click.
  const resolved = state.ok === true;

  return (
    <Card tone={resolved ? 'sunk' : 'surface'}>
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="id" value={row.id} />
        {Object.entries(row.extras ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}

        {state.error && (
          <Problem
            title={labels.errorTitle}
            body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
          />
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-medium break-words text-[color:var(--color-ink)]">
                {row.title}
              </span>
              {row.badges?.map((badge) => (
                <Status key={badge.label} tone={badge.tone}>
                  {badge.label}
                </Status>
              ))}
            </p>
            {row.subtitle && (
              <p className="mt-1 text-sm text-[color:var(--color-ink-secondary)]">{row.subtitle}</p>
            )}
          </div>
          {row.amount && (
            <span className="readout shrink-0 text-base text-[color:var(--color-ink)] tabular-nums">
              {row.amount}
            </span>
          )}
        </div>

        {row.facts && row.facts.length > 0 && (
          <dl className="grid gap-x-6 gap-y-2 border-t border-[color:var(--color-rule)] pt-4 text-sm sm:grid-cols-2">
            {row.facts.map((fact) => (
              <div key={fact.label} className="flex gap-2">
                <dt className="text-[color:var(--color-ink-tertiary)]">{fact.label}</dt>
                <dd className="text-[color:var(--color-ink)]">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {row.evidence && row.evidence.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {row.evidence.map((signal) => (
              <li
                key={signal}
                className="rounded-(--radius-sm) bg-[color:var(--color-ground-sunk)] px-2 py-1 font-(family-name:--font-mono) text-xs text-[color:var(--color-ink-secondary)]"
              >
                {signal}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-3">
          {row.select && (
            <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-sm">
              <span className="font-medium text-[color:var(--color-ink)]">{row.select.label}</span>
              <Select name={row.select.name} defaultValue={row.select.value}>
                {row.select.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>
          )}

          {row.choices.map((choice) => (
            <Button
              key={choice.value}
              type="submit"
              name={decisionName}
              value={choice.value}
              variant={choice.variant ?? 'secondary'}
              loading={pending}
              disabled={resolved}
            >
              {choice.label}
            </Button>
          ))}
        </div>
      </form>
    </Card>
  );
}
