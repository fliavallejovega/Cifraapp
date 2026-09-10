'use server';

import { accounts, debts } from '@app/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { currencyOf } from './household-context';
import {
  firstIssueKey,
  optionalAmount,
  percentageRate,
  positiveAmount,
  recordName,
} from './record-input';
import { optionalUuid } from './record-input';
import { revalidateFinancials, revalidateScreen } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Debts: what is owed, at what rate, and what has to be paid this month.
 *
 * The rate is the figure that earns the product its keep. «Put $2,590 against
 * this card because it charges 24.5%» is only defensible because 24.5 is a
 * number the household stated and can correct — which, until this file, it
 * could not.
 *
 * A balance is never inferred from the linked account. The account holds what
 * the bank says today; the debt holds what the household is managing. They are
 * usually the same figure and the day they differ, silently overwriting one
 * with the other would destroy the discrepancy that matters.
 */

const optionalDay = z.preprocess(
  (value) => (value === '' || value === undefined || value === null ? undefined : value),
  z.coerce.number().int().min(1).max(31).optional(),
);

/** The classes of debt the product knows, as the database enumerates them. */
const DEBT_KINDS = [
  'credit_card',
  'auto_loan',
  'mortgage',
  'personal_loan',
  'student_loan',
  'other',
  'informal',
] as const;

export type DebtKind = (typeof DEBT_KINDS)[number];

const debtInput = z.object({
  name: recordName,
  currentBalance: positiveAmount,
  apr: percentageRate,
  minimumPayment: positiveAmount,
  dueDay: optionalDay,
  statementDay: optionalDay,
  creditLimit: optionalAmount,
  /** Los últimos cuatro de la tarjeta. Nunca el número completo. */
  /**
   * A quién se le debe, cuando no es un banco.
   *
   * Se guarda tal como se escribió y además normalizado: la forma normalizada
   * es contra lo que se cruza la descripción de un movimiento, y normalizar al
   * leer en vez de al guardar haría el cruce distinto según quién consulte.
   */
  counterpartyName: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.string().trim().min(1).max(120).optional(),
  ),
  maskedNumber: z.preprocess(
    (value) => (value === '' || value === undefined || value === null ? undefined : value),
    z
      .string()
      .trim()
      .regex(/^\d{4}$/)
      .optional(),
  ),
  instalmentDay: optionalDay,
  termMonths: z.preprocess(
    (value) => (value === '' || value === undefined || value === null ? undefined : value),
    z.coerce.number().int().min(1).max(600).optional(),
  ),
  paidMonths: z.preprocess(
    (value) => (value === '' || value === undefined || value === null ? undefined : value),
    z.coerce.number().int().min(0).max(600).optional(),
  ),
  kind: z.enum(DEBT_KINDS).default('other'),
  personId: optionalUuid,
});

const FIELD_ERRORS = {
  name: 'nameRequired',
  currentBalance: 'balanceInvalid',
  apr: 'aprInvalid',
  minimumPayment: 'minimumInvalid',
  dueDay: 'dayInvalid',
  statementDay: 'dayInvalid',
  instalmentDay: 'dayInvalid',
  creditLimit: 'limitInvalid',
  maskedNumber: 'maskInvalid',
  termMonths: 'termInvalid',
  paidMonths: 'termInvalid',
} as const;

function parse(formData: FormData) {
  return debtInput.safeParse({
    name: formData.get('name'),
    currentBalance: formData.get('currentBalance'),
    apr: formData.get('apr'),
    minimumPayment: formData.get('minimumPayment'),
    dueDay: formData.get('dueDay'),
    statementDay: formData.get('statementDay'),
    creditLimit: formData.get('creditLimit'),
    counterpartyName: formData.get('counterpartyName'),
    maskedNumber: formData.get('maskedNumber'),
    instalmentDay: formData.get('instalmentDay'),
    termMonths: formData.get('termMonths'),
    paidMonths: formData.get('paidMonths'),
    kind: formData.get('kind') ?? 'other',
    personId: formData.get('personId'),
  });
}

