'use client';

import { Button, Field, Input, Problem, Select, Status } from '@app/ui';
import { useActionState, useEffect, useState, type ReactNode } from 'react';

import { LANDING_DRAFT_KEY, type LandingDraft } from '@/components/marketing/try-it';
import { completeSetup, type SetupResult } from '@/server/onboarding-actions';

/**
 * Setup, as a conversation rather than a form.
 *
 * Six short steps instead of one long page, because the questions are not the
 * same kind of question: how many people live here, what comes in, what is
 * already here, what goes out, what is owed, what it is all for. Each step is
 * answerable in isolation and every one of them can be skipped — a person who
 * has no debts should not have to prove it, and one who does not know their
 * card's rate should not be stopped at the door.
 *
 * The reward is real and it is stated up front: at the end there is a plan
 * built on their own figures. That is true, so it can be promised. Nothing here
 * counts down, expires, or claims anybody else is watching.
 */

type Frequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'quarterly' | 'annual';

interface PersonRow {
  name: string;
  relationship: string;
  isDependent: boolean;
}

interface IncomeRow {
  name: string;
  amount: string;
  frequency: Frequency;
  isApproximate: boolean;
}
interface AccountRow {
  name: string;
  accountType: 'checking' | 'savings' | 'cash' | 'digital_wallet';
  balance: string;
}
interface CommitmentRow {
  name: string;
  amount: string;
  dueDay: string;
  isEssential: boolean;
}
interface DebtRow {
  name: string;
  balance: string;
  apr: string;
  minimumPayment: string;
}
interface GoalRow {
  name: string;
  targetAmount: string;
  targetDate: string;
}

const STEPS = ['household', 'income', 'savings', 'commitments', 'debts', 'goals'] as const;
type Step = (typeof STEPS)[number];

export interface SetupQuestionnaireProps {
  readonly locale: string;
  readonly currencySymbol: string;
  /** Every string on the screen, resolved on the server. */
  readonly t: Record<string, string>;
}

