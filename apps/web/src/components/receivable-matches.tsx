'use client';

import { Button, Card, Problem, Status } from '@app/ui';
import { useActionState } from 'react';

import type { RecordAction, RecordActionResult } from './records/spec';

/**
 * Money that arrived, next to the expectation it probably settles.
 *
 * A household imports a statement and somewhere in it is the client payment
 * they have been waiting three weeks for, under a description like
 * «TRANSFERENCIA REF 88213». Nothing joined those two facts, so the receivable
 * stayed open for ever and the plan kept waiting for money already in the
 * account.
 *
 * Every row here is a proposal with its reasons in plain sight — «monto exacto
 * · dentro de la ventana · el concepto nombra a Acme» — because a household is
 * being asked to agree that an invoice is paid, and a bare confidence score is
 * not something anybody can check. Confirming is a person's act: a wrong match
 * writes off an invoice nobody paid and the household stops chasing money it is
 * still owed.
 */
export interface ReceivableMatchesProps {
  readonly locale: string;
  readonly confirm: RecordAction;
  readonly candidates: readonly {
    readonly receivableId: string;
    readonly receivableName: string;
    readonly transactionId: string;
    readonly date: string;
    readonly amount: string;
    readonly description: string;
    readonly accountName: string;
    readonly reasons: readonly string[];
  }[];
  readonly labels: {
    readonly title: string;
    readonly detail: string;
    readonly confirm: string;
    readonly emptyTitle: string;
    readonly emptyBody: string;
    readonly reasons: Readonly<Record<string, string>>;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}

export function ReceivableMatches({ locale, confirm, candidates, labels }: ReceivableMatchesProps) {
  // Nothing to reconcile is the ordinary state, and it is worth saying rather
  // than leaving a blank: «no encontramos nada que cuadre» and «todavía no has
  // importado un estado de cuenta» look identical as empty space.
  if (candidates.length === 0) {
    return (
      <Card>
        <p className="text-base font-medium text-[color:var(--color-ink)]">{labels.emptyTitle}</p>
        <p className="mt-2 max-w-[60ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {labels.emptyBody}
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-base font-medium text-[color:var(--color-ink)]">{labels.title}</p>
          <p className="max-w-[60ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {labels.detail}
          </p>
        </div>

        <ul className="flex flex-col">
          {candidates.map((candidate) => (
            <li
              key={candidate.transactionId}
              className="border-b border-[color:var(--color-rule)] py-5 last:border-b-0"
            >
              <MatchRow locale={locale} confirm={confirm} candidate={candidate} labels={labels} />
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function MatchRow({
  locale,
  confirm,
  candidate,
  labels,
}: {
  readonly locale: string;
  readonly confirm: RecordAction;
  readonly candidate: ReceivableMatchesProps['candidates'][number];
  readonly labels: ReceivableMatchesProps['labels'];
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(confirm, {});

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="font-medium break-words text-[color:var(--color-ink)]">
          {candidate.receivableName}
        </p>
        {/* The bank's own words, unedited. Tidying them up would remove the one
            thing the household can recognise. */}
        <p className="mt-1 text-sm break-words text-[color:var(--color-ink-secondary)]">
          {candidate.date} · {candidate.accountName} · {candidate.description}
        </p>
        <p className="mt-2 flex flex-wrap gap-1.5">
          {candidate.reasons.map((reason) => (
            <Status key={reason} tone="neutral">
              {labels.reasons[reason] ?? reason}
            </Status>
          ))}
        </p>
        {state.error && (
          <div className="mt-3 max-w-sm">
            <Problem
              title={labels.errorTitle}
              body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
            />
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-4 sm:justify-end">
        <span className="readout text-base text-[color:var(--color-ink)] tabular-nums">
          {candidate.amount}
        </span>
        <form action={formAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="receivableId" value={candidate.receivableId} />
          <input type="hidden" name="transactionId" value={candidate.transactionId} />
          <Button type="submit" size="sm" variant="secondary" loading={pending}>
            {labels.confirm}
          </Button>
        </form>
      </div>
    </div>
  );
}
