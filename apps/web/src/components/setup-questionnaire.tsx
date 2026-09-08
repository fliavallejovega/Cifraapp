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
  id?: string;
  name: string;
  relationship: string;
  isDependent: boolean;
}

interface IncomeRow {
  id?: string;
  name: string;
  amount: string;
  frequency: Frequency;
  isApproximate: boolean;
}
interface AccountRow {
  id?: string;
  name: string;
  accountType: 'checking' | 'savings' | 'cash' | 'digital_wallet';
  balance: string;
}
interface CommitmentRow {
  id?: string;
  name: string;
  amount: string;
  dueDay: string;
  isEssential: boolean;
}
interface DebtRow {
  id?: string;
  name: string;
  balance: string;
  apr: string;
  minimumPayment: string;
  /**
   * A card is two facts and the product needs both: what is owed, which drives
   * the payoff plan, and what is still available on it, which is a spending
   * limit the position has to know about. Blank means «a loan, not a card».
   */
  creditLimit: string;
  /** Whose card it is, by the name given on the first step. Blank means the household's. */
  personName: string;
}
interface GoalRow {
  id?: string;
  name: string;
  targetAmount: string;
  targetDate: string;
}

/**
 * What is still spendable on a card, shown while it is being typed.
 *
 * Read-only reassurance, computed in the browser from two figures the person
 * just entered, so nothing is stored from it — the product's arithmetic on the
 * real rows is what any screen will show afterwards. A limit below the balance
 * reads as zero rather than as a negative: an over-limit card has nothing
 * available, and a minus sign here would look like an error in the form.
 */