type Tx = Parameters<Parameters<typeof queryAsUser<unknown>>[1]>[0];

/**
 * La cuenta que lleva una tarjeta, creada o puesta al día.
 *
 * ## Por qué una tarjeta se vuelve cuenta sola
 *
 * Cuando esta conversión se escribió, ninguna deuda del hogar decía ser una
 * tarjeta: las tres se llamaban «Visa» y «Master Card» y estaban registradas
 * como `other`. Adivinarlo por el nombre es la clase de inferencia que este
 * sistema no hace sobre datos financieros, así que la conversión se pedía a
 * mano, deuda por deuda.
 *
 * Eso dejó de aplicar en cuanto el formulario pregunta la clase. Marcar
 * «tarjeta de crédito» **es** la declaración; pedir después un segundo botón
 * que diga «llevarla como cuenta» es cobrar dos veces por la misma respuesta —
 * y quien marcó la clase y no vio nada aparecer en Tarjetas concluye,
 * razonablemente, que el producto no lo entendió.
 *
 * El botón manual sigue existiendo para lo que no es tarjeta: un préstamo puede
 * tener cuenta y esa sí es una decisión aparte.
 *
 * ## Qué se mantiene en step y qué no
 *
 * El nombre, el cupo, el dueño y los últimos cuatro: son la misma cosa dicha
 * una vez. **El saldo no.** La cuenta guarda lo que dice el banco y la deuda lo
 * que la casa gestiona; pisar uno con el otro destruiría la discrepancia que la
 * pantalla de Tarjetas existe para enseñar. Sólo se escribe al crearla, cuando
 * no hay nada que destruir.
 */
async function syncCardAccount(
  tx: Tx,
  session: NonNullable<Awaited<ReturnType<typeof loadSession>>>,
  householdId: string,
  debtId: string,
  data: {
    name: string;
    currentBalance: string;
    creditLimit?: string | undefined;
    maskedNumber?: string | undefined;
    apr: string;
    personId: string | null;
  },
): Promise<void> {
  const [debt] = await tx
    .select({ accountId: debts.accountId })
    .from(debts)
    .where(and(eq(debts.id, debtId), eq(debts.householdId, householdId)))
    .limit(1);

  if (!debt) return;

  const shared = {
    name: data.name,
    creditLimit: data.creditLimit ?? null,
    maskedNumber: data.maskedNumber ?? null,
    interestRate: data.apr,
    personId: data.personId,
    scope: data.personId ? ('personal' as const) : ('household' as const),
  };

  if (debt.accountId) {
    await tx
      .update(accounts)
      .set({ ...shared, updatedAt: new Date() })
      .where(and(eq(accounts.id, debt.accountId), eq(accounts.householdId, householdId)));
    return;
  }

  const [account] = await tx
    .insert(accounts)
    .values({
      householdId,
      accountType: 'credit_card',
      // Lo que se debe, en negativo: sumar todas las cuentas tiene que dar
      // patrimonio neto y no una cifra que necesite una nota al pie.
      currentBalance: `-${data.currentBalance}`,
      currency: currencyOf(session, householdId),
      status: 'active',
      source: 'user',
      createdBy: session.user.id,
      ownerId: session.user.id,
      ...shared,
    })
    .returning({ id: accounts.id });

  if (!account) return;

  await tx
    .update(debts)
    .set({ accountId: account.id, updatedAt: new Date() })
    .where(and(eq(debts.id, debtId), eq(debts.householdId, householdId)));
}

