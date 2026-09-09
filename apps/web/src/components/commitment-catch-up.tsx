'use client';

import { Button, Card, Problem } from '@app/ui';
import { useActionState, useState } from 'react';

import type { RecordAction, RecordActionResult } from './records/spec';

/**
 * «Estoy al día», and the one honest way to say it.
 *
 * A household that has just paid everything opened this product and read that
 * it owed $1,835.99. Nothing was wrong with the arithmetic: there was simply no
 * way to tell it that the bills had been paid, because a commitment could only
 * be settled by a transaction and no statement had been imported yet. This is
 * that way.
 *
 * Two states, and the empty one is the point rather than a fallback. With
 * nothing outstanding the card says so plainly — being up to date is the good
 * news this screen exists to be able to deliver, and a household that sees a
 * blank space instead has to guess whether the product knows.
 *
 * The figures sit inside the button because that is what is being asserted:
 * «Marcar 11 pagados · $1,835.99» is a claim somebody can check before they
 * make it, where «Confirmar» is a leap. And it confirms first, because this
 * writes to a financial record.
 */
export interface CommitmentCatchUpProps {
  readonly locale: string;
  readonly action: RecordAction;
  /**
   * How many claims fall inside the window this settles. Zero is the state the
   * card exists for; the money itself already reads inside the button's label,
   * where what is being asserted belongs.
   */
  readonly dueCount: number;
  readonly labels: {
    readonly title: string;
    readonly detail: string;
    readonly settleAction: string;
    readonly confirmQuestion: string;
    readonly confirmYes: string;
    readonly cancel: string;
    readonly clearTitle: string;
    readonly clearBody: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}

export function CommitmentCatchUp({ locale, action, dueCount, labels }: CommitmentCatchUpProps) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(action, {});

  // Nothing claimed in the window: the household is up to date, and saying so
  // is worth a card of its own.
  if (dueCount === 0) {
    return (
      <Card>
        <div className="flex flex-col gap-2">
          <p className="text-base font-medium text-[color:var(--color-positive)]">
            {labels.clearTitle}
          </p>
          <p className="max-w-[60ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {labels.clearBody}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-base font-medium text-[color:var(--color-ink)]">{labels.title}</p>
          <p className="max-w-[60ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {labels.detail}
          </p>
        </div>

        {state.error && (
          <div className="max-w-sm">
            <Problem
              title={labels.errorTitle}
              body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
            />
          </div>
        )}

        {confirming ? (
          <form action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="locale" value={locale} />
            <p className="text-sm text-[color:var(--color-ink-secondary)]">
              {labels.confirmQuestion}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" loading={pending}>
                {labels.confirmYes}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {labels.cancel}
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            className="self-start"
            onClick={() => {
              setConfirming(true);
            }}
          >
            {labels.settleAction}
          </Button>
        )}
      </div>
    </Card>
  );
}
