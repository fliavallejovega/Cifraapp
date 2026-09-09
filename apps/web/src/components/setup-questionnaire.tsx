'use client';

import { Button, Field, Input, Problem, Select, Status } from '@app/ui';
import {
  useActionState,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

import { LANDING_DRAFT_KEY, type LandingDraft } from '@/components/marketing/try-it';
import { KindIcon, SymbolSearch } from '@/components/symbol-search';
import { lookupSymbol, type SymbolCandidate } from '@/server/holdings-actions';
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

type Frequency =
  'daily' | 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'quarterly' | 'annual';

/** Offered in this order, commonest first. */
const FREQUENCIES: readonly Frequency[] = [
  'monthly',
  'semimonthly',
  'biweekly',
  'weekly',
  'daily',
  'quarterly',
  'annual',
];

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
  /**
   * The two days of the month a twice-monthly income lands on.
   *
   * «Quincenal» is not one cadence: the 15th and the 30th, the 5th and the
   * 20th, and the 1st and the 16th are three different calendars, and which one
   * a household is on decides which fortnight carries the rent. Asking is the
   * only way to know, and it is two number fields.
   */
  anchorFirst?: string | undefined;
  anchorSecond?: string | undefined;
}
interface AccountRow {
  id?: string;
  name: string;
  accountType: 'checking' | 'savings' | 'cash' | 'digital_wallet';
  balance: string;
  /** The institution, by name, from the seeded list. Blank for cash. */
  institution: string;
  /** What it pays, annually, as a percentage. Asked, never assumed. */
  interestRate: string;
}

/**
 * Something owned that is not cash: shares, funds, a coin.
 *
 * The quantity is the household's to state. The price is looked up while they
 * type and belongs to whoever quoted it — which is why the symbol, not the
 * value, is what gets stored here.
 */
interface HoldingRow {
  id?: string;
  symbol: string;
  label: string;
  quantity: string;
  personName: string;
  /** Filled in by the lookup, shown back, never sent as an answer. */
  quoted?: { name: string; price: string; currency: string; kind: string } | undefined;
  status?: 'idle' | 'checking' | 'ok' | 'unknown' | 'unavailable' | undefined;
}
interface CommitmentRow {
  id?: string;
  name: string;
  amount: string;
  dueDay: string;
  isEssential: boolean;
  /**
   * Which income this is taken out of, by its position in the income step.
   *
   * Undefined is the ordinary case: the household pays it from money it holds.
   * The position rather than an id, because on a first pass the incomes have
   * no ids yet — they are created in the same save as the commitments that
   * point at them.
   */
  /**
   * De qué sueldo sale este pago, por su posición en el paso de ingresos.
   *
   * Separado de si lo descuentan en planilla, porque no son la misma pregunta:
   * se puede pagar el alquiler del sueldo de uno sin que nadie lo descuente.
   * Solo la segunda cambia lo que reclama el saldo; la primera es para que el
   * hogar pueda ordenarse.
   */
  paidFromIncome?: number | undefined;
  isDeductedAtSource?: boolean | undefined;
  /** El rubro, por su slug. Vacío es «sin rubro», que es una respuesta. */
  categorySlug?: string | undefined;
  /** Un monto por quincena, cuando no son parejas. Vacío es «lo mismo las dos». */
  anchorFirstAmount?: string | undefined;
  anchorSecondAmount?: string | undefined;
  /**
   * What paying late costs, and how late «late» is.
   *
   * The shape is answered separately from the figure because a rate and an
   * amount are not the same kind of number: «5» meaning five percent and «5»
   * meaning five dollars differ by two orders of magnitude on a rent, and
   * nothing about the digits says which was meant.
   */
  lateFeeKind?: 'none' | 'amount' | 'rate';
  lateFee?: string;
  lateFeeAfterDays?: string;
  /**
   * How often it is paid, and on which days when it is twice a month.
   *
   * A monthly payment on the 5th already exists in one fortnight and not the
   * other — that falls out of the date alone. What could not be said before is
   * everything else: a fee charged weekly, a loan taken twice a month, a quota
   * that lands on the 15th *and* the 30th.
   */
  frequency?: Frequency | undefined;
  anchorFirst?: string | undefined;
  anchorSecond?: string | undefined;
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
  readonly holdings: readonly HoldingRow[];
  readonly bufferMinimum: string;
}

