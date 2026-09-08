'use client';

import { Button, Card, EmptyState, Field, Input, Problem, Select } from '@app/ui';
import { useActionState, useState } from 'react';

import { MarketChart } from '@/components/market-chart';
import type { RecordActionResult } from '@/components/records/spec';
import { addToWatchlist, removeFromWatchlist } from '@/server/investment-actions';

/**
 * What the household asked to look at.
 *
 * The distinction this component has to carry is the whole module's: a symbol
 * being here means somebody typed it, not that the product proposed it. The
 * copy says so, and there is deliberately no «suggested for you» anywhere near
 * it — a list the product populated would be a recommendation whatever the
 * heading said.
 *
 * Charts render only for rows that exist. Loading a third-party frame for a
 * symbol nobody asked about would be spending someone's bandwidth on a guess.
 */

export interface WatchlistRow {
  readonly id: string;
  readonly symbol: string;
  readonly label: string;
  readonly note: string | null;
  readonly goalId: string | null;
  readonly goalName: string | null;
}

export interface WatchlistLabels {
  readonly symbol: string;
  readonly symbolHint: string;
  readonly label: string;
  readonly note: string;
  readonly goal: string;
  readonly noGoal: string;
  readonly add: string;
  readonly remove: string;
  readonly removeConfirm: string;
  readonly cancel: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly chartLabel: string;
  readonly chartNote: string;
  readonly errorTitle: string;
  readonly errors: Readonly<Record<string, string>>;
}

export function Watchlist({
  locale,
  rows,
  goals,
  labels,
}: {
  readonly locale: string;
  readonly rows: readonly WatchlistRow[];
  readonly goals: readonly { readonly id: string; readonly name: string }[];
  readonly labels: WatchlistLabels;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    addToWatchlist,
    {},
  );

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <form action={formAction} className="flex flex-col gap-5">
          <input type="hidden" name="locale" value={locale} />

          {state.error && (
            <Problem
              title={labels.errorTitle}
              body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
            />
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={labels.symbol} hint={labels.symbolHint} required>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  name="symbol"
                  required
                  maxLength={40}
                  placeholder="AMEX:SPY"
                  aria-describedby={describedBy}
                  className="readout uppercase"
                />
              )}
            </Field>

            <Field label={labels.label} required>
              {({ id }) => <Input id={id} name="label" required maxLength={80} />}
            </Field>

            <Field label={labels.goal}>
              {({ id }) => (
                <Select id={id} name="goalId" defaultValue="">
                  <option value="">{labels.noGoal}</option>
                  {goals.map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {goal.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label={labels.note}>
              {({ id }) => <Input id={id} name="note" maxLength={200} />}
            </Field>
          </div>

          <Button type="submit" loading={pending} className="self-start">
            {labels.add}
          </Button>
        </form>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={labels.emptyTitle} body={labels.emptyBody} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-6">
          {rows.map((row) => (
            <li key={row.id}>
              <WatchedRow locale={locale} row={row} labels={labels} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WatchedRow({
  locale,
  row,
  labels,
}: {
  readonly locale: string;
  readonly row: WatchlistRow;
  readonly labels: WatchlistLabels;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    removeFromWatchlist,
    {},
  );

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-[color:var(--color-ink)]">{row.label}</span>
              <span className="readout text-xs text-[color:var(--color-ink-tertiary)]">
                {row.symbol}
              </span>
            </p>
            {(row.note ?? row.goalName) && (
              <p className="mt-1 text-sm text-[color:var(--color-ink-secondary)]">
                {[row.goalName, row.note].filter((part) => part).join(' · ')}
              </p>
            )}
          </div>

          {confirming ? (
            <form action={formAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="id" value={row.id} />
              <span className="text-xs text-[color:var(--color-ink-secondary)]">
                {labels.removeConfirm}
              </span>
              <Button type="submit" size="sm" variant="secondary" loading={pending}>
                {labels.remove}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {labels.cancel}
              </Button>
            </form>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setConfirming(true);
              }}
            >
              {labels.remove}
            </Button>
          )}
        </div>

        {state.error && (
          <Problem
            title={labels.errorTitle}
            body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
          />
        )}

        <MarketChart
          symbol={row.symbol}
          locale={locale}
          label={labels.chartLabel.replace('{label}', row.label)}
        />

        <p className="text-xs text-[color:var(--color-ink-tertiary)]">{labels.chartNote}</p>
      </div>
    </Card>
  );
}
