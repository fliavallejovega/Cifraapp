'use client';

import { Button, Card, Field, Problem, Section, Select, Status } from '@app/ui';
import { useActionState, useState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import {
  removeMovement,
  setMovementCategory,
  setMovementNote,
  setMovementSplits,
  setMovementStatus,
} from '@/server/movement-actions';

/**
 * Everything a person does to one movement.
 *
 * Four independent forms rather than one, on purpose. Correcting a category and
 * writing a note are unrelated decisions, and a single «save» over both means a
 * person who fixed the category and then thought better of the note has to undo
 * a thing they never intended to change. Each control commits its own fact.
 *
 * The split editor is the one that carries a rule the interface has to enforce
 * before the database refuses: the parts sum to the whole. The running
 * remainder is shown as it is typed, and the save button will not submit while
 * it is not zero — because a `check_violation` coming back from Postgres is
 * technically the same protection and a useless thing to read.
 */

export interface MovementOption {
  readonly value: string;
  readonly label: string;
}

export interface MovementEditorLabels {
  readonly category: {
    readonly title: string;
    readonly detail: string;
    readonly field: string;
    readonly none: string;
    readonly save: string;
    readonly saved: string;
  };
  readonly splits: {
    readonly title: string;
    readonly detail: string;
    readonly amount: string;
    readonly category: string;
    readonly person: string;
    readonly anyone: string;
    readonly note: string;
    readonly add: string;
    readonly removeLine: string;
    readonly save: string;
    readonly clear: string;
    readonly remaining: string;
    readonly over: string;
    readonly balanced: string;
    readonly empty: string;
    readonly start: string;
  };
  readonly note: {
    readonly title: string;
    readonly detail: string;
    readonly field: string;
    readonly save: string;
  };
  readonly status: {
    readonly title: string;
    readonly detail: string;
    readonly exclude: string;
    readonly include: string;
    readonly markTransfer: string;
    readonly excluded: string;
  };
  readonly remove: {
    readonly title: string;
    readonly detail: string;
    readonly action: string;
    readonly confirm: string;
    readonly confirmYes: string;
  };
  readonly cancel: string;
  readonly errorTitle: string;
  readonly errors: Readonly<Record<string, string>>;
  readonly noCategory: string;
}

export interface MovementEditorProps {
  readonly locale: string;
  readonly movementId: string;
  readonly currencySymbol: string;
  /** The movement's own amount, as a decimal string. Splits must equal it. */
  readonly amount: string;
  readonly categoryId: string | null;
  readonly notes: string | null;
  readonly status: string;
  readonly canRemove: boolean;
  readonly categories: readonly MovementOption[];
  readonly people: readonly MovementOption[];
  readonly splits: readonly {
    readonly amount: string;
    readonly categoryId: string | null;
    readonly personId: string | null;
    readonly note: string | null;
  }[];
  readonly labels: MovementEditorLabels;
}

interface SplitDraft {
  readonly key: string;
  amount: string;
  categoryId: string;
  personId: string;
  note: string;
}

export function MovementEditor(props: MovementEditorProps) {
  return (
    <div className="flex flex-col gap-12">
      <CategorySection {...props} />
      <SplitSection {...props} />
      <NoteSection {...props} />
      <StatusSection {...props} />
      {props.canRemove && <RemoveSection {...props} />}
    </div>
  );
}

function CategorySection({
  locale,
  movementId,
  categoryId,
  categories,
  labels,
}: MovementEditorProps) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    setMovementCategory,
    {},
  );

  return (
    <Section title={labels.category.title} detail={labels.category.detail}>
      <Card>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={movementId} />

          {state.error && (
            <Problem
              title={labels.errorTitle}
              body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
            />
          )}

          <Field label={labels.category.field}>
            {({ id }) => (
              <Select id={id} name="categoryId" defaultValue={categoryId ?? ''}>
                <option value="">{labels.category.none}</option>
                {categories.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" loading={pending}>
              {labels.category.save}
            </Button>
            {state.ok && <Status tone="positive">{labels.category.saved}</Status>}
          </div>
        </form>
      </Card>
    </Section>
  );
}

function SplitSection({
  locale,
  movementId,
  amount,
  currencySymbol,
  categories,
  people,
  splits,
  labels,
}: MovementEditorProps) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    setMovementSplits,
    {},
  );

  const [lines, setLines] = useState<SplitDraft[]>(() =>
    splits.map((split, index) => ({
      key: `existing-${String(index)}`,
      amount: split.amount,
      categoryId: split.categoryId ?? '',
      personId: split.personId ?? '',
      note: split.note ?? '',
    })),
  );

  const total = lines.reduce((sum, line) => sum + centsOf(line.amount), 0);
  const whole = centsOf(amount);
  const difference = whole - total;
  const balanced = lines.length > 0 && difference === 0;

  const update = (key: string, patch: Partial<SplitDraft>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  return (
    <Section title={labels.splits.title} detail={labels.splits.detail}>
      <Card>
        {lines.length === 0 ? (
          <div className="flex flex-col items-start gap-4">
            <p className="text-sm text-[color:var(--color-ink-secondary)]">{labels.splits.empty}</p>
            <Button
              variant="secondary"
              onClick={() => {
                // Opening the editor pre-fills the first line with the whole
                // amount: the second line is then a subtraction, which is the
                // arithmetic people actually do out loud.
                setLines([
                  { key: newKey(), amount, categoryId: '', personId: '', note: '' },
                  { key: newKey(), amount: '', categoryId: '', personId: '', note: '' },
                ]);
              }}
            >
              {labels.splits.start}
            </Button>
          </div>
        ) : (
          <form action={formAction} className="flex flex-col gap-5">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={movementId} />
            <input
              type="hidden"
              name="splits"
              value={JSON.stringify(
                lines.map((line) => ({
                  amount: line.amount,
                  categoryId: line.categoryId,
                  personId: line.personId,
                  note: line.note,
                })),
              )}
            />

            {state.error && (
              <Problem
                title={labels.errorTitle}
                body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
              />
            )}

            <ul className="flex flex-col gap-5">
              {lines.map((line) => (
                <li
                  key={line.key}
                  className="grid gap-3 border-b border-[color:var(--color-rule)] pb-5 last:border-b-0 last:pb-0 sm:grid-cols-[9rem_1fr_1fr_auto] sm:items-end"
                >
                  <Field label={labels.splits.amount}>
                    {({ id }) => (
                      <div className="relative">
                        <span
                          aria-hidden
                          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[color:var(--color-ink-tertiary)]"
                        >
                          {currencySymbol}
                        </span>
                        <input
                          id={id}
                          inputMode="decimal"
                          value={line.amount}
                          onChange={(event) => {
                            update(line.key, { amount: event.target.value });
                          }}
                          placeholder="0.00"
                          className="readout h-11 w-full rounded-(--radius-sm) border border-[color:var(--color-rule-strong)] bg-[color:var(--color-surface)] pr-3 pl-8 text-right text-sm text-[color:var(--color-ink)] tabular-nums focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-[color:var(--color-brand)]"
                        />
                      </div>
                    )}
                  </Field>

                  <Field label={labels.splits.category}>
                    {({ id }) => (
                      <Select
                        id={id}
                        value={line.categoryId}
                        onChange={(event) => {
                          update(line.key, { categoryId: event.target.value });
                        }}
                      >
                        <option value="">{labels.noCategory}</option>
                        {categories.map((category) => (
                          <option key={category.value} value={category.value}>
                            {category.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field label={labels.splits.person}>
                    {({ id }) => (
                      <Select
                        id={id}
                        value={line.personId}
                        onChange={(event) => {
                          update(line.key, { personId: event.target.value });
                        }}
                      >
                        <option value="">{labels.splits.anyone}</option>
                        {people.map((person) => (
                          <option key={person.value} value={person.value}>
                            {person.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setLines((current) => current.filter((entry) => entry.key !== line.key));
                    }}
                  >
                    {labels.splits.removeLine}
                  </Button>
                </li>
              ))}
            </ul>

            <p className="text-sm">
              {balanced ? (
                <Status tone="positive">{labels.splits.balanced}</Status>
              ) : difference > 0 ? (
                <Status tone="caution">
                  {labels.splits.remaining.replace(
                    '{amount}',
                    formatCents(difference, currencySymbol),
                  )}
                </Status>
              ) : (
                <Status tone="negative">
                  {labels.splits.over.replace('{amount}', formatCents(-difference, currencySymbol))}
                </Status>
              )}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setLines((current) => [
                    ...current,
                    { key: newKey(), amount: '', categoryId: '', personId: '', note: '' },
                  ]);
                }}
              >
                {labels.splits.add}
              </Button>
              <Button type="submit" loading={pending} disabled={!balanced}>
                {labels.splits.save}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setLines([]);
                }}
              >
                {labels.cancel}
              </Button>
            </div>
          </form>
        )}

        {splits.length > 0 && lines.length === 0 && (
          <form action={formAction} className="mt-4">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={movementId} />
            <input type="hidden" name="splits" value="[]" />
            <Button type="submit" variant="ghost" size="sm">
              {labels.splits.clear}
            </Button>
          </form>
        )}
      </Card>
    </Section>
  );
}

function NoteSection({ locale, movementId, notes, labels }: MovementEditorProps) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    setMovementNote,
    {},
  );

  return (
    <Section title={labels.note.title} detail={labels.note.detail}>
      <Card>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={movementId} />

          {state.error && (
            <Problem
              title={labels.errorTitle}
              body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
            />
          )}

          <Field label={labels.note.field}>
            {({ id }) => (
              <textarea
                id={id}
                name="notes"
                rows={3}
                maxLength={1000}
                defaultValue={notes ?? ''}
                className="w-full rounded-(--radius-sm) border border-[color:var(--color-rule-strong)] bg-[color:var(--color-surface)] px-3 py-2.5 text-sm text-[color:var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-[color:var(--color-brand)]"
              />
            )}
          </Field>

          <Button type="submit" loading={pending} className="self-start">
            {labels.note.save}
          </Button>
        </form>
      </Card>
    </Section>
  );
}

function StatusSection({ locale, movementId, status, labels }: MovementEditorProps) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    setMovementStatus,
    {},
  );

  const excluded = status === 'excluded';

  return (
    <Section title={labels.status.title} detail={labels.status.detail}>
      <Card>
        <div className="flex flex-col gap-4">
          {state.error && (
            <Problem
              title={labels.errorTitle}
              body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
            />
          )}

          {excluded && <Status tone="caution">{labels.status.excluded}</Status>}

          <div className="flex flex-wrap gap-3">
            <form action={formAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="id" value={movementId} />
              <input type="hidden" name="status" value={excluded ? 'posted' : 'excluded'} />
              <Button type="submit" variant="secondary" loading={pending}>
                {excluded ? labels.status.include : labels.status.exclude}
              </Button>
            </form>

            {status !== 'transfer' && (
              <form action={formAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="id" value={movementId} />
                <input type="hidden" name="status" value="transfer" />
                <Button type="submit" variant="ghost" loading={pending}>
                  {labels.status.markTransfer}
                </Button>
              </form>
            )}
          </div>
        </div>
      </Card>
    </Section>
  );
}

function RemoveSection({ locale, movementId, labels }: MovementEditorProps) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    removeMovement,
    {},
  );

  return (
    <Section title={labels.remove.title} detail={labels.remove.detail}>
      <Card>
        <div className="flex flex-col gap-4">
          {state.error && (
            <Problem
              title={labels.errorTitle}
              body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
            />
          )}

          {confirming ? (
            <form action={formAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="id" value={movementId} />
              <span className="text-sm text-[color:var(--color-ink-secondary)]">
                {labels.remove.confirm}
              </span>
              <Button type="submit" variant="destructive" loading={pending}>
                {labels.remove.confirmYes}
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
            </form>
          ) : (
            <Button
              variant="ghost"
              className="self-start"
              onClick={() => {
                setConfirming(true);
              }}
            >
              {labels.remove.action}
            </Button>
          )}
        </div>
      </Card>
    </Section>
  );
}

/**
 * The running remainder, in integer cents.
 *
 * Deliberately not `Money`, and deliberately never a float. This is a preview
 * that updates on every keystroke over half-typed input — `Money` would throw
 * on «12.», which is a perfectly normal thing to have typed so far, and
 * `parseFloat` would introduce the binary rounding this whole product exists to
 * keep away from a figure a person reads.
 *
 * So the digits are read as digits: the whole part and the first two decimals,
 * assembled into an integer number of cents by hand.
 */
function centsOf(value: string): number {
  const bare = value.replace(/[^\d.,]/g, '').replace(',', '.');
  if (bare === '') return 0;

  const [whole = '', fraction = ''] = bare.split('.');
  const units = whole === '' ? 0 : Number(whole);
  // Padded then truncated, so «5» reads as 50 cents and «5678» as 56.
  const cents = Number(`${fraction}00`.slice(0, 2));

  return Number.isFinite(units) && Number.isFinite(cents) ? units * 100 + cents : 0;
}

function formatCents(cents: number, symbol: string): string {
  const units = Math.trunc(cents / 100);
  const remainder = Math.abs(cents % 100);
  return `${symbol}${String(units)}.${String(remainder).padStart(2, '0')}`;
}

let counter = 0;
function newKey(): string {
  counter += 1;
  return `line-${String(counter)}`;
}