export interface SetupQuestionnaireProps {
  readonly locale: string;
  readonly currencySymbol: string;
  /**
   * The household's currency code, not just its symbol.
   *
   * The symbol cannot answer the question the total has to ask — «is this
   * holding quoted in our money?» — and guessing from the symbol would add
   * dollars to balboas, which this system refuses to do anywhere else.
   */
  readonly currencyCode: string;
  /** Every string on the screen, resolved on the server. */
  readonly t: Record<string, string>;
  /** The banks of Panama, from `app.institutions`. Names only — a rate is not a fact this system has. */
  readonly institutions: readonly string[];
  /** Los rubros del hogar, para preguntar en qué se va cada pago. */
  readonly categories: readonly { readonly slug: string; readonly name: string }[];
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
  currencyCode,
  t,
  institutions,
  categories,
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
    start(initial?.accounts, {
      name: '',
      accountType: 'checking',
      balance: '',
      institution: '',
      interestRate: '',
    }),
  );
  /**
   * The incomes worth offering as «se descuenta de aquí»: the ones that have a
   * name to show. A blank row in the income step is not a salary yet, and
   * listing it would offer a deduction from nothing.
   *
   * The position travels with the name because the position is what gets
   * stored — the incomes have no ids until this form is saved.
   */
  const namedIncomes = incomes
    .map((income, at) => ({ at, name: income.name.trim() }))
    .filter((income) => income.name !== '');

  const [commitments, setCommitments] = useState<CommitmentRow[]>(
    // Normalised on the way in, not defaulted at every use site. A row read
    // back from the database predates these fields, so `lateFeeKind` arrived
    // as `undefined` — and `undefined !== 'none'` is true, which put «¿a los
    // cuántos días?» on screen for a commitment that charges no late fee at
    // all. One shape for every row is what stops that class of bug.
    start(initial?.commitments, {
      name: '',
      amount: '',
      dueDay: '1',
      isEssential: true,
      frequency: 'monthly',
      lateFeeKind: 'none',
      lateFee: '',
      lateFeeAfterDays: '',
    }).map((row) => ({
      lateFeeKind: 'none' as const,
      lateFee: '',
      lateFeeAfterDays: '',
      frequency: 'monthly' as const,
      ...row,
    })),
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
  const [holdingRows, setHoldingRows] = useState<HoldingRow[]>(
    initial?.holdings && initial.holdings.length > 0
      ? initial.holdings.map((row) => ({ ...row }))
      : [],
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
          {
            name: copy('draft.account'),
            accountType: 'checking',
            balance: draft.balance,
            institution: '',
            interestRate: '',
          },
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
    incomes: incomes
      .filter((row) => row.name.trim() !== '' && row.amount.trim() !== '')
      .map((row) => ({ ...row, anchorDays: anchorDaysOf(row) })),
    accounts: accountRows.filter((row) => row.name.trim() !== '' && row.balance.trim() !== ''),
    // A deduction points at an income by position, and the income step is
    // still editable — somebody can go back and blank the salary a commitment
    // was pointed at. Dropping the pointer when it no longer names anything is
    // what stops «se descuenta del sueldo de Ana» from silently becoming a
    // deduction from whoever now sits in that slot.
    commitments: commitments
      .filter((row) => row.name.trim() !== '' && row.amount.trim() !== '')
      .map((row) => ({
        ...(row.paidFromIncome !== undefined &&
        namedIncomes.some((income) => income.at === row.paidFromIncome)
          ? row
          : { ...row, paidFromIncome: undefined, isDeductedAtSource: false }),
        anchorDays: anchorDaysOf(row),
        anchorAmounts: anchorAmountsOf(row),
      })),
    debts: debtRows.filter(
      (row) =>
        row.name.trim() !== '' &&
        row.balance.trim() !== '' &&
        row.apr.trim() !== '' &&
        row.minimumPayment.trim() !== '',
    ),
    goals: goalRows.filter((row) => row.name.trim() !== '' && row.targetAmount.trim() !== ''),
    // Only what was found and counted. A symbol nobody could price is not a
    // holding yet, and storing it would put a row in the portfolio that no
    // screen can value.
    holdings: holdingRows
      .filter(
        (row) => row.symbol.trim() !== '' && row.quantity.trim() !== '' && row.status === 'ok',
      )
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        symbol: row.symbol.trim().toUpperCase(),
        label:
          row.label.trim() !== ''
            ? row.label.trim()
            : (row.quoted?.name ?? row.symbol.trim().toUpperCase()),
        quantity: row.quantity.trim(),
        kind: row.quoted?.kind ?? 'other',
        currency: row.quoted?.currency ?? 'USD',
        personName: row.personName,
      })),
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
          addFirstLabel={copy('household.addFirst')}
          emptyHint={copy('household.empty')}
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
          addFirstLabel={copy('income.addFirst')}
          emptyHint={copy('income.empty')}
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
                    {FREQUENCIES.map((value) => (
                      <option key={value} value={value}>
                        {copy(`frequency.${value}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {row.frequency === 'semimonthly' && (
                <>
                  <Field label={copy('income.firstDay')} hint={copy('income.daysHint')}>
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        numeric
                        inputMode="numeric"
                        placeholder="15"
                        value={row.anchorFirst ?? ''}
                        aria-describedby={describedBy}
                        onChange={(event) => {
                          setIncomes(patch(incomes, at, { anchorFirst: event.target.value }));
                        }}
                      />
                    )}
                  </Field>
                  <Field label={copy('income.secondDay')} hint={copy('income.lastDayHint')}>
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        numeric
                        inputMode="numeric"
                        placeholder="30"
                        value={row.anchorSecond ?? ''}
                        aria-describedby={describedBy}
                        onChange={(event) => {
                          setIncomes(patch(incomes, at, { anchorSecond: event.target.value }));
                        }}
                      />
                    )}
                  </Field>
                </>
              )}

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
        <div className="flex flex-col gap-10">
          <RowEditor
            rows={accountRows}
            addLabel={copy('savings.add')}
            removeLabel={copy('remove')}
            addFirstLabel={copy('savings.addFirst')}
            emptyHint={copy('savings.empty')}
            onAdd={() => {
              setAccountRows([
                ...accountRows,
                {
                  name: '',
                  accountType: 'savings',
                  balance: '',
                  institution: '',
                  interestRate: '',
                },
              ]);
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
                {row.accountType !== 'cash' && (
                  <>
                    <Field
                      label={copy('savings.institution')}
                      hint={copy('savings.institutionHint')}
                    >
                      {({ id, describedBy }) => (
                        <Select
                          id={id}
                          value={row.institution}
                          aria-describedby={describedBy}
                          onChange={(event) => {
                            setAccountRows(
                              patch(accountRows, at, { institution: event.target.value }),
                            );
                          }}
                        >
                          <option value="">{copy('savings.institutionNone')}</option>
                          {institutions.map((bank) => (
                            <option key={bank} value={bank}>
                              {bank}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label={copy('savings.rate')} hint={copy('savings.rateHint')}>
                      {({ id, describedBy }) => (
                        <div className="relative">
                          <Input
                            id={id}
                            numeric
                            inputMode="decimal"
                            value={row.interestRate}
                            placeholder="0.0"
                            aria-describedby={describedBy}
                            className="pr-8"
                            onChange={(event) => {
                              setAccountRows(
                                patch(accountRows, at, { interestRate: event.target.value }),
                              );
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
                  </>
                )}
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

          <HoldingsEditor
            rows={holdingRows}
            setRows={setHoldingRows}
            people={namedPeople.map((person) => person.name)}
            copy={copy}
          />

          <FamilyFunds
            accounts={accountRows}
            holdings={holdingRows}
            currencySymbol={currencySymbol}
            currencyCode={currencyCode}
            copy={copy}
          />
        </div>
      )}

      {step === 'commitments' && (
        <RowEditor
          rows={commitments}
          addLabel={copy('commitments.add')}
          removeLabel={copy('remove')}
          addFirstLabel={copy('commitments.addFirst')}
          emptyHint={copy('commitments.empty')}
          onAdd={() => {
            setCommitments([
              ...commitments,
              {
                name: '',
                amount: '',
                dueDay: '1',
                isEssential: true,
                frequency: 'monthly',
                lateFeeKind: 'none',
                lateFee: '',
                lateFeeAfterDays: '',
              },
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
              <Field label={copy('commitments.category')} hint={copy('commitments.categoryHint')}>
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    value={row.categorySlug ?? ''}
                    onChange={(event) => {
                      setCommitments(patch(commitments, at, { categorySlug: event.target.value }));
                    }}
                  >
                    <option value="">{copy('commitments.categoryNone')}</option>
                    {categories.map((category) => (
                      <option key={category.slug} value={category.slug}>
                        {category.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {namedIncomes.length > 0 && (
                <Field label={copy('commitments.paidFrom')} hint={copy('commitments.paidFromHint')}>
                  {({ id, describedBy }) => (
                    <Select
                      id={id}
                      aria-describedby={describedBy}
                      value={row.paidFromIncome === undefined ? '' : String(row.paidFromIncome)}
                      onChange={(event) => {
                        const chosen =
                          event.target.value === '' ? undefined : Number(event.target.value);
                        setCommitments(
                          patch(commitments, at, {
                            paidFromIncome: chosen,
                            // «Se descuenta» solo significa algo contra un
                            // sueldo. Sin sueldo elegido no hay de dónde
                            // descontarlo, así que la marca se va con él.
                            ...(chosen === undefined ? { isDeductedAtSource: false } : {}),
                          }),
                        );
                      }}
                    >
                      <option value="">{copy('commitments.paidFromNone')}</option>
                      {namedIncomes.map((income) => (
                        <option key={income.at} value={income.at}>
                          {income.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}

              {row.paidFromIncome !== undefined && (
                <div className="sm:col-span-2">
                  <Check
                    label={copy('commitments.atSource')}
                    hint={copy('commitments.atSourceHint')}
                    checked={row.isDeductedAtSource ?? false}
                    onChange={(checked) => {
                      setCommitments(patch(commitments, at, { isDeductedAtSource: checked }));
                    }}
                  />
                </div>
              )}

              <Field label={copy('commitments.frequency')} hint={copy('commitments.frequencyHint')}>
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    value={row.frequency ?? 'monthly'}
                    onChange={(event) => {
                      setCommitments(
                        patch(commitments, at, { frequency: event.target.value as Frequency }),
                      );
                    }}
                  >
                    {FREQUENCIES.map((value) => (
                      <option key={value} value={value}>
                        {copy(`frequency.${value}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {row.frequency === 'semimonthly' && (
                <>
                  <Field label={copy('commitments.firstDay')} hint={copy('commitments.daysHint')}>
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        numeric
                        inputMode="numeric"
                        placeholder="15"
                        value={row.anchorFirst ?? ''}
                        aria-describedby={describedBy}
                        onChange={(event) => {
                          setCommitments(
                            patch(commitments, at, { anchorFirst: event.target.value }),
                          );
                        }}
                      />
                    )}
                  </Field>
                  <Field
                    label={copy('commitments.secondDay')}
                    hint={copy('commitments.lastDayHint')}
                  >
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        numeric
                        inputMode="numeric"
                        placeholder="30"
                        value={row.anchorSecond ?? ''}
                        aria-describedby={describedBy}
                        onChange={(event) => {
                          setCommitments(
                            patch(commitments, at, { anchorSecond: event.target.value }),
                          );
                        }}
                      />
                    )}
                  </Field>

                  {/* Los montos por quincena, opcionales y en blanco por
                      defecto: la mayoría paga lo mismo las dos veces, y pedir
                      dos cifras a quien tiene una sola sería cobrarle a todos
                      el caso de algunos. */}
                  <MoneyField
                    label={copy('commitments.firstAmount')}
                    hint={copy('commitments.unevenHint')}
                    symbol={currencySymbol}
                    value={row.anchorFirstAmount ?? ''}
                    onChange={(value) => {
                      setCommitments(patch(commitments, at, { anchorFirstAmount: value }));
                    }}
                  />
                  <MoneyField
                    label={copy('commitments.secondAmount')}
                    symbol={currencySymbol}
                    value={row.anchorSecondAmount ?? ''}
                    onChange={(value) => {
                      setCommitments(patch(commitments, at, { anchorSecondAmount: value }));
                    }}
                  />
                </>
              )}

              <Field
                label={copy('commitments.lateFee')}
                hint={copy('commitments.lateFeeHint')}
                {...(row.lateFeeKind === 'none' ? { className: 'sm:col-span-2' } : {})}
              >
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    value={row.lateFeeKind ?? 'none'}
                    onChange={(event) => {
                      const kind = event.target.value as 'none' | 'amount' | 'rate';
                      setCommitments(
                        patch(commitments, at, {
                          lateFeeKind: kind,
                          // The figure is cleared on *every* change of shape,
                          // not only on «no cobra recargo». Going from «5%» to
                          // «un monto fijo» left the 5 sitting there and it
                          // silently became five dollars — the exact mistake
                          // the two separate columns exist to prevent, walked
                          // straight back in through the form. The days of
                          // grace survive, because they mean the same thing
                          // whichever shape the charge takes.
                          lateFee: '',
                          ...(kind === 'none' ? { lateFeeAfterDays: '' } : {}),
                        }),
                      );
                    }}
                  >
                    <option value="none">{copy('commitments.lateFeeNone')}</option>
                    <option value="amount">{copy('commitments.lateFeeAmount')}</option>
                    <option value="rate">{copy('commitments.lateFeeRate')}</option>
                  </Select>
                )}
              </Field>

              {row.lateFeeKind === 'amount' && (
                <MoneyField
                  label={copy('commitments.lateFeeHowMuch')}
                  symbol={currencySymbol}
                  value={row.lateFee ?? ''}
                  onChange={(value) => {
                    setCommitments(patch(commitments, at, { lateFee: value }));
                  }}
                />
              )}

              {row.lateFeeKind === 'rate' && (
                <Field label={copy('commitments.lateFeeHowMuchRate')}>
                  {({ id }) => (
                    <div className="relative">
                      <Input
                        id={id}
                        numeric
                        inputMode="decimal"
                        placeholder="0.0"
                        className="pr-8"
                        value={row.lateFee ?? ''}
                        onChange={(event) => {
                          setCommitments(patch(commitments, at, { lateFee: event.target.value }));
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
              )}

              {row.lateFeeKind !== 'none' && (
                <Field
                  label={copy('commitments.lateFeeAfter')}
                  hint={copy('commitments.lateFeeAfterHint')}
                  className="sm:col-span-2"
                >
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      numeric
                      inputMode="numeric"
                      placeholder="0"
                      value={row.lateFeeAfterDays ?? ''}
                      aria-describedby={describedBy}
                      onChange={(event) => {
                        setCommitments(
                          patch(commitments, at, { lateFeeAfterDays: event.target.value }),
                        );
                      }}
                    />
                  )}
                </Field>
              )}

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

      {step === 'commitments' && (
        <CommitmentsTotal
          rows={commitments}
          incomes={namedIncomes}
          categories={categories}
          currencySymbol={currencySymbol}
          copy={copy}
        />
      )}

      {step === 'debts' && (
        <RowEditor
          rows={debtRows}
          addLabel={copy('debts.add')}
          removeLabel={copy('remove')}
          addFirstLabel={copy('debts.addFirst')}
          emptyHint={copy('debts.empty')}
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
            addFirstLabel={copy('goals.addFirst')}
            emptyHint={copy('goals.empty')}
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
  addFirstLabel,
  removeLabel,
  emptyHint,
  onAdd,
  onRemove,
  render,
}: {
  readonly rows: readonly T[];
  readonly addLabel: string;
  /** «Agregar la primera», for when there is nothing to add another to. */
  readonly addFirstLabel: string;
  readonly removeLabel: string;
  /** What this step will hold, shown when it holds nothing yet. */
  readonly emptyHint: string;
  readonly onAdd: () => void;
  readonly onRemove: (index: number) => void;
  readonly render: (row: T, index: number) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      {rows.length === 0 && (
        <p className="max-w-[56ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {emptyHint}
        </p>
      )}

      {rows.map((row, index) => (
        <div
          // Rows are positional and have no identity of their own until they
          // are saved; the index is the only stable handle there is.
          key={index}
          className="grid gap-4 border-t border-[color:var(--color-rule)] pt-6 first:border-t-0 first:pt-0 sm:grid-cols-2"
        >
          {render(row, index)}
          {/*
            Always offered, including on the last row.
            It used to appear only from the second row on, which meant an
            account added by mistake could not be taken back out: the way to
            reach one row is to remove the other, and then the wrong one is the
            only one left and it is stuck. Removing everything leaves the step
            empty, which is a real answer — the same one «no tengo de esto»
            gives — and the line above says what goes there.
          */}
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
        </div>
      ))}

      <Button type="button" variant="secondary" size="sm" className="self-start" onClick={onAdd}>
        {rows.length === 0 ? addFirstLabel : addLabel}
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

/**
 * The two typed day fields, as the list of anchor days the server stores.
 *
 * Only for `semimonthly`, and only the days that were actually filled in: a
 * salary marked twice-monthly with one day answered is still better described
 * by that one day than by an invented second one. Everything else sends
 * nothing, and nothing means «step the generic cadence», which is honest about
 * being an approximation.
 */
/**
 * Los dos montos escritos, como la lista que el servidor guarda.
 *
 * Solo cuando hay dos y los dos son números: una quincena con monto y la otra
 * en blanco no es un pago desigual, es un pago a medio escribir, y la base
 * rechaza una lista más corta que la de días precisamente para que nadie
 * decida en silencio cuál de las dos quincenas se queda sin monto.
 */
function anchorAmountsOf(row: {
  frequency?: Frequency | undefined;
  amount: string;
  anchorFirstAmount?: string | undefined;
  anchorSecondAmount?: string | undefined;
}): string[] | undefined {
  if (row.frequency !== 'semimonthly') return undefined;
  const typed = [row.anchorFirstAmount, row.anchorSecondAmount].map((value) =>
    (value ?? '').trim(),
  );
  if (typed.some((value) => value === '')) return undefined;
  return typed;
}

function anchorDaysOf(row: {
  frequency?: Frequency | undefined;
  anchorFirst?: string | undefined;
  anchorSecond?: string | undefined;
}): number[] | undefined {
  if (row.frequency !== 'semimonthly') return undefined;
  const days = [row.anchorFirst, row.anchorSecond]
    .map((value) => Number((value ?? '').trim()))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31);
  return days.length > 0 ? [...new Set(days)].sort((a, b) => a - b) : undefined;
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

/**
 * How many times a year each cadence is paid.
 *
 * The exact ones are exact: twice a month is twenty-four, a quarter is four.
 * Weekly, fortnightly and daily are counted per *year* rather than per month,
 * because a month is not four weeks — treating it as four undercounts a weekly
 * bill by a whole payment most months, and a household planning around that
 * number is short every fourth week for a reason nobody can see.
 */
const PAYMENTS_PER_YEAR: Record<Frequency, number> = {
  daily: 365,
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  quarterly: 4,
  annual: 1,
};

/**
 * What the commitments add up to, where they go, and how much of it is the
 * household's own to reconsider.
 *
 * Three questions, and the step could answer none of them. The total, because
 * the step asks for each payment alone and moves on. Where it goes, because a
 * household that can see «$1,260 en vivienda, $50 en suscripciones» can act on
 * it and one looking at a single figure cannot. And how much is not
 * indispensable — which is the only honest thing that can be said about what is
 * feasible to cut, because the household already said it, one checkbox at a
 * time. The product does not decide what anybody can live without.
 *
 * The total cannot be a plain sum. A rent of $630 charged twice a month and an
 * internet bill of $50 charged once are not $680 of anything: adding the
 * amounts as typed produces a number that looks careful and is wrong by the
 * size of a rent, in the direction that leaves a household short. So every
 * cadence is converted to a month first, and the conversion is stated.
 *
 * Nothing is stored from this. The position and the plan do their own
 * arithmetic on the saved rows; this is the confirmation that what is being
 * typed means what the person thinks it means.
 */
function CommitmentsTotal({
  rows,
  incomes,
  categories,
  currencySymbol,
  copy,
}: {
  readonly rows: readonly CommitmentRow[];
  readonly incomes: readonly { at: number; name: string }[];
  readonly categories: readonly { readonly slug: string; readonly name: string }[];
  readonly currencySymbol: string;
  readonly copy: (key: string) => string;
}) {
  const asNumber = (value: string) => Number(value.replace(/[^\d.]/g, '')) || 0;

  const counted = rows.filter((row) => row.name.trim() !== '' && row.amount.trim() !== '');
  if (counted.length === 0) return null;

  /**
   * A row's cost in a month, with the two fortnights added separately when
   * they differ. A payment of $700 on the 15th and $560 on the 30th is $1,260 a
   * month, and averaging it to «$630 twice» would be right about the month and
   * wrong about both fortnights.
   */
  const monthly = (row: CommitmentRow) => {
    const uneven = anchorAmountsOf(row);
    if (uneven) return uneven.reduce((total, value) => total + asNumber(value), 0);
    return (asNumber(row.amount) * PAYMENTS_PER_YEAR[row.frequency ?? 'monthly']) / 12;
  };

  const sum = (list: readonly CommitmentRow[]) =>
    list.reduce((total, row) => total + monthly(row), 0);

  const atSource = counted.filter((row) => row.isDeductedAtSource === true);
  const fromBalance = counted.filter((row) => row.isDeductedAtSource !== true);
  const optional = counted.filter((row) => !row.isEssential);

  // By rubro, biggest first: the list is only useful if the thing worth looking
  // at is at the top of it.
  const nameOf = (slug: string) =>
    categories.find((category) => category.slug === slug)?.name ?? copy('commitments.categoryNone');
  const byCategory = [
    ...counted
      .reduce((totals, row) => {
        const key = row.categorySlug ?? '';
        return totals.set(key, (totals.get(key) ?? 0) + monthly(row));
      }, new Map<string, number>())
      .entries(),
  ].sort((a, b) => b[1] - a[1]);

  // Only worth saying when a cadence was actually converted. On a list of
  // ordinary monthly bills the sentence would be noise.
  const converted = counted.some(
    (row) => (row.frequency ?? 'monthly') !== 'monthly' || anchorAmountsOf(row),
  );

  const money = (value: number) =>
    `${currencySymbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const line = (label: string, value: string, muted = false) => (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className={muted ? 'text-[color:var(--color-ink-tertiary)]' : ''}>{label}</span>
      <span className={`tabular ${muted ? 'text-[color:var(--color-ink-tertiary)]' : ''}`}>
        {value}
      </span>
    </div>
  );

  return (
    <section className="border-t border-[color:var(--color-rule)] pt-8">
      <h3 className="text-base font-medium">{copy('commitments.totalTitle')}</h3>
      <p className="mt-1 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {converted ? copy('commitments.totalConverted') : copy('commitments.totalDetail')}
      </p>

      <div className="mt-4 max-w-[46ch] text-sm text-[color:var(--color-ink-secondary)]">
        {byCategory.map(([slug, value]) => line(nameOf(slug), money(value)))}

        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-[color:var(--color-rule)] pt-3 text-base text-[color:var(--color-ink)]">
          <span className="font-medium">{copy('commitments.totalLabel')}</span>
          <span className="tabular font-medium">{money(sum(counted))}</span>
        </div>

        <div className="mt-4 border-t border-[color:var(--color-rule)] pt-3">
          {atSource.length > 0 &&
            line(
              copy('commitments.totalFromSalary').replace('{count}', String(atSource.length)),
              money(sum(atSource)),
              true,
            )}
          {atSource.length > 0 &&
            line(
              copy('commitments.totalYouPay').replace('{count}', String(fromBalance.length)),
              money(sum(fromBalance)),
              true,
            )}
          {/* Lo que el propio hogar marcó como prescindible. El producto no
              decide qué se puede cortar: repite lo que dijeron, sumado. */}
          {optional.length > 0 &&
            line(
              copy('commitments.totalOptional').replace('{count}', String(optional.length)),
              money(sum(optional)),
              true,
            )}
        </div>

        {optional.length === 0 && counted.length > 0 && (
          <p className="mt-3 text-xs text-[color:var(--color-ink-tertiary)]">
            {copy('commitments.totalAllEssential')}
          </p>
        )}

        {atSource.length > 0 && incomes.length > 0 && (
          <p className="mt-3 text-xs text-[color:var(--color-ink-tertiary)]">
            {copy('commitments.totalFromSalaryNote')}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * What the household holds today, added up in front of them.
 *
 * The step asks for balances one box at a time and then moves on, so nobody
 * ever saw the figure those boxes make — which is the only figure the step is
 * actually about. It is computed here in the browser, from what was just
 * typed, and stored nowhere: the position screen does this arithmetic properly
 * afterwards, from the saved rows, with the product's own exact money. This is
 * the confirmation that the numbers being typed mean what the person thinks
 * they mean, and it follows the same rule as the other read-only sums in this
 * form.
 *
 * Two things it refuses to do. It does not add across currencies — a holding
 * quoted in balboas and an account in dollars are reported on their own lines,
 * because the peg is a fact about Panama and not a property of addition. And
 * it does not quietly skip a holding nobody could price: it says how many are
 * still without one, so a total that is missing something says so.
 */
function FamilyFunds({
  accounts,
  holdings,
  currencySymbol,
  currencyCode,
  copy,
}: {
  readonly accounts: readonly AccountRow[];
  readonly holdings: readonly HoldingRow[];
  readonly currencySymbol: string;
  readonly currencyCode: string;
  readonly copy: (key: string) => string;
}) {
  const asNumber = (value: string) => Number(value.replace(/[^\d.]/g, '')) || 0;

  const counted = accounts.filter((row) => row.balance.trim() !== '');
  const inAccounts = counted.reduce((sum, row) => sum + asNumber(row.balance), 0);

  const priced = holdings.filter((row) => row.status === 'ok' && row.quoted);
  const unpriced = holdings.filter(
    (row) => row.symbol.trim() !== '' && (row.status !== 'ok' || !row.quoted),
  );

  // Grouped by the currency the market quoted them in, never merged into the
  // household's. Anything not in the household's currency gets its own line.
  const byCurrency = new Map<string, number>();
  for (const row of priced) {
    const quoted = row.quoted;
    if (!quoted) continue;
    const value = asNumber(row.quantity) * Number(quoted.price);
    if (!Number.isFinite(value)) continue;
    byCurrency.set(quoted.currency, (byCurrency.get(quoted.currency) ?? 0) + value);
  }

  const inHouseholdCurrency = byCurrency.get(currencyCode) ?? 0;
  const elsewhere = [...byCurrency.entries()].filter(([code]) => code !== currencyCode);

  if (counted.length === 0 && priced.length === 0 && unpriced.length === 0) return null;

  const money = (value: number) =>
    `${currencySymbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const line = (label: string, value: string, muted = false) => (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className={muted ? 'text-[color:var(--color-ink-tertiary)]' : ''}>{label}</span>
      <span className={`tabular ${muted ? 'text-[color:var(--color-ink-tertiary)]' : ''}`}>
        {value}
      </span>
    </div>
  );

  return (
    <section className="border-t border-[color:var(--color-rule)] pt-8">
      <h3 className="text-base font-medium">{copy('savings.totalTitle')}</h3>
      <p className="mt-1 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {copy('savings.totalDetail')}
      </p>

      <div className="mt-4 max-w-[46ch] text-sm text-[color:var(--color-ink-secondary)]">
        {counted.length > 0 &&
          line(
            copy('savings.totalAccounts').replace('{count}', String(counted.length)),
            money(inAccounts),
          )}

        {priced.length > 0 &&
          inHouseholdCurrency > 0 &&
          line(
            copy('savings.totalHoldings').replace('{count}', String(priced.length)),
            money(inHouseholdCurrency),
          )}

        {elsewhere.map(([code, value]) =>
          line(
            copy('savings.totalOtherCurrency').replace('{currency}', code),
            `${code} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            true,
          ),
        )}

        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-[color:var(--color-rule)] pt-3 text-base text-[color:var(--color-ink)]">
          <span className="font-medium">{copy('savings.totalLabel')}</span>
          <span className="tabular font-medium">{money(inAccounts + inHouseholdCurrency)}</span>
        </div>

        {unpriced.length > 0 && (
          <p className="mt-3 text-xs text-[color:var(--color-caution)]">
            {copy('savings.totalUnpriced').replace('{count}', String(unpriced.length))}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Shares, funds and coins — the part of a household's wealth that has a price
 * somebody else sets.
 *
 * The symbol is checked as it is typed, and that is the whole design. «BTC»,
 * «BTC-USD» and a typo are three different outcomes, and a form that accepts
 * all three silently produces a portfolio with a row nothing can value. So the
 * lookup runs on blur, the answer is shown back — the real name, the price,
 * the currency — and only a row that was actually found is sent as an answer.
 *
 * What is stored is the symbol and the quantity. The price is not: it belongs
 * to whoever quoted it and it will be different tomorrow. Storing it as if the
 * household had stated it is how a product ends up showing a figure from last
 * March as though it were today's.
 */
function HoldingsEditor({
  rows,
  setRows,
  people,
  copy,
}: {
  readonly rows: readonly HoldingRow[];
  /**
   * The setter itself, not a plain callback.
   *
   * The lookup finishes after the person has moved on and typed the quantity,
   * so writing the result against the rows this render captured would put the
   * old ones back — which is exactly what happened: filling in a quantity and
   * then leaving the symbol field silently blanked the quantity, and the
   * holding valued at zero. Every write below goes through the updater form,
   * against whatever the rows are when it lands.
   */
  readonly setRows: Dispatch<SetStateAction<HoldingRow[]>>;
  readonly people: readonly string[];
  readonly copy: (key: string) => string;
}) {
  const update = (at: number, changes: Partial<HoldingRow>) => {
    setRows((current) =>
      current.map((row, position) => (position === at ? { ...row, ...changes } : row)),
    );
  };

  const check = async (at: number, symbol: string) => {
    if (symbol.trim() === '') {
      update(at, { status: 'idle', quoted: undefined });
      return;
    }
    update(at, { status: 'checking' });
    const result = await lookupSymbol(symbol);
    if (result.ok && result.price && result.currency) {
      update(at, {
        status: 'ok',
        symbol: result.symbol ?? symbol,
        quoted: {
          name: result.name ?? symbol,
          price: result.price,
          currency: result.currency,
          kind: result.kind ?? 'other',
        },
      });
    } else {
      update(at, {
        status: result.reason === 'unavailable' ? 'unavailable' : 'unknown',
        quoted: undefined,
      });
    }
  };

  /**
   * A candidate picked from the list, then priced.
   *
   * The search says what the instrument *is*; only the quote endpoint says
   * what it costs, and only that call records the price for the portfolio to
   * read later. So choosing still runs the same lookup a typed symbol would —
   * the difference is that the symbol it looks up is now the provider's own,
   * not somebody's best guess at it.
   */
  const chose = async (at: number, candidate: SymbolCandidate) => {
    update(at, { symbol: candidate.symbol, label: candidate.name, status: 'checking' });
    await check(at, candidate.symbol);
  };

  return (
    <section className="border-t border-[color:var(--color-rule)] pt-8">
      <h3 className="text-base font-medium">{copy('holdings.title')}</h3>
      <p className="mt-1 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {copy('holdings.detail')}
      </p>

      <div className="mt-6 flex flex-col gap-6">
        {rows.map((row, at) => (
          <div
            key={at}
            className="grid gap-4 border-l border-[color:var(--color-rule)] pl-4 sm:grid-cols-2"
          >
            <Field label={copy('holdings.symbol')} hint={copy('holdings.symbolHint')}>
              {({ id, describedBy }) => (
                <SymbolSearch
                  id={id}
                  describedBy={describedBy}
                  value={row.symbol}
                  copy={copy}
                  onType={(value) => {
                    update(at, { symbol: value, status: 'idle', quoted: undefined });
                  }}
                  onChoose={(candidate) => {
                    void chose(at, candidate);
                  }}
                  onCommit={(value) => {
                    // Already priced, and priced from this exact symbol: the
                    // list was used, and asking the provider twice for the
                    // same answer is only a second way for it to fail.
                    if (row.status === 'ok' && row.symbol === value) return;
                    void check(at, value);
                  }}
                />
              )}
            </Field>

            <Field label={copy('holdings.quantity')} hint={copy('holdings.quantityHint')}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  numeric
                  inputMode="decimal"
                  value={row.quantity}
                  placeholder="0"
                  aria-describedby={describedBy}
                  onChange={(event) => {
                    update(at, { quantity: event.target.value });
                  }}
                />
              )}
            </Field>

            {people.length > 0 && (
              <Field label={copy('holdings.holder')}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={row.personName}
                    onChange={(event) => {
                      update(at, { personName: event.target.value });
                    }}
                  >
                    <option value="">{copy('holdings.holderShared')}</option>
                    {people.map((person) => (
                      <option key={person} value={person}>
                        {person}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}

            <div className="sm:col-span-2">
              {row.status === 'checking' && (
                <p className="text-xs text-[color:var(--color-ink-tertiary)]">
                  {copy('holdings.checking')}
                </p>
              )}
              {row.status === 'ok' && row.quoted && (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[color:var(--color-ink-secondary)]">
                  <span
                    aria-hidden
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-(--radius-xs) bg-[color:var(--color-ground-sunk)] text-[color:var(--color-ink-secondary)]"
                  >
                    <KindIcon kind={row.quoted.kind} />
                  </span>
                  <Status tone="positive">{row.quoted.name}</Status>
                  <span className="text-[color:var(--color-ink-tertiary)]">
                    {copy(`holdings.kind.${row.quoted.kind}`)}
                  </span>
                  <span className="tabular">
                    {copy('holdings.quoted')
                      .replace(
                        '{price}',
                        `${row.quoted.currency} ${readablePrice(row.quoted.price)}`,
                      )
                      .replace(
                        '{value}',
                        holdingValue(row.quantity, row.quoted.price, row.quoted.currency),
                      )}
                  </span>
                </p>
              )}
              {row.status === 'unknown' && (
                <p className="text-xs text-[color:var(--color-negative)]">
                  {copy('holdings.unknown')}
                </p>
              )}
              {row.status === 'unavailable' && (
                <p className="text-xs text-[color:var(--color-caution)]">
                  {copy('holdings.unavailable')}
                </p>
              )}
            </div>

            <div className="sm:col-span-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRows((current) => current.filter((_, position) => position !== at));
                }}
              >
                {copy('remove')}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-4"
        onClick={() => {
          setRows((current) => [
            ...current,
            { symbol: '', label: '', quantity: '', personName: '', status: 'idle' },
          ]);
        }}
      >
        {copy('holdings.add')}
      </Button>
    </section>
  );
}

/**
 * Quantity times price, for the line under the field.
 *
 * Read-only reassurance while typing, so it is done here rather than round
 * tripping. Nothing is stored from it: the portfolio screen values the holding
 * from the recorded quote with the product's own exact arithmetic, and this is
 * only the confirmation that the number being typed means what the person
 * thinks it means.
 */
/**
 * A quote as a person reads it.
 *
 * Stored with eight decimals because a coin can trade below a cent; shown with
 * as few as carry meaning, and never fewer than two, because «USD
 * 316.22000000» is a database column pretending to be a price.
 */
function readablePrice(price: string): string {
  const trimmed = price.includes('.') ? price.replace(/0+$/, '').replace(/\.$/, '') : price;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return `${Number(whole).toLocaleString('en-US')}.${fraction.padEnd(2, '0')}`;
}

function holdingValue(quantity: string, price: string, currency: string): string {
  const amount = Number(quantity.replace(/[^\d.]/g, '')) * Number(price);
  if (!Number.isFinite(amount)) return '—';
  return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