export async function createDebt(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;

  const created = await queryAsUser(session, async (tx) => {
    const [row] = await tx
      .insert(debts)
      .values({
        householdId,
        name: parsed.data.name,
        // Nothing here knows the original amount borrowed, and inventing one
        // would put a figure nobody stated into a financial column.
        principal: parsed.data.currentBalance,
        currentBalance: parsed.data.currentBalance,
        currency: currencyOf(session, householdId),
        apr: parsed.data.apr,
        minimumPayment: parsed.data.minimumPayment,
        counterpartyName: parsed.data.counterpartyName ?? null,
        counterpartyNormalized: parsed.data.counterpartyName
          ? normalizeName(parsed.data.counterpartyName)
          : null,
        ...(parsed.data.dueDay === undefined ? {} : { dueDay: parsed.data.dueDay }),
        ...(parsed.data.statementDay === undefined
          ? {}
          : { statementDay: parsed.data.statementDay }),
        ...(parsed.data.creditLimit ? { creditLimit: parsed.data.creditLimit } : {}),
        ...(parsed.data.instalmentDay === undefined
          ? {}
          : { instalmentDay: parsed.data.instalmentDay }),
        ...(parsed.data.termMonths === undefined ? {} : { termMonths: parsed.data.termMonths }),
        ...(parsed.data.paidMonths === undefined ? {} : { paidMonths: parsed.data.paidMonths }),
        kind: parsed.data.kind,
        personId: parsed.data.personId ?? null,
      })
      .returning({ id: debts.id });

    if (!row) return null;

    // Marcar «tarjeta de crédito» ya es la declaración. No hace falta un
    // segundo botón que pregunte lo mismo con otras palabras.
    if (parsed.data.kind === 'credit_card') {
      await syncCardAccount(tx, session, householdId, row.id, {
        name: parsed.data.name,
        currentBalance: parsed.data.currentBalance,
        creditLimit: parsed.data.creditLimit,
        maskedNumber: parsed.data.maskedNumber,
        apr: parsed.data.apr,
        personId: parsed.data.personId ?? null,
      });
    }

    return row;
  });

  if (!created) return { error: 'createFailed' };

  revalidateFinancials(formData);
  revalidateScreen(formData, 'cards', 'accounts');
  return { created: created.id };
}

export async function updateDebt(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;

  const updated = await queryAsUser(session, async (tx) => {
    const [row] = await tx
      .update(debts)
      .set({
        name: parsed.data.name,
        currentBalance: parsed.data.currentBalance,
        apr: parsed.data.apr,
        minimumPayment: parsed.data.minimumPayment,
        // Lo que el formulario no enseña tampoco lo envía, y aquí se limpia:
        // pasar una tarjeta a hipoteca tiene que borrar su cupo, no dejarlo
        // guardado donde nadie lo vuelve a ver ni a corregir.
        dueDay: parsed.data.dueDay ?? null,
        statementDay: parsed.data.statementDay ?? null,
        creditLimit: parsed.data.creditLimit ?? null,
        counterpartyName: parsed.data.counterpartyName ?? null,
        counterpartyNormalized: parsed.data.counterpartyName
          ? normalizeName(parsed.data.counterpartyName)
          : null,
        instalmentDay: parsed.data.instalmentDay ?? null,
        termMonths: parsed.data.termMonths ?? null,
        paidMonths: parsed.data.paidMonths ?? null,
        kind: parsed.data.kind,
        personId: parsed.data.personId ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(debts.id, id.data), eq(debts.householdId, householdId), isNull(debts.deletedAt)),
      )
      .returning({ id: debts.id });

    if (!row) return null;

    if (parsed.data.kind === 'credit_card') {
      await syncCardAccount(tx, session, householdId, row.id, {
        name: parsed.data.name,
        currentBalance: parsed.data.currentBalance,
        creditLimit: parsed.data.creditLimit,
        maskedNumber: parsed.data.maskedNumber,
        apr: parsed.data.apr,
        personId: parsed.data.personId ?? null,
      });
    }

    return row;
  });

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  revalidateScreen(formData, `debts/${id.data}`, 'cards', 'accounts');
  return { ok: true };
}

