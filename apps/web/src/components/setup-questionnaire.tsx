'use client';

import { Button, Field, Input, Problem, Select, Status } from '@app/ui';
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

import { LANDING_DRAFT_KEY, type LandingDraft } from '@/components/marketing/try-it';
import { CategoryIcon } from '@/components/category-icon';
import { KindIcon, SymbolSearch } from '@/components/symbol-search';
import { lookupSymbol, type SymbolCandidate } from '@/server/holdings-actions';
import { estimatePanamaPayroll } from '@/server/payroll-actions';
import { discardSetupDraft, saveSetupDraft } from '@/server/setup-draft-actions';
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

/** El cuestionario a medio contestar, tal como se guarda en el navegador. */
interface SetupDraft {
  people: PersonRow[];
  bufferMinimum: string;
  incomes: IncomeRow[];
  receivables: ReceivableRow[];
  accounts: AccountRow[];
  commitments: CommitmentRow[];
  debts: DebtRow[];
  holdings: HoldingRow[];
  goals: GoalRow[];
  index: number;
}

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
  /**
   * Lo que dice la ficha antes de los descuentos, y las líneas copiadas de ella.
   *
   * `amount` sigue siendo lo que llega, siempre. Cuando alguien declara el
   * bruto y las líneas, lo que llega es la resta: guardar las dos cifras a mano
   * sería guardar una contradicción esperando a que alguien edite una sola.
   *
   * Ninguna tasa oficial se aplica aquí. Son cifras que alguien leyó de su
   * propio recibo — el producto hace la resta y no afirma nada sobre lo que la
   * ley dice que deberían ser.
   */
  grossAmount?: string | undefined;
  deductions?: readonly Deduction[] | undefined;
  /**
   * Qué significa el monto de arriba: lo que llega, o el bruto del contrato.
   *
   * Antes había dos casillas de dinero para el mismo sueldo —«Monto» y
   * «Salario bruto»— y la persona tenía que mantenerlas de acuerdo. Es la misma
   * cifra preguntada dos veces; lo que faltaba no era otro campo sino decir cuál
   * de las dos cosas es la que se escribió.
   */
  amountIsGross?: boolean | undefined;
}
/**
 * Una línea del recibo: qué te quitan, cuánto, y en qué pagos.
 *
 * `appliesToAnchors` vacío significa «en todos», que es el caso corriente y lo
 * único que existía antes: el seguro social sale de cada pago porque es un
 * porcentaje del sueldo del período. La cuota de la cooperativa sale una vez al
 * mes, y una vez al mes es una de las dos quincenas — restarla a medias en cada
 * una da bien el mes y mal las dos mitades, que es justo lo que la vista por
 * quincena existe para no hacer.
 */
interface Deduction {
  label: string;
  amount: string;
  appliesToAnchors?: readonly number[] | undefined;
  /**
   * La regla que la calculó, cuando no la escribió una persona.
   *
   * Es lo que decide si la línea pregunta en qué quincena sale. El seguro
   * social no pregunta: es un porcentaje del sueldo del período y sale de cada
   * pago, y poner el selector ahí sería ofrecer una decisión que no existe.
   */
  ruleKey?: string | undefined;
}

/**
 * Un cobro que la familia espera, con su fecha y su origen.
 *
 * No es un ingreso recurrente: no se repite, tiene fecha propia, y el plan no
 * lo reparte como dinero disponible. Está para poder perseguirlo — saber cuánto
 * viene, de quién y para cuándo.
 */
