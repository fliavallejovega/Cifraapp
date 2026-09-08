'use client';

import { Button, Card, Problem } from '@app/ui';
import { useActionState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { acknowledgeRisk } from '@/server/investment-actions';

/**
 * The gate in front of the modelling.
 *
 * It is a gate rather than a footnote on purpose. A column of monthly
 * contributions reads as a plan; whether it reads as a *promise* depends
 * entirely on whether the person understood that every figure in it rests on an
 * assumption about markets that nobody can make. That sentence has to arrive
 * before the numbers, once, deliberately.
 */
export function RiskDisclosure({
  locale,
  labels,
}: {
  readonly locale: string;
  readonly labels: {
    readonly title: string;
    readonly body: string;
    readonly accept: string;
    readonly errorTitle: string;
    readonly generic: string;
  };
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    acknowledgeRisk,
    {},
  );

  return (
    <Card padding="lg">
      <div className="flex flex-col gap-5">
        <h2 className="text-lg font-medium text-[color:var(--color-ink)]">{labels.title}</h2>

        <p className="max-w-[62ch] text-pretty text-[color:var(--color-ink-secondary)]">
          {labels.body}
        </p>

        {state.error && <Problem title={labels.errorTitle} body={labels.generic} />}

        <form action={formAction}>
          <input type="hidden" name="locale" value={locale} />
          <Button type="submit" size="lg" loading={pending}>
            {labels.accept}
          </Button>
        </form>
      </div>
    </Card>
  );
}