/**
 * Removes a debt.
 *
 * Soft, and for the same reason as everywhere else: a payoff plan the household
 * accepted names this balance, and a plan whose lines point at nothing is not a
 * record of a decision.
 */
export async function removeDebt(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const [removed] = await queryAsUser(session, (tx) =>
    tx
      .update(debts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(debts.id, id.data), eq(debts.householdId, householdId), isNull(debts.deletedAt)),
      )
      .returning({ id: debts.id }),
  );

  if (!removed) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * Carrying a debt as an account, so its statement can be imported.
 *
 * A credit card is an account: it has a balance, a limit, and a statement full
 * of movements. The product modelled it only as a debt, and the consequence
 * was quiet but total — a household could hold three cards and have nowhere to
 * file a card statement, because the import screen could only offer accounts
 * and none of the cards were one.
 *
 * What this does *not* do is decide which debts are cards. A household whose
 * cards are called «Visa Davo» and «Master Card Blei» has that fact in the
 * name, and reading it out of the name is the kind of guess this system does
 * not make about money. The household asks for the conversion, one debt at a
 * time, and the class it already stated is what picks the account's type.
 *
 * The account opens at the debt's balance and then goes its own way. That is
 * deliberate and it is the whole point of doing this: from here the account
 * holds what the bank says, the debt holds what the household is managing, and
 * the gap between them is the reconciliation this was built for.
 */
const ACCOUNT_TYPE_FOR_DEBT = {
  credit_card: 'credit_card',
  auto_loan: 'loan',
  personal_loan: 'loan',
  student_loan: 'loan',
  mortgage: 'mortgage',
  other: 'other_liability',
  informal: 'other_liability',
} as const satisfies Record<DebtKind, string>;

export async function backDebtWithAccount(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    const [debt] = await tx
      .select({
        id: debts.id,
        name: debts.name,
        kind: debts.kind,
        currency: debts.currency,
        currentBalance: debts.currentBalance,
        creditLimit: debts.creditLimit,
        apr: debts.apr,
        personId: debts.personId,
        accountId: debts.accountId,
      })
      .from(debts)
      .where(
        and(eq(debts.id, id.data), eq(debts.householdId, householdId), isNull(debts.deletedAt)),
      )
      .limit(1);

    if (!debt) return 'notFound' as const;
    // Already carried. Pressing twice must not open a second card holding the
    // same money, which would double the household's movements.
    if (debt.accountId) return 'ok' as const;

    const [account] = await tx
      .insert(accounts)
      .values({
        householdId,
        name: debt.name,
        // A liability's balance is what is owed, and this codebase stores an
        // amount owed as a negative balance so that summing every account
        // gives net worth rather than a figure that needs a footnote.
        currentBalance: `-${debt.currentBalance}`,
        currency: debt.currency,
        accountType: ACCOUNT_TYPE_FOR_DEBT[debt.kind],
        scope: debt.personId ? 'personal' : 'household',
        createdBy: session.user.id,
        ownerId: session.user.id,
        personId: debt.personId,
        ...(debt.creditLimit ? { creditLimit: debt.creditLimit } : {}),
        ...(debt.apr ? { interestRate: debt.apr } : {}),
      })
      .returning({ id: accounts.id });

    if (!account) return 'createFailed' as const;

    await tx
      .update(debts)
      .set({ accountId: account.id, updatedAt: new Date() })
      .where(and(eq(debts.id, debt.id), eq(debts.householdId, householdId)));

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  revalidateScreen(formData, 'accounts', 'documents');
  return { ok: true };
}

/**
 * El nombre de una contraparte, en la forma con que se cruza.
 *
 * Minúsculas, sin tildes y sin puntuación, que es como llega el nombre en la
 * descripción de un estado de cuenta: «GIOVANNI C. CINTIONE» y «Giovanni
 * Cintione» tienen que ser la misma cosa, o el pago no encuentra su deuda.
 */
function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