interface ReceivableRow {
  id?: string;
  name: string;
  source: string;
  amount: string;
  /** `YYYY-MM-DD`, o vacío cuando no se sabe. No se inventa una fecha. */
  expectedOn: string;
  confidence: 'confirmed' | 'estimated';
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
  readonly receivables?: readonly ReceivableRow[] | undefined;
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
  readonly categories: readonly {
    readonly slug: string;
    readonly name: string;
    readonly icon?: string | null | undefined;
  }[];
  readonly initial?: SetupInitial;
  /**
   * Las cifras con las que se explica una planilla, leídas del conjunto de
   * reglas en el servidor.
   *
   * Llegan como propiedad y no se piden desde el cliente a propósito: son datos
   * que ya existen cuando la página se arma, y pedirlos después obligaría a esta
   * pantalla a tener un estado de carga y otro de error para dibujar una
   * leyenda. `undefined` cuando la jurisdicción del hogar no tiene conjunto: la
   * leyenda no se dibuja y no se inventa ninguna tasa.
   */
  readonly payroll?: PayrollLegendData | undefined;
  /**
   * El hogar al que pertenece lo que se está contestando.
   *
   * Solo se usa para nombrar el borrador local: dos hogares en el mismo
   * navegador —una contadora que administra el suyo y el de un cliente— no
   * pueden compartir una única llave sin pisarse las respuestas.
   */
  /**
   * El cuestionario a medio contestar del hogar, si alguien lo dejó empezado.
   *
   * Llega leído del servidor y no del navegador: quien arranca la descripción
   * de la casa suele ser quien tiene tiempo esa tarde, y quien sabe el saldo de
   * la cuenta es la otra persona. Trae quién lo dejó así, porque «lo empezó
   * Ana» es la diferencia entre retomar y sospechar que estos números salieron
   * de ninguna parte.
   */
  readonly draft?:
    { readonly answers: unknown; readonly step: number; readonly by: string | null } | undefined;
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
  payroll,
  draft,
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
    // El monto se deriva del bruto menos los descuentos en cuanto los dos
    // existen, también al cargar. Sin esto, una fila guardada mostraba «Monto
    // $1.400» arriba y «Te llega $1.200» abajo: dos cifras en la misma pantalla
    // contradiciéndose, que es peor que cualquiera de las dos sola.
    start(initial?.incomes, {
      name: '',
      amount: '',
      frequency: 'monthly',
      isApproximate: false,
    }).map((row) => {
      // Una fila guardada con bruto se reabre en modo bruto, con el bruto en la
      // única casilla que hay. Sin bruto, el monto es lo que llega y no hay
      // nada que convertir.
      const declaredGross = (row.grossAmount ?? '').trim();
      return declaredGross === ''
        ? { ...row, amountIsGross: false }
        : { ...row, amountIsGross: true, amount: declaredGross };
    }),
  );
  const [receivableRows, setReceivableRows] = useState<ReceivableRow[]>(
    initial?.receivables && initial.receivables.length > 0
      ? initial.receivables.map((row) => ({ ...row }))
      : [],
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

  /**
   * Lo contestado hasta aquí, guardado en el navegador al avanzar de paso.
   *
   * Seis pasos son muchos para perderlos porque sonó el teléfono. Hasta ahora,
   * salir de la página antes de la última pantalla borraba todo: quien volvía
   * tenía que volver a escribir su casa, sus ingresos, sus cuentas y sus pagos
   * desde cero, y la segunda vez casi nadie llega al final.
   *
   * En el navegador y no en el servidor porque son respuestas a medias: la mitad
   * de un cuestionario no es un hogar descrito, y guardar en la base un ingreso
   * sin nombre o un pago sin monto sería guardar algo que ninguna pantalla puede
   * leer. Lo que llega a la base sigue siendo lo que se envía al final, entero y
   * en una transacción.
   *
   * Se borra al terminar. Un borrador que sobrevive al envío reaparece encima de
   * lo que ya está guardado, que es la forma más rápida de resucitar una cifra
   * que alguien acababa de corregir.
   */
  const [resumed, setResumed] = useState(false);

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

  /**
   * Restaurar lo que quedó a medias, una vez, antes de tocar nada.
   *
   * Solo en la primera vuelta. En una revisión, lo que manda es lo que la base
   * tiene guardado: un borrador viejo del navegador escrito encima de respuestas
   * ya confirmadas sería deshacer en silencio la corrección que la persona vino
   * a hacer.
   */
  useEffect(() => {
    if (review || !draft) return;
    const saved = draft.answers as Partial<SetupDraft> | null;
    if (!saved || typeof saved !== 'object') return;

    if (saved.people) setPeople(saved.people);
    if (saved.bufferMinimum !== undefined) setBufferMinimum(saved.bufferMinimum);
    if (saved.incomes) setIncomes(saved.incomes);
    if (saved.receivables) setReceivableRows(saved.receivables);
    if (saved.accounts) setAccountRows(saved.accounts);
    if (saved.commitments) setCommitments(saved.commitments);
    if (saved.debts) setDebtRows(saved.debts);
    if (saved.holdings) setHoldingRows(saved.holdings);
    if (saved.goals) setGoalRows(saved.goals);
    // Al paso donde se quedó, no al primero: volver y tener que pasar cinco
    // pantallas ya contestadas es casi tan molesto como volver a escribirlas.
    if (draft.step >= 0 && draft.step < STEPS.length) setIndex(draft.step);
    setResumed(true);
    // Corre una vez, al montar: el borrador es lo que había cuando la página se
    // armó, y volver a aplicarlo después pisaría lo que se acaba de escribir.
    // `draft` y `review` llegan como propiedades y no cambian mientras la
    // pantalla vive, así que declararlos no la hace correr otra vez.
  }, [draft, review]);

  /**
   * Y guardarlo, con retraso, cada vez que algo cambia.
   *
   * Al avanzar de paso sobre todo —que es lo que se pidió— pero también
   * mientras se escribe: quien cierra la pestaña a mitad de la pantalla de
   * ingresos no perdió menos que quien la cierra al terminarla.
   */
  useEffect(() => {
    if (review) return;
    const timer = setTimeout(() => {
      const snapshot: SetupDraft = {
        people,
        bufferMinimum,
        incomes,
        receivables: receivableRows,
        accounts: accountRows,
        commitments,
        debts: debtRows,
        holdings: holdingRows,
        goals: goalRows,
        index,
      };
      // Falla en silencio a propósito. Un borrador que no se pudo guardar es una
      // comodidad perdida, no un error que interrumpa a alguien a mitad de una
      // pantalla: lo escrito sigue entero en memoria y se envía igual.
      void saveSetupDraft(JSON.stringify(snapshot), index).catch(() => undefined);
    }, 800);
    return () => {
      clearTimeout(timer);
    };
  }, [
    review,
    people,
    bufferMinimum,
    incomes,
    receivableRows,
    accountRows,
    commitments,
    debtRows,
    holdingRows,
    goalRows,
    index,
  ]);

  /**
   * Y se borra en cuanto lo contestado deja de estar a medias.
   *
   * Un borrador que sobrevive al envío vuelve a aparecer encima de lo que ya
   * está guardado la próxima vez que alguien abra esta pantalla, que es la
   * forma más rápida de resucitar una cifra recién corregida.
   */
  useEffect(() => {
    if (!state.ok) return;
    void discardSetupDraft().catch(() => undefined);
  }, [state.ok]);

  /** Como se escribe una cifra en esta pantalla: símbolo, miles y dos decimales. */
  const money = (value: number) =>
    `${currencySymbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const amountOf = (value: string) => Number((value ?? '').replace(/[^\d.]/g, '')) || 0;

  /**
   * Todo llevado al mes, que es la unidad en la que una casa se piensa.
   *
   * Una quincena de 800 y un pago anual de 1.200 no se pueden sumar como
   * están. Al mes son 1.600 y 100, y esa es la única suma que responde «¿me
   * alcanza?». Los tramos anuales del impuesto son otra cosa y se calculan
   * aparte: aquí solo se compara dinero que entra con dinero que sale.
   */
  const perMonth = (amount: string, frequency: Frequency) =>
    (amountOf(amount) * PAYMENTS_PER_YEAR[frequency]) / 12;

  const incomePerMonth = incomes
    .filter((row) => row.name.trim() !== '')
    .reduce((total, row) => total + perMonth(arrivingAmount(row), row.frequency), 0);

  /**
   * Qué le falta a una fila, con las mismas reglas que usa el envío.
   *
   * El formulario descarta al guardar toda fila sin nombre o sin monto. Antes
   * lo hacía en silencio: la persona veía su pago en pantalla, terminaba, y el
   * plan no lo contaba — sin que nada le dijera por qué. La comprobación es la
   * misma; lo que cambia es que ahora se dice en el momento y no se pierde.
   */
  const needs = <T,>(row: T, fields: readonly { key: keyof T; label: string }[]): string[] =>
    fields
      .filter((field) => String(row[field.key] ?? '').trim() === '')
      .map((field) => field.label);

  const untouched = <T,>(row: T, keys: readonly (keyof T)[]): boolean =>
    keys.every((key) => String(row[key] ?? '').trim() === '');

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
      .map((row) => ({
        ...row,
        amount: arrivingAmount(row),
        // El bruto se deriva de lo que la persona dijo que escribió, en vez de
        // ser un segundo campo que hay que mantener de acuerdo con el primero.
        ...(row.amountIsGross === true ? { grossAmount: row.amount } : { grossAmount: undefined }),
        anchorDays: anchorDaysOf(row),
        // Solo las líneas escritas enteras, y solo si el monto es un bruto: una
        // deducción sin bruto del que salir no describe nada. Quedan en la
        // pantalla por si la persona vuelve a cambiar de idea, pero no se
        // guardan colgando de un sueldo que ya dijo que es neto.
        deductions:
          row.amountIsGross === true
            ? (row.deductions ?? []).filter(
                (line) => line.label.trim() !== '' && line.amount.trim() !== '',
              )
            : [],
      })),
    // Lo que se espera cobrar. Sin nombre o sin monto no es un cobro: es una
    // fila a medio llenar, y guardarla sería guardar una promesa vacía.
    receivables: receivableRows
      .filter((row) => row.name.trim() !== '' && row.amount.trim() !== '')
      .map((row) => ({
        ...row,
        source: row.source.trim(),
        ...(row.expectedOn.trim() === '' ? { expectedOn: undefined } : {}),
      })),
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

      {/*
        Retomado, y con la puerta de salida al lado.

        Decir «seguimos donde lo dejaste» sin ofrecer empezar de nuevo deja
        encerrado a quien está probando, o a quien contestó por otra persona y
        ahora quiere contestar por sí mismo.
      */}
      {resumed && (
        <Status tone="neutral">
          <span className="flex flex-wrap items-center gap-3">
            <span>
              {draft?.by
                ? copy('draft.resumedBy').replace('{name}', draft.by)
                : copy('draft.resumed')}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void discardSetupDraft()
                  .catch(() => undefined)
                  .finally(() => {
                    window.location.reload();
                  });
              }}
            >
              {copy('draft.discard')}
            </Button>
          </span>
        </Status>
      )}

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
          itemLabel={copy('household.name')}
          missing={(row: PersonRow) => needs(row, [{ key: 'name', label: copy('household.name') }])}
          isBlank={(row: PersonRow) => untouched(row, ['name'])}
          summarize={(row: PersonRow) => ({
            title: row.name,
            detail: copy(`household.relationships.${row.relationship}`),
          })}
          removeLabel={copy('remove')}
          copy={copy}
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
          itemLabel={copy('income.name')}
          missing={(row: IncomeRow) =>
            needs(row, [
              { key: 'name', label: copy('income.name') },
              { key: 'amount', label: copy('amount') },
            ])
          }
          isBlank={(row: IncomeRow) => untouched(row, ['name', 'amount'])}
          summarize={(row: IncomeRow) => ({
            title: row.name,
            detail: `${money(amountOf(arrivingAmount(row)))} ${copy(`income.per.${row.frequency}`)}`,
          })}
          removeLabel={copy('remove')}
          copy={copy}
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
                /*
                  El período, dicho en la etiqueta.

                  «Monto: 3.000» junto a «Cada cuánto: Quincenal» pide que la
                  persona una las dos cosas en su cabeza, y quien tiene un
                  contrato mensual no las une: escribe el sueldo del mes en una
                  casilla que significa el de la quincena. Decirlo dos veces es
                  redundante y es exactamente la redundancia que evita duplicar
                  un sueldo.
                */
                label={`${row.amountIsGross === true ? copy('income.grossLine') : copy('amount')} ${copy(`income.per.${row.frequency}`)}`}
                symbol={currencySymbol}
                value={row.amount}
                onChange={(value) => {
                  setIncomes(patch(incomes, at, { amount: value }));
                }}
              />
              {/*
                La nota solo donde se confunden.

                «Quincenal» y «cada 14 días» suenan a lo mismo y no lo son: 24
                pagos al año contra 26. Dos pagos de diferencia mueven el sueldo
                anual y con él el tramo de renta, así que elegir mal no es un
                detalle de calendario. La explicación aparece cuando una de las
                dos está elegida; el resto del tiempo sería ruido bajo un menú
                que nadie está dudando.
              */}
              <Field
                label={copy('income.frequency')}
                {...(row.frequency === 'semimonthly' || row.frequency === 'biweekly'
                  ? { hint: copy('income.frequencyHint') }
                  : {})}
              >
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    value={row.frequency}
                    aria-describedby={describedBy}
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

              {/*
                Qué es el número de arriba, preguntado una vez.

                No es una preferencia ni un modo avanzado: es la única pregunta
                que hacía falta para no pedir la misma cifra dos veces. Por
                defecto, lo que llega — que es lo que la mayoría sabe de memoria
                y lo único que el plan necesita para funcionar.
              */}
              <AmountMeaning
                isGross={row.amountIsGross === true}
                copy={copy}
                onChange={(isGross) => {
                  setIncomes(patch(incomes, at, { amountIsGross: isGross }));
                }}
              />

              {row.amountIsGross === true && (
                <IncomeDeductions
                  row={row}
                  currencySymbol={currencySymbol}
                  copy={copy}
                  payroll={payroll}
                  onChange={(change) => {
                    setIncomes(patch(incomes, at, change));
                  }}
                />
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

      {/*
        Lo que entra al mes, sumado delante de quien lo escribe.

        Dos sueldos con cadencias distintas no se suman en la cabeza: una
        quincena de 800 y un mensual de 1.000 son 2.600 al mes, y nadie hace esa
        cuenta mientras teclea. Es también lo que delata el error de tipeo — un
        sueldo con un cero de más no se ve raro en su casilla y sí en el total.
      */}
      {step === 'income' && incomePerMonth > 0 && (
        <StepTotals
          lines={[
            ...incomes
              .filter((row) => row.name.trim() !== '' && row.amount.trim() !== '')
              .map((row) => ({
                label: row.name,
                value: money(perMonth(arrivingAmount(row), row.frequency)),
                indent: true,
              })),
            {
              label: copy('income.totalLabel'),
              value: money(incomePerMonth),
              tone: 'strong' as const,
            },
          ]}
          note={copy('income.totalNote')}
        />
      )}

      {/*
        Y lo que está por cobrar, que no es un sueldo.

        Una factura del mes que viene, un préstamo que devuelven, el décimo
        tercer mes. Va en este paso porque es dinero que entra, y va aparte
        porque **el plan no lo reparte**: un cobro tratado como cierto es la
        cifra optimista que arruina un presupuesto —el cliente paga tarde, el
        hermano no paga, y la casa ya gastó contra eso—. Se guarda para poder
        perseguirlo, y la nota del pie lo dice sin rodeos.
      */}
      {step === 'income' && (
        <section className="border-t border-[color:var(--color-rule)] pt-8">
          <h3 className="text-base font-medium">{copy('receivables.title')}</h3>
          <p className="mt-1 mb-4 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {copy('receivables.detail')}
          </p>

          <RowEditor
            rows={receivableRows}
            addLabel={copy('receivables.add')}
            addFirstLabel={copy('receivables.addFirst')}
            removeLabel={copy('remove')}
            copy={copy}
            emptyHint={copy('receivables.empty')}
            itemLabel={copy('receivables.name')}
            missing={(row: ReceivableRow) =>
              needs(row, [
                { key: 'name', label: copy('receivables.name') },
                { key: 'amount', label: copy('amount') },
              ])
            }
            isBlank={(row: ReceivableRow) => untouched(row, ['name', 'amount', 'source'])}
            summarize={(row: ReceivableRow) => ({
              title: row.name,
              detail: money(amountOf(row.amount)),
            })}
            onAdd={() => {
              setReceivableRows([
                ...receivableRows,
                { name: '', source: '', amount: '', expectedOn: '', confidence: 'estimated' },
              ]);
            }}
            onRemove={(at) => {
              setReceivableRows(receivableRows.filter((_, position) => position !== at));
            }}
            render={(row, at) => (
              <>
                <Field label={copy('receivables.name')} className="sm:col-span-2">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={row.name}
                      placeholder={copy('receivables.namePlaceholder')}
                      onChange={(event) => {
                        setReceivableRows(patch(receivableRows, at, { name: event.target.value }));
                      }}
                    />
                  )}
                </Field>
                <MoneyField
                  label={copy('amount')}
                  symbol={currencySymbol}
                  value={row.amount}
                  onChange={(value) => {
                    setReceivableRows(patch(receivableRows, at, { amount: value }));
                  }}
                />
                <Field label={copy('receivables.source')} hint={copy('receivables.sourceHint')}>
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      value={row.source}
                      aria-describedby={describedBy}
                      placeholder={copy('receivables.sourcePlaceholder')}
                      onChange={(event) => {
                        setReceivableRows(
                          patch(receivableRows, at, { source: event.target.value }),
                        );
                      }}
                    />
                  )}
                </Field>
                <Field
                  label={copy('receivables.expectedOn')}
                  hint={copy('receivables.expectedOnHint')}
                >
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      type="date"
                      value={row.expectedOn}
                      aria-describedby={describedBy}
                      onChange={(event) => {
                        setReceivableRows(
                          patch(receivableRows, at, { expectedOn: event.target.value }),
                        );
                      }}
                    />
                  )}
                </Field>
                <Field
                  label={copy('receivables.confidence')}
                  hint={copy('receivables.confidenceHint')}
                >
                  {({ id, describedBy }) => (
                    <Select
                      id={id}
                      aria-describedby={describedBy}
                      value={row.confidence}
                      onChange={(event) => {
                        setReceivableRows(
                          patch(receivableRows, at, {
                            confidence: event.target.value as ReceivableRow['confidence'],
                          }),
                        );
                      }}
                    >
                      <option value="confirmed">{copy('receivables.confirmed')}</option>
                      <option value="estimated">{copy('receivables.estimated')}</option>
                    </Select>
                  )}
                </Field>
              </>
            )}
          />

          {receivableRows.some((row) => row.name.trim() !== '' && row.amount.trim() !== '') && (
            <StepTotals
              lines={[
                ...receivableRows
                  .filter((row) => row.name.trim() !== '' && row.amount.trim() !== '')
                  .map((row) => ({
                    label: `${row.name}${row.expectedOn ? ` · ${row.expectedOn}` : ''}`,
                    value: money(amountOf(row.amount)),
                    indent: true,
                  })),
                {
                  label: copy('receivables.totalLabel'),
                  value: money(
                    receivableRows.reduce((total, row) => total + amountOf(row.amount), 0),
                  ),
                  tone: 'strong' as const,
                },
              ]}
              note={copy('receivables.totalNote')}
            />
          )}
        </section>
      )}

      {step === 'savings' && (
        <div className="flex flex-col gap-10">
          <RowEditor
            rows={accountRows}
            addLabel={copy('savings.add')}
            itemLabel={copy('savings.name')}
            missing={(row: AccountRow) =>
              needs(row, [
                { key: 'name', label: copy('savings.name') },
                { key: 'balance', label: copy('savings.balance') },
              ])
            }
            isBlank={(row: AccountRow) => untouched(row, ['name', 'balance'])}
            summarize={(row: AccountRow) => ({
              title: row.name,
              detail: money(amountOf(row.balance)),
            })}
            removeLabel={copy('remove')}
            copy={copy}
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
          itemLabel={copy('commitments.name')}
          missing={(row: CommitmentRow) =>
            needs(row, [
              { key: 'name', label: copy('commitments.name') },
              { key: 'amount', label: copy('amount') },
            ])
          }
          isBlank={(row: CommitmentRow) => untouched(row, ['name', 'amount'])}
          summarize={(row: CommitmentRow) => ({
            title: row.name,
            detail: money(amountOf(row.amount)),
            icon: (
              <CategoryIcon
                name={categories.find((one) => one.slug === row.categorySlug)?.icon ?? null}
              />
            ),
          })}
          removeLabel={copy('remove')}
          copy={copy}
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
                  <div className="relative">
                    {/*
                      El dibujo del rubro elegido, delante de su nombre.

                      Una lista desplegable nativa no puede llevar dibujos
                      dentro, y cambiarla por un control propio costaría el
                      teclado, el lector de pantalla y el selector del teléfono
                      —que en una lista de veintiocho es justo lo que la hace
                      usable—. Así que el icono va donde sí cabe: al lado, sobre
                      el elegido, igual que el símbolo de moneda en un monto.
                    */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[color:var(--color-ink-secondary)]"
                    >
                      <CategoryIcon
                        name={categories.find((one) => one.slug === row.categorySlug)?.icon ?? null}
                      />
                    </span>
                    <Select
                      id={id}
                      aria-describedby={describedBy}
                      className="pl-9"
                      value={row.categorySlug ?? ''}
                      onChange={(event) => {
                        setCommitments(
                          patch(commitments, at, { categorySlug: event.target.value }),
                        );
                      }}
                    >
                      <option value="">{copy('commitments.categoryNone')}</option>
                      {categories.map((category) => (
                        <option key={category.slug} value={category.slug}>
                          {category.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </Field>

              {/*
                Y los que casi todo el mundo usa, a un toque.

                Ocho de veintiocho cubren la mayoría de los pagos de una casa.
                Ponerlos delante evita abrir una lista larga para elegir
                «Vivienda», y el resto sigue estando en la lista para quien
                necesita «Servicios profesionales».
              */}
              <CategoryShortcuts
                categories={categories}
                chosen={row.categorySlug ?? ''}
                onChoose={(slug) => {
                  setCommitments(patch(commitments, at, { categorySlug: slug }));
                }}
              />

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
          incomePerMonth={incomePerMonth}
          categories={categories}
          currencySymbol={currencySymbol}
          copy={copy}
        />
      )}

      {step === 'debts' && (
        <RowEditor
          rows={debtRows}
          addLabel={copy('debts.add')}
          itemLabel={copy('debts.name')}
          missing={(row: DebtRow) =>
            needs(row, [
              { key: 'name', label: copy('debts.name') },
              { key: 'balance', label: copy('debts.balance') },
            ])
          }
          isBlank={(row: DebtRow) => untouched(row, ['name', 'balance'])}
          summarize={(row: DebtRow) => ({
            title: row.name,
            detail: money(amountOf(row.balance)),
          })}
          removeLabel={copy('remove')}
          copy={copy}
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
            itemLabel={copy('goals.name')}
            missing={(row: GoalRow) =>
              needs(row, [
                { key: 'name', label: copy('goals.name') },
                { key: 'targetAmount', label: copy('goals.amount') },
              ])
            }
            isBlank={(row: GoalRow) => untouched(row, ['name', 'targetAmount'])}
            summarize={(row: GoalRow) => ({
              title: row.name,
              detail: money(amountOf(row.targetAmount)),
            })}
            removeLabel={copy('remove')}
            copy={copy}
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

/**
 * Un ítem a la vez, y al terminar, «¿otro?».
 *
 * Con todos los formularios abiertos, cada ítem es una tira de campos idéntica
 * a la anterior y la pantalla se vuelve una sola columna que cansa antes de la
 * mitad: nadie sabe dónde termina uno y empieza el otro, ni cuántos lleva. La
 * repetición no se arregla decorando la repetición.
 *
 * Así que solo está abierto el que se está llenando. Los ya contestados quedan
 * como un renglón que dice lo que hay que saber de ellos —nombre, cifra,
 * rubro— y se abren de nuevo con un clic si hay algo que corregir. Al terminar
 * uno, la pregunta que sigue está en el botón: «guardar y agregar otro» o
 * «listo».
 *
 * Nada se pliega ni se despliega por gusto: el renglón resumido no esconde
 * información, la dice más corta. Abrirlo es para editarlo, que es la única
 * razón por la que alguien querría volver a verlo entero.
 */
function RowEditor<T>({
  rows,
  addLabel,
  addFirstLabel,
  removeLabel,
  emptyHint,
  onAdd,
  onRemove,
  render,
  summarize,
  itemLabel,
  missing,
  isBlank,
  copy,
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
  /**
   * Cómo se llama y cuánto vale una fila, para su encabezado y su renglón.
   *
   * El nombre que la persona escribió es el único título honesto que hay:
   * mientras no escriba ninguno, la tarjeta se numera.
   */
  readonly summarize?: (
    row: T,
    index: number,
  ) => { title: string; detail?: string; icon?: ReactNode };
  /** «Cuenta», «Pago», «Deuda» — para numerar una tarjeta que todavía no tiene nombre. */
  readonly itemLabel?: string;
  /**
   * Qué le falta a esta fila para poder darla por terminada.
   *
   * Devuelve los nombres de los campos que faltan, ya traducidos, porque el
   * aviso tiene que decir *cuál* falta: «revisa los campos» obliga a buscar, y
   * en una tarjeta de diez campos buscar es media pantalla.
   *
   * Sin esta función la fila nunca está incompleta, que es el comportamiento
   * que tenían todas antes de que esto existiera.
   */
  readonly missing?: (row: T) => readonly string[];
  /** Si la fila está intacta: sin nada escrito no hay nada que reclamar. */
  readonly isBlank?: (row: T) => boolean;
  readonly copy: (key: string) => string;
}) {
  /**
   * Cuál está abierto. El último, al llegar: es el que se acaba de agregar.
   *
   * `null` significa que no hay ninguno en edición y la pantalla ofrece agregar
   * el siguiente — el estado natural de quien ya terminó con esta lista.
   */
  const [open, setOpen] = useState<number | null>(rows.length > 0 ? rows.length - 1 : null);
  /**
   * Lo que falta, cuando alguien intentó cerrar una fila a medio llenar.
   *
   * Aparece al intentar cerrarla y no antes: reclamar un monto vacío mientras
   * la persona todavía está escribiendo el nombre es reclamar por algo que
   * estaba a punto de hacer.
   */
  const [problem, setProblem] = useState<readonly string[]>([]);

  const titleOf = (row: T, index: number) => {
    const summary = summarize?.(row, index);
    return summary?.title.trim() ? summary.title : `${itemLabel ?? ''} ${String(index + 1)}`.trim();
  };

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 && (
        <p className="max-w-[56ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {emptyHint}
        </p>
      )}

      {rows.map((row, index) => {
        const summary = summarize?.(row, index);
        const title = titleOf(row, index);

        // Terminado: un renglón que dice lo que hay que saber, no un formulario
        // más. Es lo que convierte una lista de ocho pagos en una lista y no en
        // ocho pantallas iguales.
        if (open !== index) {
          return (
            <div
              key={index}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-(--radius-md) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-4 py-3"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-[color:var(--color-ink)]">
                {summary?.icon}
                <span className="truncate font-medium">{title}</span>
              </span>
              {summary?.detail && (
                <span className="tabular text-sm text-[color:var(--color-ink-secondary)]">
                  {summary.detail}
                </span>
              )}
              <span className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`${copy('edit')} — ${title}`}
                  onClick={() => {
                    setProblem([]);
                    setOpen(index);
                  }}
                >
                  {copy('edit')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`${removeLabel} — ${title}`}
                  onClick={() => {
                    onRemove(index);
                    // El abierto se corre solo cuando lo que se quita está
                    // antes que él; si no, la pantalla saltaría de ítem sola.
                    setOpen((current) =>
                      current === null || current <= index ? current : current - 1,
                    );
                  }}
                >
                  {removeLabel}
                </Button>
              </span>
            </div>
          );
        }

        return (
          <section
            // Rows are positional and have no identity of their own until they
            // are saved; the index is the only stable handle there is.
            key={index}
            className="overflow-hidden rounded-(--radius-md) border border-[color:var(--color-ink)] bg-[color:var(--color-surface)] shadow-(--shadow-card)"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[color:var(--color-rule)] bg-[color:var(--color-ground-sunk)] px-4 py-3">
              <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium text-[color:var(--color-ink)]">
                {summary?.icon}
                <span className="truncate">{title}</span>
              </h3>
              {summary?.detail && (
                <span className="tabular text-sm text-[color:var(--color-ink-secondary)]">
                  {summary.detail}
                </span>
              )}
            </header>

            <div className="grid gap-4 p-4 sm:grid-cols-2">
              {render(row, index)}

              {/*
                Y la pregunta que sigue, en el botón.

                «Guardar y agregar otro» es la acción de quien está haciendo una
                lista, que es lo que casi siempre está pasando aquí; «listo»
                cierra sin agregar nada. Ninguno de los dos guarda en la base:
                lo escrito ya está en el formulario y se envía al final. Lo que
                hacen es cerrar este ítem, que es lo que la persona quiere decir
                cuando dice «ya».
              */}
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    // Una fila a medio llenar no se cierra: se quedaría como un
                    // renglón que parece guardado y que el envío va a descartar
                    // en silencio, y nadie se entera hasta que el plan no
                    // cuenta el pago que sí escribieron.
                    const gaps = missing?.(row) ?? [];
                    if (gaps.length > 0) {
                      setProblem(gaps);
                      return;
                    }
                    setProblem([]);
                    onAdd();
                    setOpen(rows.length);
                  }}
                >
                  {copy('saveAndAdd')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    // Intacta: no hay nada que reclamar ni nada que guardar. Se
                    // va, que es lo que «listo» significa en una fila vacía.
                    if (isBlank?.(row) === true) {
                      setProblem([]);
                      onRemove(index);
                      setOpen(null);
                      return;
                    }
                    const gaps = missing?.(row) ?? [];
                    if (gaps.length > 0) {
                      setProblem(gaps);
                      return;
                    }
                    setProblem([]);
                    setOpen(null);
                  }}
                >
                  {copy('done')}
                </Button>
                {/*
                  Always offered, including on the last row. It used to appear
                  only from the second row on, which meant an item added by
                  mistake could not be taken back out: removing everything
                  leaves the step empty, which is a real answer — the same one
                  «no tengo de esto» gives.
                */}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`${removeLabel} — ${title}`}
                  onClick={() => {
                    onRemove(index);
                    setOpen(null);
                  }}
                >
                  {removeLabel}
                </Button>
              </div>

              {problem.length > 0 && (
                <p
                  role="status"
                  className="text-sm text-pretty text-[color:var(--color-caution)] sm:col-span-2"
                >
                  {copy('incomplete').replace('{fields}', problem.join(', '))}
                </p>
              )}
            </div>
          </section>
        );
      })}

      {open === null && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => {
            onAdd();
            setOpen(rows.length);
          }}
        >
          {rows.length === 0 ? addFirstLabel : addLabel}
        </Button>
      )}
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
 * Lo que de verdad llega de un ingreso.
 *
 * El bruto menos lo que la persona copió de su ficha, cuando declaró las dos
 * cosas; el monto tal cual cuando no. Nunca negativo: unos descuentos mayores
 * que el bruto son un error de tipeo, y «te llega −$200» no es una cifra que
 * nadie pueda usar.
 */
function arrivingAmount(row: {
  amount: string;
  amountIsGross?: boolean | undefined;
  frequency?: Frequency | undefined;
  anchorFirst?: string | undefined;
  anchorSecond?: string | undefined;
  deductions?: readonly Deduction[] | undefined;
}): string {
  const lines = row.deductions ?? [];
  if (row.amountIsGross !== true || lines.length === 0) return row.amount;

  const perAnchor = arrivingPerAnchor(row);
  if (!perAnchor) return Math.max(asAmount(row.amount) - takenOn(lines, null), 0).toFixed(2);

  // El promedio de las dos, que es lo que mantiene correcto el total del mes en
  // cada vista que no razona por quincena. Lo que trae cada una vive aparte.
  return (perAnchor.reduce((total, one) => total + one, 0) / perAnchor.length).toFixed(2);
}

const asAmount = (value: string) => Number((value ?? '').replace(/[^\d.]/g, '')) || 0;

/** Lo que se descuenta en el día `day`; `null` pregunta por un pago cualquiera. */
function takenOn(lines: readonly Deduction[], day: number | null): number {
  return lines.reduce((total, line) => {
    const only = line.appliesToAnchors ?? [];
    const applies = only.length === 0 || (day !== null && only.includes(day));
    return applies ? total + asAmount(line.amount) : total;
  }, 0);
}

/** Los dos días que cobra un sueldo quincenal, cuando los declaró enteros. */
function anchorsOf(row: {
  frequency?: Frequency | undefined;
  anchorFirst?: string | undefined;
  anchorSecond?: string | undefined;
}): number[] {
  if (row.frequency !== 'semimonthly') return [];
  const days = [row.anchorFirst, row.anchorSecond]
    .map((value) => Number((value ?? '').replace(/[^\d]/g, '')))
    .filter((day) => day >= 1 && day <= 31);
  return days.length === 2 ? days : [];
}

/**
 * Lo que llega en cada quincena, o `null` cuando no hay dos que distinguir.
 *
 * Null no es «cero quincenas»: es «esta pregunta no aplica», y el que llama
 * vuelve a la resta de siempre. Un sueldo mensual tiene un pago y un sueldo
 * quincenal sin los dos días declarados no tiene contra qué emparejar nada.
 */
function arrivingPerAnchor(row: {
  amount: string;
  frequency?: Frequency | undefined;
  anchorFirst?: string | undefined;
  anchorSecond?: string | undefined;
  deductions?: readonly Deduction[] | undefined;
}): number[] | null {
  const anchors = anchorsOf(row);
  if (anchors.length !== 2) return null;
  const lines = row.deductions ?? [];
  const gross = asAmount(row.amount);
  return anchors.map((day) => Math.max(gross - takenOn(lines, day), 0));
}

/**
 * Lo que te descuentan antes de que el sueldo llegue, copiado de tu ficha.
 *
 * Un asalariado en Panamá no cobra lo que dice su contrato: entre el bruto y lo
 * que entra a la cuenta hay seguro social, seguro educativo y retención de
 * renta. Preguntar solo «cuánto entra» es correcto para planear e inútil para
 * entender — un hogar que ve $1.000 no puede cuadrarlo con un contrato de
 * $1.400 ni saber a dónde se fueron los $400.
 *
 * **Los montos los pone la persona, leídos de su propio recibo.** No hay tasas
 * oficiales aquí, y su ausencia es deliberada: este repositorio ya tiene dónde
 * viven —con vigencia, fuente y revisor— y ya tiene la puerta que impide
 * mostrar una cifra fiscal que nadie calificado revisó. Calcular un 9,75% aquí
 * porque suena correcto sería saltarse esa puerta por detrás.
 *
 * Las etiquetas son texto libre a propósito. Una ficha dice «S.S.», otra «Caja
 * de Seguro Social», y una tercera trae una línea que ninguna lista nuestra
 * habría previsto; obligar a elegir de un menú es obligar a traducir, y la
 * traducción es donde se pierde el dato.
 */
function IncomeDeductions({
  row,
  onChange,
  currencySymbol,
  copy,
  payroll,
}: {
  readonly row: IncomeRow;
  readonly onChange: (change: Partial<IncomeRow>) => void;
  readonly currencySymbol: string;
  readonly copy: (key: string) => string;
  readonly payroll?: PayrollLegendData | undefined;
}) {
  const [estimating, setEstimating] = useState(false);
  const [estimateFailed, setEstimateFailed] = useState(false);

  const lines = row.deductions ?? [];
  const asNumber = (value: string) => Number((value ?? '').replace(/[^\d.]/g, '')) || 0;

  // El bruto ya no es un campo aparte: es el mismo monto de arriba, cuando la
  // persona dijo que lo que escribió es el bruto. Pedir dos veces la misma
  // cifra era pedirle que mantuviera dos números de acuerdo entre sí.
  const gross = asNumber(row.amount);
  const paymentsPerYear = PAYMENTS_PER_YEAR[row.frequency];
  const taken = lines.reduce((total, line) => total + asNumber(line.amount), 0);
  const arrives = Math.max(gross - taken, 0);

  /**
   * Los días que este sueldo cobra, cuando cobra dos veces al mes.
   *
   * Solo aquí tiene sentido preguntar en qué quincena sale un descuento: un
   * sueldo mensual tiene un pago y no hay nada que elegir. Y los días son los
   * que la persona escribió arriba, no «primera» y «segunda» — el 5 y el 20 son
   * un calendario distinto del 15 y el 30, y quien lee su recibo reconoce el
   * número, no el ordinal.
   */
  const per = copy(`income.per.${row.frequency}`);

  /**
   * La etiqueta de una línea calculada, con su porcentaje.
   *
   * Una sola forma de escribirla, porque se escribe en dos sitios: cuando la
   * persona pulsa «Calcular» y cuando el período cambia y hay que rehacerla. Dos
   * versiones de la misma frase divergen el día que alguien toca una sola.
   */
  const labelFor = (line: { key: string; rate: string; isEffectiveRate: boolean }) =>
    `${copy(`income.line.${line.key}`)} (${line.rate}%${
      line.isEffectiveRate ? ` ${copy('income.effectiveSuffix')}` : ''
    })`;
  const anchors = anchorsOf(row);
  const byFortnight = anchors.length === 2;
  const perAnchor = arrivingPerAnchor(row);
  const uneven = perAnchor?.some((one) => one !== perAnchor[0]) === true;
  // El promedio, que es lo que se guarda como la cifra plana del ingreso.
  const average = perAnchor
    ? perAnchor.reduce((total, one) => total + one, 0) / perAnchor.length
    : arrives;

  const money = (value: number) =>
    `${currencySymbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const setLines = (next: readonly Deduction[]) => {
    onChange({ deductions: next });
  };

  /**
   * Las líneas calculadas siguen al sueldo y al período. Las escritas, no.
   *
   * Un mismo 1.500 es un sueldo distinto según se cobre al mes o por quincena
   * —treinta y seis mil al año contra dieciocho mil— y la renta que se retiene
   * de cada uno no se parece. Dejar la cifra vieja debajo de una etiqueta que
   * ya dice «por quincena» es enseñar una retención que no le corresponde a
   * nadie, y es peor que no enseñar ninguna: parece calculada.
   *
   * Solo se rehacen las que salieron del motor. Lo que la persona copió de su
   * recibo es suyo y no se toca — ni siquiera para «corregirlo», porque lo que
   * este producto guarda es lo que ella confirmó.
   *
   * Con retraso, porque el bruto se escribe cifra a cifra y cada tecla no
   * merece una ida al servidor.
   */
  const latest = useRef({ lines, labelFor, onChange });
  latest.current = { lines, labelFor, onChange };

  useEffect(() => {
    const calculated = latest.current.lines.filter((line) => line.ruleKey !== undefined);
    if (calculated.length === 0 || asAmount(row.amount) <= 0) return;

    const timer = setTimeout(() => {
      void estimatePanamaPayroll(row.amount, row.frequency).then((result) => {
        if (!result.ok || !result.lines) return;
        const fresh = new Map(result.lines.map((line) => [line.key, line]));
        const next = latest.current.lines.flatMap((line) => {
          if (line.ruleKey === undefined) return [line];
          const one = fresh.get(line.ruleKey);
          // Una línea que desapareció del cálculo es una retención que ya no se
          // cobra —un sueldo que bajó del primer tramo no paga renta— y dejarla
          // en cero sugeriría que se cobró algo.
          return one ? [{ ...line, label: latest.current.labelFor(one), amount: one.amount }] : [];
        });
        latest.current.onChange({ deductions: next });
      });
    }, 400);

    return () => {
      clearTimeout(timer);
    };
    // Solo el sueldo y el período. Las líneas se leen por referencia a
    // propósito: incluirlas aquí sería pedirle a este efecto que se dispare con
    // su propio resultado.
  }, [row.amount, row.frequency]);

  return (
    <div className="sm:col-span-2">
      <div className="flex flex-col gap-4 border-l border-[color:var(--color-rule)] pl-4">
        <p className="text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {copy('income.deductionsDetail')}
        </p>

        {lines.map((line, at) => (
          <div
            key={at}
            className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          >
            <Field label={copy('income.deductionLabel')}>
              {({ id }) => (
                <Input
                  id={id}
                  value={line.label}
                  placeholder={copy('income.deductionPlaceholder')}
                  onChange={(event) => {
                    setLines(
                      lines.map((one, position) =>
                        position === at ? { ...one, label: event.target.value } : one,
                      ),
                    );
                  }}
                />
              )}
            </Field>
            <MoneyField
              label={`${copy('income.deductionAmount')} ${per}`}
              symbol={currencySymbol}
              value={line.amount}
              onChange={(value) => {
                setLines(
                  lines.map((one, position) => (position === at ? { ...one, amount: value } : one)),
                );
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="justify-self-start sm:mb-1"
              aria-label={`${copy('remove')} — ${line.label.trim() || `${copy('income.deductionLabel')} ${String(at + 1)}`}`}
              onClick={() => {
                setLines(lines.filter((_, position) => position !== at));
              }}
            >
              {copy('remove')}
            </Button>

            {/*
              En qué quincena sale, y solo cuando hay dos.

              Un sueldo mensual tiene un pago y no hay nada que elegir; ofrecer
              la pregunta ahí sería ofrecer una decisión sin consecuencia. El
              default son las dos, porque las tres líneas que casi todo el mundo
              tiene —seguro social, educativo y renta— salen de cada pago.
            */}
            {byFortnight && line.ruleKey === undefined && (
              <FortnightPicker
                anchors={anchors}
                chosen={line.appliesToAnchors ?? []}
                copy={copy}
                label={line.label}
                onChange={(next) => {
                  setLines(
                    lines.map((one, position) =>
                      position === at ? { ...one, appliesToAnchors: next } : one,
                    ),
                  );
                }}
              />
            )}
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setLines([...lines, { label: '', amount: '' }]);
            }}
          >
            {lines.length === 0 ? copy('income.addFirstDeduction') : copy('income.addDeduction')}
          </Button>

          {/*
            El cálculo con las tasas panameñas rellena las líneas; no las
            cierra. Lo que quede guardado es lo que la persona confirme contra
            su propio recibo, y por eso el botón dice «calcular» y no
            «aplicar», y por eso las tres líneas siguen siendo editables
            después. El conjunto de reglas del que sale es un borrador que
            nadie calificado revisó: presentarlo como lo que se debe sería
            afirmar algo que este producto no puede afirmar.
          */}
          {gross > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={estimating}
              onClick={() => {
                setEstimating(true);
                void estimatePanamaPayroll(row.amount, row.frequency)
                  .then((result) => {
                    if (!result.ok || !result.lines) {
                      setEstimateFailed(true);
                      return;
                    }
                    setEstimateFailed(false);
                    setLines(
                      result.lines.map((line) => ({
                        // El porcentaje viaja en la etiqueta porque es lo que
                        // convierte un monto en algo verificable: «292,50» no
                        // se puede comprobar contra nada, «292,50 (9,75%)» se
                        // comprueba con el bruto delante. Y sale del conjunto
                        // de reglas, no de una constante de esta pantalla.
                        label: labelFor(line),
                        amount: line.amount,
                        // De dónde salió, que es lo que la marca como línea de
                        // ley: sale de todos los pagos y no hay nada que elegir.
                        ruleKey: line.key,
                      })),
                    );
                  })
                  .finally(() => {
                    setEstimating(false);
                  });
              }}
            >
              {estimating ? copy('income.estimating') : copy('income.estimateAction')}
            </Button>
          )}
        </div>

        {estimateFailed && (
          <p className="text-xs text-[color:var(--color-caution)]">
            {copy('income.estimateFailed')}
          </p>
        )}

        {lines.length > 0 && gross > 0 && (
          <div className="max-w-[46ch] border-t border-[color:var(--color-rule)] pt-3 text-sm text-[color:var(--color-ink-secondary)]">
            <div className="flex items-baseline justify-between gap-4 py-1">
              <span>{`${copy('income.grossLine')} ${per}`}</span>
              <span className="tabular">{money(gross)}</span>
            </div>
            {/*
              La cifra anual, a la vista.

              Los tramos de renta son anuales, así que el bruto que se teclea
              aquí se multiplica por los pagos del año antes de que se le
              apliquen — y esa multiplicación es donde un bruto mensual escrito
              en un ingreso quincenal se convierte en el doble de sueldo y en
              una retención que no es la de nadie. El número que delata el error
              es este.
            */}
            {paymentsPerYear > 1 && (
              <div className="flex items-baseline justify-between gap-4 py-1">
                <span>{copy('income.annualLine').replace('{count}', String(paymentsPerYear))}</span>
                <span className="tabular">{money(gross * paymentsPerYear)}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-4 py-1">
              <span>{copy('income.deductedLine').replace('{count}', String(lines.length))}</span>
              <span className="tabular">−{money(taken)}</span>
            </div>
            {/*
              Uno o dos netos, según lo que de verdad pase.

              Cuando todos los descuentos salen de los dos pagos, las dos
              quincenas traen lo mismo y un solo número lo dice todo. Cuando no,
              enseñar el promedio sería enseñar una cifra que ningún día del mes
              llega a la cuenta.
            */}
            {uneven ? (
              <div className="mt-1 border-t border-[color:var(--color-rule)] pt-2 text-base text-[color:var(--color-ink)]">
                {anchors.map((day, at) => (
                  <div key={day} className="flex items-baseline justify-between gap-4 py-1">
                    <span className="font-medium">
                      {copy('income.netOnDay').replace('{day}', String(day))}
                    </span>
                    <span className="tabular font-medium">{money(perAnchor?.[at] ?? arrives)}</span>
                  </div>
                ))}
                <p className="mt-2 text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
                  {copy('income.netUnevenNote')
                    .replace('{amount}', money(average))
                    .replace('{per}', per)}
                </p>
              </div>
            ) : (
              <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-[color:var(--color-rule)] pt-2 text-base text-[color:var(--color-ink)]">
                <span className="font-medium">{`${copy('income.netLine')} ${per}`}</span>
                <span className="tabular font-medium">{money(arrives)}</span>
              </div>
            )}
            <p className="mt-3 text-xs text-[color:var(--color-ink-tertiary)]">
              {copy('income.estimateNote')}
            </p>
          </div>
        )}

        {payroll && <PayrollLegend copy={copy} currencySymbol={currencySymbol} payroll={payroll} />}
      </div>
    </div>
  );
}

/**
 * Qué significa el monto que se acaba de escribir.
 *
 * Dos opciones y ninguna casilla nueva de dinero. La implementación anterior
 * pedía «Monto» arriba y «Salario bruto» abajo, que es la misma cifra dos
 * veces, y dejaba a la persona a cargo de que las dos coincidieran; lo que
 * faltaba no era otro campo sino saber cuál de las dos cosas escribió.
 *
 * El neto va primero y es el que viene marcado. Es lo que casi todo el mundo
 * sabe de memoria, es lo único que el plan necesita para funcionar, y elegirlo
 * no abre nada más: quien no tenga descuentos que copiar termina la pregunta en
 * un clic.
 */
function AmountMeaning({
  isGross,
  copy,
  onChange,
}: {
  readonly isGross: boolean;
  readonly copy: (key: string) => string;
  readonly onChange: (isGross: boolean) => void;
}) {
  const group = useId();
  const options = [
    { gross: false, label: copy('income.meaningNet'), hint: copy('income.meaningNetHint') },
    { gross: true, label: copy('income.meaningGross'), hint: copy('income.meaningGrossHint') },
  ];

  return (
    <fieldset className="sm:col-span-2">
      <legend className="text-sm font-medium text-[color:var(--color-ink)]">
        {copy('income.meaningTitle')}
      </legend>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {options.map((option) => {
          const selected = option.gross === isGross;
          return (
            <label
              key={String(option.gross)}
              className={[
                'flex cursor-pointer gap-3 rounded-(--radius-md) border p-3 transition-colors duration-(--duration-quick) ease-(--ease-settle)',
                selected
                  ? 'border-[color:var(--color-ink)] bg-[color:var(--color-ground-sunk)]'
                  : 'border-[color:var(--color-surface-border)] hover:border-[color:var(--color-rule-strong)]',
              ].join(' ')}
            >
              <input
                type="radio"
                name={group}
                checked={selected}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--color-ink)]"
                onChange={() => {
                  onChange(option.gross);
                }}
              />
              <span className="text-sm">
                <span className="block text-[color:var(--color-ink)]">{option.label}</span>
                <span className="mt-0.5 block text-xs text-pretty text-[color:var(--color-ink-secondary)]">
                  {option.hint}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * En qué quincenas sale un descuento, con los días que la persona escribió.
 *
 * Dos botones y no un menú: son dos opciones, se ven las dos a la vez, y el
 * estado se lee sin abrir nada. Encendidos los dos significa «en los dos
 * pagos», que es lo corriente y el default; apagar uno deja el descuento en el
 * otro. El último encendido no se puede apagar — un descuento que no sale
 * ningún día no es un descuento, es una fila que habría que borrar, y para eso
 * está «Quitar» al lado.
 *
 * Los botones dicen el día del mes y no «primera» y «segunda» a propósito: el 5
 * y el 20 son un calendario distinto del 15 y el 30, y quien está mirando su
 * recibo reconoce el número, no el ordinal.
 */
function FortnightPicker({
  anchors,
  chosen,
  copy,
  label,
  onChange,
}: {
  readonly anchors: readonly number[];
  readonly chosen: readonly number[];
  readonly copy: (key: string) => string;
  readonly label: string;
  readonly onChange: (next: readonly number[]) => void;
}) {
  // Vacío significa «en todos», así que para pintar las tarjetas es lo mismo
  // que tenerlos todos encendidos. Una sola forma de leerlo evita que la
  // tarjeta diga una cosa y la cuenta haga otra.
  const active = chosen.length === 0 ? anchors : chosen;

  return (
    <fieldset className="sm:col-span-3">
      <legend className="text-sm font-medium text-[color:var(--color-ink)]">
        {copy('income.deductionWhen')}
      </legend>
      <div
        aria-label={`${copy('income.deductionWhen')} — ${label.trim() || copy('income.deductionLabel')}`}
        className="mt-2 grid gap-3 sm:grid-cols-2"
      >
        {anchors.map((day) => {
          const on = active.includes(day);
          // El último encendido no se apaga: un descuento que no sale ningún
          // día no es un descuento, es una fila que habría que borrar, y para
          // eso está «Quitar» al lado.
          const locked = on && active.length === 1;
          return (
            <label
              key={day}
              className={[
                'flex cursor-pointer gap-3 rounded-(--radius-md) border p-3 transition-colors duration-(--duration-quick) ease-(--ease-settle)',
                on
                  ? 'border-[color:var(--color-ink)] bg-[color:var(--color-ground-sunk)]'
                  : 'border-[color:var(--color-surface-border)] hover:border-[color:var(--color-rule-strong)]',
              ].join(' ')}
            >
              <input
                type="checkbox"
                checked={on}
                aria-disabled={locked || undefined}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--color-ink)]"
                onChange={() => {
                  if (locked) return;
                  const next = on ? active.filter((one) => one !== day) : [...active, day].sort();
                  // Todos encendidos vuelve a ser «en todos los pagos», que es
                  // el mismo hecho escrito de la forma más corta.
                  onChange(next.length === anchors.length ? [] : next);
                }}
              />
              <span className="text-sm">
                <span className="block text-[color:var(--color-ink)]">
                  {copy('income.deductionWhenDay').replace('{day}', String(day))}
                </span>
                <span className="mt-0.5 block text-xs text-pretty text-[color:var(--color-ink-secondary)]">
                  {on ? copy('income.deductionWhenOn') : copy('income.deductionWhenOff')}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Lo que se lleva sumado, al pie del paso.
 *
 * Un cuestionario que pide diez cifras y no enseña ninguna suma obliga a
 * llevar la cuenta de cabeza, que es justo lo que la persona vino a dejar de
 * hacer. Y la suma es la que delata el error de tipeo: un alquiler de $7.000
 * no se ve raro en su casilla y sí se ve raro cuando el total del mes lo dice.
 *
 * Es un avance, no una promesa, y el texto lo dice: los pasos que faltan van a
 * mover la cifra.
 */
function StepTotals({
  lines,
  note,
}: {
  readonly lines: readonly {
    readonly label: string;
    readonly value: string;
    readonly tone?: 'muted' | 'strong' | 'negative';
    readonly indent?: boolean;
  }[];
  readonly note?: string;
}) {
  if (lines.length === 0) return null;

  return (
    <aside className="mt-2 max-w-[46ch] rounded-(--radius-md) border border-[color:var(--color-surface-border)] bg-[color:var(--color-ground-sunk)] px-4 py-3 text-sm">
      {lines.map((line, at) => (
        <div
          // Por posición y no por etiqueta: dos sueldos pueden llamarse igual
          // —«Sueldo Blei» dos veces mientras alguien corrige el segundo— y dos
          // hermanos con la misma clave se pisan.
          key={at}
          className={[
            'flex items-baseline justify-between gap-4 py-1',
            line.tone === 'strong'
              ? 'mt-1 border-t border-[color:var(--color-rule)] pt-2 text-base font-medium text-[color:var(--color-ink)]'
              : 'text-[color:var(--color-ink-secondary)]',
            line.indent === true ? 'pl-4' : '',
          ].join(' ')}
        >
          <span className="min-w-0 truncate">{line.label}</span>
          <span
            className={[
              'tabular shrink-0',
              line.tone === 'negative' ? 'text-[color:var(--color-ink-secondary)]' : '',
            ].join(' ')}
          >
            {line.value}
          </span>
        </div>
      ))}
      {note && (
        <p className="mt-2 text-xs text-pretty text-[color:var(--color-ink-tertiary)]">{note}</p>
      )}
    </aside>
  );
}

/**
 * Los rubros que casi todo el mundo usa, a un toque.
 *
 * Ocho de veintiocho cubren la mayoría de los pagos de una casa: el techo, la
 * comida, el carro, la salud, la escuela. Ponerlos delante ahorra abrir una
 * lista larga para elegir lo obvio, y la lista sigue ahí entera para quien
 * necesita «Servicios profesionales».
 *
 * No es un control aparte del menú: es el mismo dato, elegido de otra forma, y
 * lo que se toca aquí se ve elegido allá. Un atajo que no refleja el estado del
 * campo que atajó es una segunda fuente de verdad esperando a discrepar.
 */
const COMMON_CATEGORIES = [
  'housing',
  'groceries',
  'dining',
  'transportation',
  'healthcare',
  'education',
  'subscriptions',
  'debt',
] as const;

function CategoryShortcuts({
  categories,
  chosen,
  onChoose,
}: {
  readonly categories: readonly {
    readonly slug: string;
    readonly name: string;
    readonly icon?: string | null | undefined;
  }[];
  readonly chosen: string;
  readonly onChoose: (slug: string) => void;
}) {
  const quick = COMMON_CATEGORIES.map((slug) => categories.find((one) => one.slug === slug)).filter(
    (one) => one !== undefined,
  );

  // Sin rubros no hay atajos, y un renglón de botones vacío no explica nada.
  if (quick.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 sm:col-span-2">
      {quick.map((category) => {
        const on = chosen === category.slug;
        return (
          <Button
            key={category.slug}
            type="button"
            size="sm"
            variant={on ? 'primary' : 'secondary'}
            aria-pressed={on}
            onClick={() => {
              // Volver a tocarlo lo suelta: elegir por error un rubro no debería
              // costar abrir el menú para encontrar «Sin rubro».
              onChoose(on ? '' : category.slug);
            }}
          >
            <CategoryIcon name={category.icon} />
            {category.name}
          </Button>
        );
      })}
    </div>
  );
}

/** Lo que la leyenda necesita saber, tal como sale del conjunto de reglas. */
export interface PayrollLegendData {
  readonly socialRate: string;
  readonly educationRate: string;
  readonly bands: readonly {
    readonly from: string;
    readonly upTo: string | null;
    readonly rate: string;
  }[];
  readonly basePeriodsPerYear: number;
  readonly salaryPeriodsPerYear: number;
  readonly deductsContributions: boolean;
  readonly source: string;
}

/**
 * De dónde sale cada porcentaje, y por qué el de la renta no es un porcentaje.
 *
 * Va debajo del cálculo porque es lo que lo vuelve verificable: un monto solo
 * se puede comprobar contra el recibo, pero una regla se puede comprobar contra
 * el propio sueldo. Las dos contribuciones son una multiplicación y se explican
 * en una línea; la renta necesita un dibujo, porque casi nadie sabe que es
 * progresiva y la creencia contraria —«si paso de 50.000 me quitan el 25% de
 * todo»— es la que hace que la gente rechace un aumento.
 *
 * Ninguna cifra de aquí está escrita en el texto: todas llegan del conjunto de
 * reglas. Una leyenda que cita una tasa que ya cambió explica mal con la misma
 * seguridad con la que explicaba bien.
 */
function PayrollLegend({
  copy,
  currencySymbol,
  payroll,
}: {
  readonly copy: (key: string) => string;
  readonly currencySymbol: string;
  readonly payroll: PayrollLegendData;
}) {
  const [open, setOpen] = useState(false);

  const round = (value: string) =>
    `${currencySymbol}${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const fill = (key: string, values: Record<string, string>) =>
    Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, value),
      copy(key),
    );

  return (
    <div className="max-w-[52ch]">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {/*
          Un desplegable dice dos cosas —que se pulsa, y que hay algo detrás— y
          el contorno solo dice la primera. La punta que gira dice la segunda, y
          de paso dice en cuál de los dos estados está sin tener que leer.
        */}
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          className={[
            'h-3 w-3 transition-transform duration-(--duration-quick) ease-(--ease-settle)',
            open ? 'rotate-90' : '',
          ].join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4.5 2.5 8 6l-3.5 3.5" />
        </svg>
        {open ? copy('income.legendHide') : copy('income.legendShow')}
      </Button>

      {open && (
        <div className="mt-2 flex flex-col gap-4 border-l border-[color:var(--color-rule)] pl-4 text-sm text-[color:var(--color-ink-secondary)]">
          <p className="text-pretty">
            {fill('income.legendContributions', {
              social: payroll.socialRate,
              education: payroll.educationRate,
            })}
          </p>

          <div className="flex flex-col gap-2">
            <p className="font-medium text-[color:var(--color-ink)]">{copy('income.isrTitle')}</p>
            <p className="text-pretty">{copy('income.isrIntro')}</p>

            <BracketChart bands={payroll.bands} round={round} copy={copy} />

            <p className="text-pretty">
              {fill('income.isrBase', {
                base: String(payroll.basePeriodsPerYear),
                salaries: String(payroll.salaryPeriodsPerYear),
              })}
            </p>
            <p className="text-pretty">
              {payroll.deductsContributions
                ? copy('income.isrBaseNet')
                : copy('income.isrBaseGross')}
            </p>
            <p className="text-pretty">{copy('income.isrEffective')}</p>
          </div>

          <p className="text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
            {fill('income.legendSource', { source: payroll.source })}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Los tramos, dibujados sobre la renta anual.
 *
 * Una barra y no un gráfico de barras: lo que hay que ver es que el sueldo se
 * corta en trozos y que cada trozo paga lo suyo, no que un número sea mayor que
 * otro. La escala es lineal hasta un cuarto por encima del último umbral, para
 * que el tramo abierto tenga sitio donde verse sin dominar el dibujo.
 *
 * Sin color propio: la intensidad de la tinta lleva el orden de los tramos. En
 * este sistema el color dice significado financiero, y un impuesto no es una
 * ganancia ni una pérdida.
 */
function BracketChart({
  bands,
  round,
  copy,
}: {
  readonly bands: PayrollLegendData['bands'];
  readonly round: (value: string) => string;
  readonly copy: (key: string) => string;
}) {
  const last = bands[bands.length - 1];
  const top = Number(bands[bands.length - 1]?.from ?? '0') * 1.25 || 1;
  const at = (value: string) => Math.min(Number(value) / top, 1) * 100;

  if (!last) return null;

  return (
    <figure className="my-1 flex flex-col gap-2">
      <figcaption className="sr-only">{copy('income.isrChartCaption')}</figcaption>
      <div className="flex h-9 w-full overflow-hidden rounded-(--radius-sm) border border-[color:var(--color-surface-border)]">
        {bands.map((band, index) => {
          const start = at(band.from);
          const end = band.upTo === null ? 100 : at(band.upTo);
          // La tinta se intensifica con el tramo. El primero, que no paga, se
          // queda en el fondo de la tarjeta: la ausencia de impuesto se lee
          // mejor como ausencia de relleno que como un relleno claro.
          const ink = index === 0 ? 0 : 0.18 + index * 0.22;
          return (
            <div
              key={band.from}
              className="flex items-center justify-center border-r border-[color:var(--color-surface-border)] last:border-r-0"
              style={{
                width: `${String(Math.max(end - start, 0))}%`,
                backgroundColor:
                  ink === 0
                    ? 'transparent'
                    : `color-mix(in oklab, var(--color-ink) ${String(Math.round(ink * 100))}%, transparent)`,
              }}
            >
              <span
                className={[
                  'tabular text-xs font-medium',
                  index === 0
                    ? 'text-[color:var(--color-ink-secondary)]'
                    : 'text-[color:var(--color-ink-inverse)]',
                ].join(' ')}
              >
                {band.rate}%
              </span>
            </div>
          );
        })}
      </div>

      <div className="relative h-4 text-xs text-[color:var(--color-ink-tertiary)]">
        {bands.map((band, index) =>
          index === 0 ? null : (
            <span
              key={band.from}
              className="tabular absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${String(at(band.from))}%` }}
            >
              {round(band.from)}
            </span>
          ),
        )}
      </div>
    </figure>
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
  incomePerMonth,
  categories,
  currencySymbol,
  copy,
}: {
  readonly rows: readonly CommitmentRow[];
  readonly incomes: readonly { at: number; name: string }[];
  /**
   * Lo que entra al mes según lo contestado hasta aquí.
   *
   * Un total de compromisos sin nada contra qué compararlo no responde la
   * única pregunta que la persona tiene en la cabeza mientras lo escribe. Cero
   * cuando todavía no hay ingresos: entonces no se enseña la resta, porque
   * «te queda −$950» no es una cifra, es una pantalla a medio contestar.
   */
  readonly incomePerMonth: number;
  readonly categories: readonly {
    readonly slug: string;
    readonly name: string;
    readonly icon?: string | null | undefined;
  }[];
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
        {byCategory.map(([slug, value]) => (
          <div key={slug} className="flex items-baseline justify-between gap-4 py-1.5">
            <span className="flex min-w-0 items-center gap-2">
              <CategoryIcon
                name={categories.find((category) => category.slug === slug)?.icon ?? null}
              />
              <span className="truncate">{nameOf(slug)}</span>
            </span>
            <span className="tabular shrink-0">{money(value)}</span>
          </div>
        ))}

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

        {/*
          Y contra lo que entra, que es la pregunta de fondo.

          Sumar los pagos responde «¿cuánto me reclaman?». Restarlos del sueldo
          responde «¿me alcanza?», que es la que la persona tiene en la cabeza
          mientras escribe el octavo. Solo cuando hay ingresos contestados: sin
          ellos la resta daría un negativo que no describe a nadie.
        */}
        {incomePerMonth > 0 && (
          <div className="mt-4 border-t border-[color:var(--color-rule)] pt-3">
            {line(copy('commitments.totalIncome'), money(incomePerMonth))}
            {line(copy('commitments.totalLabel'), `−${money(sum(counted))}`)}
            <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-[color:var(--color-rule)] pt-2 text-base text-[color:var(--color-ink)]">
              <span className="font-medium">{copy('commitments.totalLeft')}</span>
              <span className="tabular font-medium">{money(incomePerMonth - sum(counted))}</span>
            </div>
            <p className="mt-2 text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
              {copy('commitments.totalLeftNote')}
            </p>
          </div>
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
