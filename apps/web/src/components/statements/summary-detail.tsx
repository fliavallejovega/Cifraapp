'use client';

import { useId, useState, type ReactNode } from 'react';

/**
 * The lines behind a summary: closed until asked for, then two tabs — money in
 * and money out — each with its total on the tab itself, so the figure and the
 * lines that make it are never apart.
 */

export interface DetailLine {
  readonly key: string;
  readonly description: string;
  readonly date: string;
  /** «Pago a Visa Blei BG»: why a line is not spending. */
  readonly note: string | null;
  readonly amount: ReactNode;
}

type Tab = 'inflow' | 'outflow';

export function SummaryDetail({
  inflows,
  outflows,
  labels,
  totals,
}: {
  readonly inflows: readonly DetailLine[];
  readonly outflows: readonly DetailLine[];
  readonly labels: {
    readonly open: string;
    readonly close: string;
    readonly inflow: string;
    readonly outflow: string;
    readonly empty: string;
  };
  readonly totals: { readonly inflow: ReactNode; readonly outflow: ReactNode };
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(outflows.length >= inflows.length ? 'outflow' : 'inflow');
  const base = useId();
  const lines = tab === 'inflow' ? inflows : outflows;

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${base}-panel`}
        className="inline-flex min-h-11 items-center self-start text-sm font-medium underline underline-offset-4"
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {open ? labels.close : labels.open}
      </button>

      {open && (
        <div id={`${base}-panel`} className="flex flex-col gap-3">
          <div role="tablist" className="grid grid-cols-2 gap-2">
            {(['inflow', 'outflow'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`${base}-${key}`}
                aria-selected={tab === key}
                aria-controls={`${base}-list`}
                className={`flex min-h-11 flex-col items-start gap-1 rounded-(--radius-sm) border px-3 py-2 text-left text-sm ${
                  tab === key
                    ? 'border-[color:var(--color-ink)] bg-[color:var(--color-ground)] font-medium'
                    : 'border-[color:var(--color-rule)] text-[color:var(--color-ink-secondary)]'
                }`}
                onClick={() => {
                  setTab(key);
                }}
              >
                <span>{key === 'inflow' ? labels.inflow : labels.outflow}</span>
                <span>{key === 'inflow' ? totals.inflow : totals.outflow}</span>
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`${base}-list`} aria-labelledby={`${base}-${tab}`}>
            {lines.length === 0 ? (
              <p className="py-4 text-sm text-[color:var(--color-ink-secondary)]">{labels.empty}</p>
            ) : (
              <ul className="flex list-none flex-col p-0">
                {lines.map((line) => (
                  <li
                    key={line.key}
                    className="flex items-baseline justify-between gap-4 border-b border-[color:var(--color-rule)] py-2 text-sm last:border-b-0"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="[overflow-wrap:anywhere]">{line.description}</span>
                      <span className="text-xs text-[color:var(--color-ink-secondary)]">
                        {line.date}
                        {line.note ? ` · ${line.note}` : ''}
                      </span>
                    </div>
                    <span className="shrink-0">{line.amount}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
