'use client';

import { Button, EmptyState, Problem, Status } from '@app/ui';
import { useActionState, useState } from 'react';

import { Link } from '@/i18n/navigation';
import { RecordForm } from './record-form';
import type { FieldSpec, RecordAction, RecordActionResult, RecordLabels, RecordRow } from './spec';

/**
 * A list of records a household owns, and everything it does to them.
 *
 * The rules this encodes, once, for every screen that uses it:
 *
 *   - With nothing yet, the form *is* the screen. Hiding the only useful action
 *     behind a button teaches nobody anything.
 *   - Editing happens in place. Navigating away to edit one figure loses the
 *     context that told you the figure was wrong.
 *   - Removing asks first, and says what will happen in the same breath. These
 *     rows are financial state; a row that disappears on a mis-tap is a figure
 *     the household will not trust again.
 *   - A failed action reports on the row that failed, not at the top of a list
 *     the person has already scrolled past.
 */

export interface RecordsManagerProps {
  readonly locale: string;
  readonly currencySymbol: string;
  readonly rows: readonly RecordRow[];
  readonly fields: readonly FieldSpec[];
  readonly labels: RecordLabels;
  readonly create: RecordAction;
  readonly update: RecordAction;
  readonly remove: RecordAction;
  readonly context?: Readonly<Record<string, string>>;
  /** Suppresses the add form when a limit or a precondition blocks it. */
  readonly blocked?: { readonly title: string; readonly body: string };
}

export function RecordsManager({
  locale,
  currencySymbol,
  rows,
  fields,
  labels,
  create,
  update,
  remove,
  context,
  blocked,
}: RecordsManagerProps) {
  const [adding, setAdding] = useState(rows.length === 0 && blocked === undefined);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-8">
      {rows.length === 0 ? (
        <EmptyState title={labels.emptyTitle} body={labels.emptyBody} />
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li key={row.id} className="border-b border-[color:var(--color-rule)] last:border-b-0">
              {editing === row.id ? (
                <div className="py-6">
                  <RecordForm
                    locale={locale}
                    fields={fields}
                    labels={labels}
                    currencySymbol={currencySymbol}
                    create={create}
                    update={update}
                    record={{ id: row.id, values: row.values }}
                    {...(context ? { context } : {})}
                    onDone={() => {
                      setEditing(null);
                    }}
                  />
                </div>
              ) : (
                <ManagedRow
                  locale={locale}
                  row={row}
                  labels={labels}
                  remove={remove}
                  {...(context ? { context } : {})}
                  onEdit={() => {
                    setEditing(row.id);
                    setAdding(false);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {blocked ? (
        <Problem title={blocked.title} body={blocked.body} />
      ) : adding ? (
        <section aria-label={labels.addTitle} className="flex flex-col gap-5">
          {rows.length > 0 && (
            <h3 className="text-sm font-medium text-[color:var(--color-ink)]">{labels.addTitle}</h3>
          )}
          <RecordForm
            locale={locale}
            fields={fields}
            labels={labels}
            currencySymbol={currencySymbol}
            create={create}
            update={update}
            {...(context ? { context } : {})}
            {...(rows.length > 0
              ? {
                  onDone: () => {
                    setAdding(false);
                  },
                }
              : {})}
          />
        </section>
      ) : (
        <Button
          size="lg"
          className="self-start"
          onClick={() => {
            setAdding(true);
            setEditing(null);
          }}
        >
          {labels.addAction}
        </Button>
      )}
    </div>
  );
}

function ManagedRow({
  locale,
  row,
  labels,
  remove,
  context,
  onEdit,
}: {
  readonly locale: string;
  readonly row: RecordRow;
  readonly labels: RecordLabels;
  readonly remove: RecordAction;
  readonly context?: Readonly<Record<string, string>>;
  readonly onEdit: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(remove, {});

  return (
    <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className={[
              'font-medium break-words',
              row.muted
                ? 'text-[color:var(--color-ink-secondary)]'
                : 'text-[color:var(--color-ink)]',
            ].join(' ')}
          >
            {row.href ? (
              <Link
                href={row.href}
                className="underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-brand)]"
              >
                {row.title}
              </Link>
            ) : (
              row.title
            )}
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
        {row.amount && (
          <span className="text-right">
            <span className="readout block text-base text-[color:var(--color-ink)] tabular-nums">
              {row.amount}
            </span>
            {row.amountDetail && (
              <span className="block text-xs text-[color:var(--color-ink-tertiary)]">
                {row.amountDetail}
              </span>
            )}
          </span>
        )}

        {confirming ? (
          <form action={formAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={row.id} />
            {Object.entries(context ?? {}).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <span className="text-xs text-[color:var(--color-ink-secondary)]">
              {labels.removeConfirm}
            </span>
            <Button type="submit" size="sm" variant="secondary" loading={pending}>
              {labels.removeConfirmYes}
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
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onEdit}>
              {labels.edit}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setConfirming(true);
              }}
            >
              {labels.remove}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
