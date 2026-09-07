'use client';

import { Button, Problem, Status } from '@app/ui';
import { useActionState, useState } from 'react';

import { confirmImport, discardImport, type ConfirmActionResult } from '@/server/import-actions';

/**
 * Deciding what enters the ledger.
 *
 * The engine's verdict sets the starting position and nothing more: a row it
 * believes is new arrives selected, a row it believes it has seen before
 * arrives unselected with the signals that matched. Neither is final. The
 * product's promise is that no movement appears in a person's records without
 * someone agreeing to it, and this screen is where that promise is either kept
 * or broken.
 *
 * The button carries the count, so the last thing read before the click is the
 * number of movements about to exist.
 */

export interface ReviewRow {
  readonly id: string;
  readonly date: string;
  readonly description: string;
  readonly amount: string;
  readonly isNegative: boolean;
  readonly verdict: 'new' | 'duplicate' | 'review' | 'rejected';
  readonly signals: readonly string[];
  readonly rejectionReason: string | null;
  readonly alreadyFiled: boolean;
}

export interface ImportReviewLabels {
  readonly selectAll: string;
  readonly clearAll: string;
  readonly confirm: string;
  readonly confirmOne: string;
  readonly nothingSelected: string;
  readonly discard: string;
  readonly discardConfirm: string;
  readonly discardConfirmYes: string;
  readonly cancel: string;
  readonly filed: string;
  readonly alreadyFiled: string;
  readonly settled: string;
  readonly columnDate: string;
  readonly columnDescription: string;
  readonly columnAmount: string;
  readonly verdicts: Record<string, string>;
  readonly verdictHints: Record<string, string>;
  readonly signalLabel: string;
  readonly errorTitle: string;
  readonly errors: Record<string, string>;
}

export function ImportReview({
  locale,
  importId,
  rows,
  labels,
}: {
  readonly locale: string;
  readonly importId: string;
  readonly rows: readonly ReviewRow[];
  readonly labels: ImportReviewLabels;
}) {
  const [confirmState, confirmAction, confirming] = useActionState<ConfirmActionResult, FormData>(
    confirmImport,
    {},
  );
  const [, discardAction, discarding] = useActionState<ConfirmActionResult, FormData>(
    discardImport,
    {},
  );
  const [discardOpen, setDiscardOpen] = useState(false);

  const selectable = rows.filter((row) => row.verdict !== 'rejected' && !row.alreadyFiled);

  const [selected, setSelected] = useState<ReadonlySet<string>>(
    // The engine's opinion, as a starting point. Everything it is unsure about
    // starts off, because filing something twice is the expensive mistake.
    () => new Set(selectable.filter((row) => row.verdict === 'new').map((row) => row.id)),
  );

  if (selectable.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Status tone="positive">{labels.settled}</Status>
        <RowList rows={rows} labels={labels} selected={selected} onToggle={null} />
      </div>
    );
  }

  const count = selected.size;

  return (
    <div className="flex flex-col gap-6">
      {confirmState.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[confirmState.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      {confirmState.filed !== undefined && confirmState.filed > 0 && (
        <Status tone="positive">
          {labels.filed.replace('{count}', String(confirmState.filed))}
        </Status>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setSelected(new Set(selectable.map((row) => row.id)));
          }}
        >
          {labels.selectAll}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setSelected(new Set());
          }}
        >
          {labels.clearAll}
        </Button>
      </div>

      <form action={confirmAction} className="flex flex-col gap-6">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="importId" value={importId} />
        {[...selected].map((id) => (
          <input key={id} type="hidden" name="rows" value={id} />
        ))}

        <RowList
          rows={rows}
          labels={labels}
          selected={selected}
          onToggle={(id) => {
            const next = new Set(selected);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            setSelected(next);
          }}
        />

        {/* Sticky, because the decision is made at the bottom of a long list and
            scrolling back up to act is the friction nobody notices reporting. */}
        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-3 border-t border-[color:var(--color-rule)] bg-[color:var(--color-ground)] px-1 py-4">
          <Button type="submit" size="lg" loading={confirming} disabled={count === 0}>
            {count === 0
              ? labels.nothingSelected
              : count === 1
                ? labels.confirmOne
                : labels.confirm.replace('{count}', String(count))}
          </Button>

          {discardOpen ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[color:var(--color-ink-secondary)]">
                {labels.discardConfirm}
              </span>
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                loading={discarding}
                formAction={discardAction}
              >
                {labels.discardConfirmYes}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDiscardOpen(false);
                }}
              >
                {labels.cancel}
              </Button>
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDiscardOpen(true);
              }}
            >
              {labels.discard}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function RowList({
  rows,
  labels,
  selected,
  onToggle,
}: {
  readonly rows: readonly ReviewRow[];
  readonly labels: ImportReviewLabels;
  readonly selected: ReadonlySet<string>;
  readonly onToggle: ((id: string) => void) | null;
}) {
  return (
    <ul className="flex flex-col">
      {rows.map((row) => {
        const locked = row.verdict === 'rejected' || row.alreadyFiled || onToggle === null;
        const checked = row.alreadyFiled || selected.has(row.id);

        return (
          <li key={row.id} className="border-t border-[color:var(--color-rule)] last:border-b">
            <label
              className={[
                'flex items-start gap-3 py-4',
                locked ? 'cursor-default opacity-70' : 'cursor-pointer',
              ].join(' ')}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={locked}
                onChange={() => {
                  onToggle?.(row.id);
                }}
                className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--color-ink)]"
              />

              <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
                <span className="readout w-24 shrink-0 text-xs text-[color:var(--color-ink-secondary)]">
                  {row.date}
                </span>

                <span className="min-w-0 flex-1">
                  {/* A statement description can run to eighty characters of
                      bank shorthand; it wraps rather than truncating, because
                      the tail is often the only part that identifies it. */}
                  <span className="block break-words text-[color:var(--color-ink)]">
                    {row.description}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="gradation-label text-[color:var(--color-ink-tertiary)] uppercase">
                      {row.alreadyFiled
                        ? labels.alreadyFiled
                        : (labels.verdicts[row.verdict] ?? row.verdict)}
                    </span>
                    <span className="text-xs text-[color:var(--color-ink-secondary)]">
                      {row.rejectionReason ??
                        (row.signals.length > 0
                          ? `${labels.signalLabel} ${row.signals.join(', ')}`
                          : (labels.verdictHints[row.verdict] ?? ''))}
                    </span>
                  </span>
                </span>

                <span
                  className={[
                    'readout shrink-0 text-sm tabular-nums sm:w-32 sm:text-right',
                    row.isNegative
                      ? 'text-[color:var(--color-ink)]'
                      : 'text-[color:var(--color-positive)]',
                  ].join(' ')}
                >
                  {row.amount}
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
