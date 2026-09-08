'use client';

import { Button, Field, Input, Problem, Select } from '@app/ui';
import { useActionState, useState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { removeBudgetLine, saveBudgetLine } from '@/server/budget-actions';

/**
 * Editing the lines of a budget.
 *
 * Separate from the header form because they are separate decisions. The shape
 * of the month is chosen once; the grocery figure gets argued with every few
 * weeks, and burying it behind «edit budget» would make the common act the
 * expensive one.
 *
 * The table above this reads the lines. This is the part that changes them, and
 * it deliberately does not duplicate the figures — a second copy of «spent» that
 * updates on a different schedule is how two numbers on one screen start to
 * disagree.
 */

export interface BudgetLineDraft {
  readonly id: string;
  readonly categoryId: string;
  readonly planned: string;
  readonly categoryName: string;
}

export interface BudgetLinesProps {
  readonly locale: string;
  readonly budgetId: string;
  readonly currencySymbol: string;
  readonly lines: readonly BudgetLineDraft[];
  readonly categories: readonly { readonly value: string; readonly label: string }[];
  readonly labels: {
    readonly category: string;
    readonly planned: string;
    readonly add: string;
    readonly addTitle: string;
    readonly save: string;
    readonly remove: string;
    readonly removeConfirm: string;
    readonly cancel: string;
    readonly edit: string;
    readonly noCategory: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}

export function BudgetLines({
  locale,
  budgetId,
  currencySymbol,
  lines,
  categories,
  labels,
}: BudgetLinesProps) {
  const [adding, setAdding] = useState(lines.length === 0);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {lines.length > 0 && (
        <ul className="flex flex-col">
          {lines.map((line) => (
            <li key={line.id} className="border-b border-[color:var(--color-rule)] last:border-b-0">
              {editing === line.id ? (
                <div className="py-5">
                  <LineForm
                    locale={locale}
                    budgetId={budgetId}
                    currencySymbol={currencySymbol}
                    categories={categories}
                    labels={labels}
                    line={line}
                    onDone={() => {
                      setEditing(null);
                    }}
                  />
                </div>
              ) : (
                <LineRow
                  locale={locale}
                  budgetId={budgetId}
                  line={line}
                  labels={labels}
                  onEdit={() => {
                    setEditing(line.id);
                    setAdding(false);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <section aria-label={labels.addTitle} className="flex flex-col gap-4">
          {lines.length > 0 && (
            <h3 className="text-sm font-medium text-[color:var(--color-ink)]">{labels.addTitle}</h3>
          )}
          <LineForm
            locale={locale}
            budgetId={budgetId}
            currencySymbol={currencySymbol}
            categories={categories}
            labels={labels}
            {...(lines.length > 0
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
          variant="secondary"
          className="self-start"
          onClick={() => {
            setAdding(true);
            setEditing(null);
          }}
        >
          {labels.add}
        </Button>
      )}
    </div>
  );
}

function LineForm({
  locale,
  budgetId,
  currencySymbol,
  categories,
  labels,
  line,
  onDone,
}: {
  readonly locale: string;
  readonly budgetId: string;
  readonly currencySymbol: string;
  readonly categories: readonly { readonly value: string; readonly label: string }[];
  readonly labels: BudgetLinesProps['labels'];
  readonly line?: BudgetLineDraft;
  readonly onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    saveBudgetLine,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="budgetId" value={budgetId} />
      {line && <input type="hidden" name="id" value={line.id} />}

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-[1fr_12rem] sm:items-end">
        <Field label={labels.category}>
          {({ id }) => (
            <Select id={id} name="categoryId" defaultValue={line?.categoryId ?? ''}>
              <option value="">{labels.noCategory}</option>
              {categories.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={labels.planned} required>
          {({ id }) => (
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[color:var(--color-ink-tertiary)]"
              >
                {currencySymbol}
              </span>
              <Input
                id={id}
                name="plannedAmount"
                numeric
                inputMode="decimal"
                required
                placeholder="0.00"
                defaultValue={line?.planned ?? ''}
                className="pl-8"
              />
            </div>
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          {labels.save}
        </Button>
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            {labels.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}

function LineRow({
  locale,
  budgetId,
  line,
  labels,
  onEdit,
}: {
  readonly locale: string;
  readonly budgetId: string;
  readonly line: BudgetLineDraft;
  readonly labels: BudgetLinesProps['labels'];
  readonly onEdit: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    removeBudgetLine,
    {},
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[color:var(--color-ink)]">{line.categoryName}</p>
        {state.error && (
          <div className="mt-2 max-w-sm">
            <Problem
              title={labels.errorTitle}
              body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
            />
          </div>
        )}
      </div>

      {confirming ? (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="budgetId" value={budgetId} />
          <input type="hidden" name="id" value={line.id} />
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
  );
}