export function SetupQuestionnaire({ locale, currencySymbol, t }: SetupQuestionnaireProps) {
  // `noUncheckedIndexedAccess` is on, and rightly: a missing key should not
  // silently become `undefined` inside a label. Every lookup goes through here.
  const copy = (key: string): string => t[key] ?? '';

  const [state, formAction, pending] = useActionState<SetupResult, FormData>(completeSetup, {});
  const [index, setIndex] = useState(0);

  // Who lives here, by name. The counts the plan reads are derived from this
  // list rather than typed separately: two records of the same fact disagree
  // eventually, and «four people, two dependents» could never answer «which
  // child was this expense for».
  const [people, setPeople] = useState<PersonRow[]>([
    { name: '', relationship: 'self', isDependent: false },
  ]);
  const [bufferMinimum, setBufferMinimum] = useState('');

  const [incomes, setIncomes] = useState<IncomeRow[]>([
    { name: '', amount: '', frequency: 'monthly', isApproximate: false },
  ]);
  const [accountRows, setAccountRows] = useState<AccountRow[]>([
    { name: '', accountType: 'checking', balance: '' },
  ]);
  const [commitments, setCommitments] = useState<CommitmentRow[]>([
    { name: '', amount: '', dueDay: '1', isEssential: true },
  ]);
  const [debtRows, setDebtRows] = useState<DebtRow[]>([
    { name: '', balance: '', apr: '', minimumPayment: '' },
  ]);
  const [goalRows, setGoalRows] = useState<GoalRow[]>([
    { name: '', targetAmount: '', targetDate: '' },
  ]);

  // The figures a person tried on the home page, if they came from there. Read
  // once, on the first render in the browser, and then removed: they have
  // become this form's state, and a second visit should not resurrect them.
  const [fromDraft, setFromDraft] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LANDING_DRAFT_KEY);
      if (!raw) return;
      window.localStorage.removeItem(LANDING_DRAFT_KEY);
      const draft = JSON.parse(raw) as Partial<LandingDraft>;
      const has = (value: unknown): value is string =>
        typeof value === 'string' && value.trim() !== '' && value.trim() !== '0';

      if (has(draft.balance)) {
        setAccountRows([
          { name: copy('draft.account'), accountType: 'checking', balance: draft.balance },
        ]);
      }
      if (has(draft.buffer)) setBufferMinimum(draft.buffer);

      const rows: CommitmentRow[] = [];
      if (has(draft.rent)) {
        rows.push({ name: copy('draft.rent'), amount: draft.rent, dueDay: '1', isEssential: true });
      }
      if (has(draft.minimums)) {
        rows.push({
          name: copy('draft.minimums'),
          amount: draft.minimums,
          dueDay: '5',
          isEssential: true,
        });
      }
      if (has(draft.other)) {
        rows.push({
          name: copy('draft.other'),
          amount: draft.other,
          dueDay: '15',
          isEssential: true,
        });
      }
      if (rows.length > 0) setCommitments(rows);

      setFromDraft(true);
    } catch {
      // Storage unavailable or unreadable. The form opens as it always did.
    }
    // Runs once; `copy` is stable for the life of the page.
  }, []);

  const step: Step = STEPS[index] ?? 'household';
  const isLast = index === STEPS.length - 1;

  // A row counts only when it has both a name and a figure. A half-filled row
  // is a person who changed their mind, not an entry with a missing field.
  const namedPeople = people.filter((row) => row.name.trim() !== '');

  const payload = {
    people: namedPeople,
    // Derived, so the figure the plan reads and the list a person can see can
    // never drift apart. A household that skipped the step still counts as one.
    memberCount: String(Math.max(1, namedPeople.length)),
    dependentCount: String(namedPeople.filter((row) => row.isDependent).length),
    bufferMinimum: bufferMinimum.trim(),
    incomes: incomes.filter((row) => row.name.trim() !== '' && row.amount.trim() !== ''),
    accounts: accountRows.filter((row) => row.name.trim() !== '' && row.balance.trim() !== ''),
    commitments: commitments.filter((row) => row.name.trim() !== '' && row.amount.trim() !== ''),
    debts: debtRows.filter(
      (row) =>
        row.name.trim() !== '' &&
        row.balance.trim() !== '' &&
        row.apr.trim() !== '' &&
        row.minimumPayment.trim() !== '',
    ),
    goals: goalRows.filter((row) => row.name.trim() !== '' && row.targetAmount.trim() !== ''),
  };

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      <Progress index={index} total={STEPS.length} label={copy('progress') ?? ''} />

      {fromDraft && <Status tone="neutral">{copy('draft.notice')}</Status>}

      {state.error && (
        <Problem
          title={copy('errorTitle') ?? ''}
          body={copy(`error.${state.error}`) ?? copy('error.generic') ?? ''}
        />
      )}

      <div>
        <h2
          className="text-2xl font-medium text-balance"
          style={{ letterSpacing: 'var(--tracking-title)', lineHeight: 1.15 }}
        >
          {copy(`${step}.title`)}
        </h2>
        <p className="mt-2 max-w-[56ch] text-pretty text-[color:var(--color-ink-secondary)]">
          {copy(`${step}.detail`)}
        </p>
      </div>

      {step === 'household' && (
        <RowEditor
          rows={people}
          addLabel={copy('household.add')}
          removeLabel={copy('remove')}
          onAdd={() => {
            setPeople([...people, { name: '', relationship: 'child', isDependent: true }]);
          }}
          onRemove={(at) => {
            setPeople(people.filter((_, position) => position !== at));
          }}
          render={(row, at) => (
            <>
              <Field label={copy('household.name')} hint={copy('household.nameHint')}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    value={row.name}
                    placeholder={copy('household.namePlaceholder')}
                    aria-describedby={describedBy}
                    onChange={(event) => {
                      setPeople(patch(people, at, { name: event.target.value }));
                    }}
                  />
                )}
              </Field>

              <Field label={copy('household.relationship')}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={row.relationship}
                    onChange={(event) => {
                      const relationship = event.target.value;
                      setPeople(
                        patch(people, at, {
                          relationship,
                          // A child is a dependant unless somebody says
                          // otherwise; «self» and «partner» are not. Choosing
                          // the common answer is what the household reads as a
                          // recommendation, and most never change it.
                          isDependent: relationship === 'child' || relationship === 'parent',
                        }),
                      );
                    }}
                  >
                    {['self', 'partner', 'child', 'parent', 'sibling', 'other'].map((value) => (
                      <option key={value} value={value}>
                        {copy(`household.relationships.${value}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <div className="sm:col-span-2">
                <label className="flex items-start gap-2.5 text-sm text-[color:var(--color-ink-secondary)]">
                  <input
                    type="checkbox"
                    checked={row.isDependent}
                    onChange={(event) => {
                      setPeople(patch(people, at, { isDependent: event.target.checked }));
                    }}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--color-brand)]"
                  />
                  <span>{copy('household.dependent')}</span>
                </label>
              </div>
            </>
          )}
        />
      )}

      {step === 'income' && (
        <RowEditor
          rows={incomes}
          addLabel={copy('income.add')}
          removeLabel={copy('remove')}
          onAdd={() => {
            setIncomes([
              ...incomes,
              { name: '', amount: '', frequency: 'monthly', isApproximate: false },
            ]);
          }}
          onRemove={(at) => {
            setIncomes(incomes.filter((_, position) => position !== at));
          }}
          render={(row, at) => (
            <>
              <Field label={copy('income.name')} className="sm:col-span-2">
                {({ id }) => (
                  <Input
                    id={id}
                    value={row.name}
                    placeholder={copy('income.namePlaceholder')}
                    onChange={(event) => {
                      setIncomes(patch(incomes, at, { name: event.target.value }));
                    }}
                  />
                )}
              </Field>
              <MoneyField
                label={copy('amount')}
                symbol={currencySymbol}
                value={row.amount}
                onChange={(value) => {
                  setIncomes(patch(incomes, at, { amount: value }));
                }}
              />
              <Field label={copy('income.frequency')}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={row.frequency}
                    onChange={(event) => {
                      setIncomes(
                        patch(incomes, at, { frequency: event.target.value as Frequency }),
                      );
                    }}
                  >
                    {(
                      [
                        'weekly',
                        'biweekly',
                        'semimonthly',
                        'monthly',
                        'quarterly',
                        'annual',
                      ] as const
                    ).map((value) => (
                      <option key={value} value={value}>
                        {copy(`frequency.${value}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Check
                label={copy('income.approximate')}
                hint={copy('income.approximateHint')}
                checked={row.isApproximate}
                onChange={(checked) => {
                  setIncomes(patch(incomes, at, { isApproximate: checked }));
                }}
              />
            </>
          )}
        />
      )}

      {step === 'savings' && (
        <RowEditor
          rows={accountRows}
          addLabel={copy('savings.add')}
          removeLabel={copy('remove')}
          onAdd={() => {
            setAccountRows([...accountRows, { name: '', accountType: 'savings', balance: '' }]);
          }}
          onRemove={(at) => {
            setAccountRows(accountRows.filter((_, position) => position !== at));
          }}
          render={(row, at) => (
            <>
              <Field label={copy('savings.name')} className="sm:col-span-2">
                {({ id }) => (
                  <Input
                    id={id}
                    value={row.name}
                    placeholder={copy('savings.namePlaceholder')}
                    onChange={(event) => {
                      setAccountRows(patch(accountRows, at, { name: event.target.value }));
                    }}
                  />
                )}
              </Field>
              <Field label={copy('savings.type')}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={row.accountType}
                    onChange={(event) => {
                      setAccountRows(
                        patch(accountRows, at, {
                          accountType: event.target.value as AccountRow['accountType'],
                        }),
                      );
                    }}
                  >
                    {(['checking', 'savings', 'cash', 'digital_wallet'] as const).map((value) => (
                      <option key={value} value={value}>
                        {copy(`accountType.${value}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <MoneyField
                label={copy('savings.balance')}
                symbol={currencySymbol}
                value={row.balance}
                onChange={(value) => {
                  setAccountRows(patch(accountRows, at, { balance: value }));
                }}
              />
            </>
          )}
        />
      )}

      {step === 'commitments' && (
        <RowEditor
          rows={commitments}
          addLabel={copy('commitments.add')}
          removeLabel={copy('remove')}
          onAdd={() => {
            setCommitments([
              ...commitments,
              { name: '', amount: '', dueDay: '1', isEssential: true },
            ]);
          }}
          onRemove={(at) => {
            setCommitments(commitments.filter((_, position) => position !== at));
          }}
          render={(row, at) => (
            <>
              <Field label={copy('commitments.name')} className="sm:col-span-2">
                {({ id }) => (
                  <Input
                    id={id}
                    value={row.name}
                    placeholder={copy('commitments.namePlaceholder')}
                    onChange={(event) => {
                      setCommitments(patch(commitments, at, { name: event.target.value }));
                    }}
                  />
                )}
              </Field>
              <MoneyField
                label={copy('amount')}
                symbol={currencySymbol}
                value={row.amount}
                onChange={(value) => {
                  setCommitments(patch(commitments, at, { amount: value }));
                }}
              />
              <Field label={copy('commitments.dueDay')} hint={copy('commitments.dueDayHint')}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    numeric
                    inputMode="numeric"
                    value={row.dueDay}
                    aria-describedby={describedBy}
                    onChange={(event) => {
                      setCommitments(patch(commitments, at, { dueDay: event.target.value }));
                    }}
                  />
                )}
              </Field>
              <Check
                label={copy('commitments.essential')}
                hint={copy('commitments.essentialHint')}
                checked={row.isEssential}
                onChange={(checked) => {
                  setCommitments(patch(commitments, at, { isEssential: checked }));
                }}
              />
            </>
          )}
        />
      )}

      {step === 'debts' && (
        <RowEditor
          rows={debtRows}
          addLabel={copy('debts.add')}
          removeLabel={copy('remove')}
          onAdd={() => {
            setDebtRows([...debtRows, { name: '', balance: '', apr: '', minimumPayment: '' }]);
          }}
          onRemove={(at) => {
            setDebtRows(debtRows.filter((_, position) => position !== at));
          }}
          render={(row, at) => (
            <>
              <Field label={copy('debts.name')} className="sm:col-span-2">
                {({ id }) => (
                  <Input
                    id={id}
                    value={row.name}
                    placeholder={copy('debts.namePlaceholder')}
                    onChange={(event) => {
                      setDebtRows(patch(debtRows, at, { name: event.target.value }));
                    }}
                  />
                )}
              </Field>
              <MoneyField
                label={copy('debts.balance')}
                symbol={currencySymbol}
                value={row.balance}
                onChange={(value) => {
                  setDebtRows(patch(debtRows, at, { balance: value }));
                }}
              />
              <Field label={copy('debts.apr')} hint={copy('debts.aprHint')}>
                {({ id, describedBy }) => (
                  <div className="relative">
                    <Input
                      id={id}
                      numeric
                      inputMode="decimal"
                      value={row.apr}
                      placeholder="0.0"
                      aria-describedby={describedBy}
                      className="pr-8"
                      onChange={(event) => {
                        setDebtRows(patch(debtRows, at, { apr: event.target.value }));
                      }}
                    />
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-[color:var(--color-ink-tertiary)]"
                    >
                      %
                    </span>
                  </div>
                )}
              </Field>
              <MoneyField
                label={copy('debts.minimum')}
                hint={copy('debts.minimumHint')}
                symbol={currencySymbol}
                value={row.minimumPayment}
                onChange={(value) => {
                  setDebtRows(patch(debtRows, at, { minimumPayment: value }));
                }}
              />
            </>
          )}
        />
      )}

      {step === 'goals' && (
        <div className="flex flex-col gap-8">
          <RowEditor
            rows={goalRows}
            addLabel={copy('goals.add')}
            removeLabel={copy('remove')}
            onAdd={() => {
              setGoalRows([...goalRows, { name: '', targetAmount: '', targetDate: '' }]);
            }}
            onRemove={(at) => {
              setGoalRows(goalRows.filter((_, position) => position !== at));
            }}
            render={(row, at) => (
              <>
                <Field label={copy('goals.name')} className="sm:col-span-2">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={row.name}
                      placeholder={copy('goals.namePlaceholder')}
                      onChange={(event) => {
                        setGoalRows(patch(goalRows, at, { name: event.target.value }));
                      }}
                    />
                  )}
                </Field>
                <MoneyField
                  label={copy('goals.target')}
                  symbol={currencySymbol}
                  value={row.targetAmount}
                  onChange={(value) => {
                    setGoalRows(patch(goalRows, at, { targetAmount: value }));
                  }}
                />
                <Field label={copy('goals.date')} hint={copy('goals.dateHint')}>
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      type="date"
                      value={row.targetDate}
                      aria-describedby={describedBy}
                      onChange={(event) => {
                        setGoalRows(patch(goalRows, at, { targetDate: event.target.value }));
                      }}
                    />
                  )}
                </Field>
              </>
            )}
          />

          <div className="max-w-xs border-t border-[color:var(--color-rule)] pt-8">
            <MoneyField
              label={copy('goals.buffer')}
              hint={copy('goals.bufferHint')}
              symbol={currencySymbol}
              value={bufferMinimum}
              onChange={setBufferMinimum}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-[color:var(--color-rule)] pt-6">
        {/* Distinct keys, and the reason is not cosmetic. Without them React
            reuses one DOM button and only swaps its `type` attribute — so the
            click that advanced to the last step re-rendered the very button
            being clicked into a submit button, and the browser then ran the
            default action for what it now was. The form posted a step early,
            silently dropping whatever the last step would have collected. */}
        {isLast ? (
          <Button key="finish" type="submit" size="lg" loading={pending}>
            {copy('finish')}
          </Button>
        ) : (
          <Button
            key="next"
            type="button"
            size="lg"
            onClick={() => {
              setIndex(index + 1);
            }}
          >
            {copy(`${step}.next`) || copy('next')}
          </Button>
        )}

        {index > 0 && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setIndex(index - 1);
            }}
          >
            {copy('back')}
          </Button>
        )}

        {/* Skipping is a real answer, not an escape hatch. A household with no
            debts says so by moving on. */}
        {!isLast && index > 0 && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setIndex(index + 1);
            }}
          >
            {copy('skipStep')}
          </Button>
        )}
      </div>
    </form>
  );
}

function Progress({
  index,
  total,
  label,
}: {
  readonly index: number;
  readonly total: number;
  readonly label: string;
}) {
  // The bar is never empty: creating the household was the first step and it is
  // already done, so the first question starts above zero rather than telling a
  // person who has already acted that they have got nowhere.
  const done = index + 1;
  return (
    <div className="flex flex-col gap-2">
      <p className="gradation-label uppercase">
        {label.replace('{step}', String(done)).replace('{total}', String(total))}
      </p>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={label.replace('{step}', String(done)).replace('{total}', String(total))}
        className="h-1 w-full max-w-md bg-[color:var(--color-ground-sunk)]"
      >
        <div
          className="h-full bg-[color:var(--color-ink)] transition-[width] duration-(--duration-quick) ease-(--ease-settle)"
          style={{ width: `${String((done / total) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function RowEditor<T>({
  rows,
  addLabel,
  removeLabel,
  onAdd,
  onRemove,
  render,
}: {
  readonly rows: readonly T[];
  readonly addLabel: string;
  readonly removeLabel: string;
  readonly onAdd: () => void;
  readonly onRemove: (index: number) => void;
  readonly render: (row: T, index: number) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      {rows.map((row, index) => (
        <div
          // Rows are positional and have no identity of their own until they
          // are saved; the index is the only stable handle there is.
          key={index}
          className="grid gap-4 border-t border-[color:var(--color-rule)] pt-6 first:border-t-0 first:pt-0 sm:grid-cols-2"
        >
          {render(row, index)}
          {rows.length > 1 && (
            <div className="sm:col-span-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  onRemove(index);
                }}
              >
                {removeLabel}
              </Button>
            </div>
          )}
        </div>
      ))}

      <Button type="button" variant="secondary" size="sm" className="self-start" onClick={onAdd}>
        {addLabel}
      </Button>
    </div>
  );
}

function MoneyField({
  label,
  hint,
  symbol,
  value,
  onChange,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly symbol: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      {({ id, describedBy }) => (
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[color:var(--color-ink-tertiary)]"
          >
            {symbol}
          </span>
          <Input
            id={id}
            numeric
            inputMode="decimal"
            placeholder="0.00"
            value={value}
            aria-describedby={describedBy}
            className="pl-8"
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        </div>
      )}
    </Field>
  );
}

function patch<T>(rows: readonly T[], index: number, change: Partial<T>): T[] {
  return rows.map((row, position) => (position === index ? { ...row, ...change } : row));
}

function Check({
  label,
  hint,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 sm:col-span-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--color-ink)]"
      />
      <span className="text-sm">
        <span className="text-[color:var(--color-ink)]">{label}</span>
        <span className="mt-0.5 block text-xs text-[color:var(--color-ink-secondary)]">{hint}</span>
      </span>
    </label>
  );
}