function availableOn(limit: string, balance: string, symbol: string): string {
  const asNumber = (value: string) => Number(value.replace(/[^\d.]/g, '')) || 0;
  const left = Math.max(asNumber(limit) - asNumber(balance), 0);
  return `${symbol}${left.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STEPS = ['household', 'income', 'savings', 'commitments', 'debts', 'goals'] as const;
type Step = (typeof STEPS)[number];

/** What is already on record, when the questionnaire is being re-answered. */
export interface SetupInitial {
  readonly people: readonly PersonRow[];
  readonly accounts: readonly AccountRow[];
  readonly incomes: readonly IncomeRow[];
  readonly commitments: readonly CommitmentRow[];
  readonly debts: readonly DebtRow[];
  readonly goals: readonly GoalRow[];
  readonly bufferMinimum: string;
}

export interface SetupQuestionnaireProps {
  readonly locale: string;
  readonly currencySymbol: string;
  /** Every string on the screen, resolved on the server. */
  readonly t: Record<string, string>;
  readonly initial?: SetupInitial;
  /**
   * Answered before. The questions do not change — the words around them do,
   * and so does what saving means: an update to what is on record rather than
   * a first description of it.
   */
  readonly review?: boolean;
}

export function SetupQuestionnaire({
  locale,
  currencySymbol,
  t,
  initial,
  review = false,
}: SetupQuestionnaireProps) {
  // `noUncheckedIndexedAccess` is on, and rightly: a missing key should not
  // silently become `undefined` inside a label. Every lookup goes through here.
  const copy = (key: string): string => t[key] ?? '';

  const [state, formAction, pending] = useActionState<SetupResult, FormData>(completeSetup, {});
  const [index, setIndex] = useState(0);

  // Who lives here, by name. The counts the plan reads are derived from this
  // list rather than typed separately: two records of the same fact disagree
  // eventually, and «four people, two dependents» could never answer «which
  // child was this expense for».
  // A returning household starts from what it already said. One blank row
  // otherwise, because a list that begins empty asks a person to find the
  // «add» button before they can answer the question in front of them.
  const start = <T,>(recorded: readonly T[] | undefined, blank: T): T[] =>
    recorded && recorded.length > 0 ? recorded.map((row) => ({ ...row })) : [blank];

  const [people, setPeople] = useState<PersonRow[]>(
    start(initial?.people, { name: '', relationship: 'self', isDependent: false }),
  );
  const [bufferMinimum, setBufferMinimum] = useState(initial?.bufferMinimum ?? '');

  const [incomes, setIncomes] = useState<IncomeRow[]>(
    start(initial?.incomes, { name: '', amount: '', frequency: 'monthly', isApproximate: false }),
  );
  const [accountRows, setAccountRows] = useState<AccountRow[]>(
    start(initial?.accounts, { name: '', accountType: 'checking', balance: '' }),
  );
  const [commitments, setCommitments] = useState<CommitmentRow[]>(
    start(initial?.commitments, { name: '', amount: '', dueDay: '1', isEssential: true }),
  );
  const [debtRows, setDebtRows] = useState<DebtRow[]>(
    start(initial?.debts, {
      name: '',
      balance: '',
      apr: '',
      minimumPayment: '',
      creditLimit: '',
      personName: '',
    }),
  );
  const [goalRows, setGoalRows] = useState<GoalRow[]>(
    start(initial?.goals, { name: '', targetAmount: '', targetDate: '' }),
  );

  // The figures a person tried on the home page, if they came from there. Read
  // once, on the first render in the browser, and then removed: they have
  // become this form's state, and a second visit should not resurrect them.
  const [fromDraft, setFromDraft] = useState(false);
  useEffect(() => {
    // Not in a review. Figures typed on the home page describe somebody who
    // had no account yet; overwriting a household's recorded answers with them
    // would be the opposite of the correction they came here to make.
    if (review) return;
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
  }, [review]);

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

      <Progress
        index={index}
        total={STEPS.length}
        label={copy('progress') ?? ''}
        steps={STEPS.map((name) => copy(`stages.${name}`))}
      />

      {review && (
        <p className="text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {copy('review.notice')}
        </p>
      )}

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
            setDebtRows([
              ...debtRows,
              {
                name: '',
                balance: '',
                apr: '',
                minimumPayment: '',
                creditLimit: '',
                personName: '',
              },
            ]);
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
              <MoneyField
                label={copy('debts.limit')}
                hint={copy('debts.limitHint')}
                symbol={currencySymbol}
                value={row.creditLimit}
                onChange={(value) => {
                  setDebtRows(patch(debtRows, at, { creditLimit: value }));
                }}
              />
              <Field label={copy('debts.holder')} hint={copy('debts.holderHint')}>
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    value={row.personName}
                    aria-describedby={describedBy}
                    onChange={(event) => {
                      setDebtRows(patch(debtRows, at, { personName: event.target.value }));
                    }}
                  >
                    <option value="">{copy('debts.holderShared')}</option>
                    {namedPeople.map((person) => (
                      <option key={person.name} value={person.name}>
                        {person.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {row.creditLimit.trim() !== '' && row.balance.trim() !== '' && (
                <p className="text-xs text-[color:var(--color-ink-tertiary)] sm:col-span-2">
                  {copy('debts.available').replace(
                    '{amount}',
                    availableOn(row.creditLimit, row.balance, currencySymbol),
                  )}
                </p>
              )}
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
            {copy(review ? 'review.finish' : 'finish')}
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

/**
 * The six stages, as a track a person moves along.
 *
 * It replaces a bar and a count, which answered «how far along am I» and
 * nothing else. Six named stops answer the questions people actually have in a
 * form they did not ask for: what is left, how big each piece is, and — the one
 * that decides whether they finish — whether the end is close. A bar at 66%
 * tells you a third remains; «Deudas, then Metas» tells you it is two short
 * questions, which is a different feeling.
 *
 * The moving parts are deliberately few. The rail fills, the current stop
 * grows and takes the ink, finished stops keep a check. Nothing bounces and
 * nothing loops: this sits above a form somebody is typing into, and motion
 * that draws the eye back to itself every few seconds is motion that costs
 * them their place.
 */
function Progress({
  index,
  total,
  label,
  steps,
}: {
  readonly index: number;
  readonly total: number;
  readonly label: string;
  readonly steps: readonly string[];
}) {
  // The track is never empty: creating the household was the first step and it
  // is already done, so the first question starts above zero rather than
  // telling somebody who has already acted that they have got nowhere.
  const done = index + 1;
  const reading = label.replace('{step}', String(done)).replace('{total}', String(total));

  return (
    <div className="flex flex-col gap-3">
      <p className="gradation-label uppercase">{reading}</p>

      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={reading}
        aria-valuetext={steps[index] ?? reading}
        className="relative"
      >
        {/* The rail, and the ink that has covered it. */}
        <div className="absolute top-[13px] right-0 left-0 h-px bg-[color:var(--color-rule)]" />
        <div
          className="absolute top-[13px] left-0 h-px bg-[color:var(--color-ink)] transition-[width] duration-(--duration-settle) ease-(--ease-settle)"
          style={{ width: `${String((index / Math.max(total - 1, 1)) * 100)}%` }}
        />

        <ol className="relative flex items-start justify-between">
          {steps.map((name, position) => {
            const passed = position < index;
            const current = position === index;
            return (
              <li key={name} className="flex min-w-0 flex-col items-center gap-2">
                <span
                  aria-hidden
                  className={[
                    'flex items-center justify-center rounded-full',
                    'transition-[width,height,background-color,border-color,transform] duration-(--duration-settle) ease-(--ease-settle)',
                    current
                      ? 'h-[26px] w-[26px] bg-[color:var(--color-ink)] text-[color:var(--color-ground)]'
                      : passed
                        ? 'h-[22px] w-[22px] bg-[color:var(--color-ink)] text-[color:var(--color-ground)]'
                        : 'h-[22px] w-[22px] border border-[color:var(--color-rule-strong)] bg-[color:var(--color-ground)] text-[color:var(--color-ink-tertiary)]',
                    // A ring only on the stop being answered, so the eye lands
                    // where the typing is.
                    current
                      ? 'ring-4 ring-[color:color-mix(in_oklch,var(--color-ink)_12%,transparent)]'
                      : '',
                  ].join(' ')}
                >
                  {passed ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path
                        d="M2.5 6.2 4.8 8.5 9.5 3.8"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <span className="gradation-label text-[10px] text-current">{position + 1}</span>
                  )}
                </span>

                {/* The name of every stop on a desk; only the current one on a
                    phone, where six labels would either wrap into a wall or
                    truncate into nonsense. */}
                <span
                  className={[
                    'max-w-[9ch] text-center text-[11px] leading-tight transition-colors duration-(--duration-settle)',
                    current
                      ? 'font-medium text-[color:var(--color-ink)]'
                      : 'text-[color:var(--color-ink-tertiary)]',
                    current ? '' : 'hidden sm:block',
                  ].join(' ')}
                >
                  {name}
                </span>
              </li>
            );
          })}
        </ol>
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
