import 'server-only';

import { accounts, debts, householdPeople } from '@app/database/schema';
import { Money, type CurrencyCode } from '@app/domain';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * The household's accounts.
 *
 * The list a person manages directly: what exists, what each one holds, and how
 * many movements have been filed against it. The movement count is what makes
 * an account answerable — an account with a balance and no movements is a
 * number somebody typed, and the interface should not let that pass for a
 * reconciled position.
 *
 * Liability balances are stored positive, meaning "what is owed" (see
 * `netWorth` in `@app/reporting`). The sign convention lives in one place and
 * the forms teach it rather than guessing at it.
 */

/** Balances that are money the household can actually spend. */
export const LIQUID_TYPES = ['checking', 'savings', 'cash', 'digital_wallet'] as const;

/** Balances that are owed rather than held. */
export const LIABILITY_TYPES = ['credit_card', 'loan', 'mortgage', 'other_liability'] as const;

/**
 * Every type the database accepts, in the order the form offers them: what a
 * household opens first, then what it owes, then the rest.
 */
export const ACCOUNT_TYPES = [
  'checking',
  'savings',
  'cash',
  'digital_wallet',
  'credit_card',
  'loan',
  'mortgage',
  'investment',
  'business',
  'tax_reserve',
  'other_asset',
  'other_liability',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

// Membership tests, as sets of plain strings: the column's union is wider than
// either list, and a set says "is it one of these" without an assertion.
const LIQUID_SET = new Set<string>(LIQUID_TYPES);
const LIABILITY_SET = new Set<string>(LIABILITY_TYPES);

export const ACCOUNT_TYPE_GROUPS: readonly {
  readonly key: 'liquid' | 'debt' | 'other';
  readonly types: readonly AccountType[];
}[] = [
  { key: 'liquid', types: ['checking', 'savings', 'cash', 'digital_wallet'] },
  { key: 'debt', types: ['credit_card', 'loan', 'mortgage'] },
  {
    key: 'other',
    types: ['investment', 'business', 'tax_reserve', 'other_asset', 'other_liability'],
  },
];

export interface AccountView {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly maskedNumber: string | null;
  /** Whose it is, so totals can be read per person. Null is the household's. */
  readonly personId: string | null;
  readonly balance: Money;
  readonly status: 'active' | 'closed' | 'archived';
  readonly isLiability: boolean;
  readonly isLiquid: boolean;
  readonly transactionCount: number;
}

/**
 * Lo de una persona, sumado aparte.
 *
 * Una pareja que junta las finanzas sigue teniendo dos patrimonios, y la
 * pregunta «¿cuánto es mío?» no es desconfianza: es lo que hace falta para una
 * declaración, para un crédito, para una separación de bienes y para saber
 * quién está pagando qué. El producto ya sabía de quién era cada cuenta y cada
 * deuda; lo que faltaba era sumarlo.
 *
 * `unassigned` no es una persona. Es lo que nadie asignó, y sale con nombre
 * propio en vez de repartirse: repartir por partes iguales lo que no se declaró
 * es inventarle a alguien la mitad de una deuda.
 */
export interface PersonTotals {
  /** Nulo en la fila de lo no asignado. */
  readonly personId: string | null;
  readonly name: string;
  readonly liquid: Money;
  readonly assets: Money;
  readonly liabilities: Money;
  /** Lo que queda: activos menos pasivos. Puede ser negativo, y se enseña. */
  readonly net: Money;
  readonly accountCount: number;
  readonly debtCount: number;
}

export interface AccountsView {
  readonly currency: CurrencyCode;
  readonly accounts: readonly AccountView[];
  readonly liquid: Money;
  readonly liabilities: Money;
  /**
   * El desglose por persona, del patrimonio más alto al más bajo, con lo no
   * asignado siempre al final.
   *
   * Vacío cuando el hogar tiene una sola persona y nada asignado: un desglose de
   * una fila no es un desglose, es la misma cifra otra vez.
   */
  readonly byPerson: readonly PersonTotals[];
  /** True when nothing has ever been created, so the screen can teach. */
  readonly isEmpty: boolean;
}

export async function loadAccounts(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<AccountsView> {
  return queryAsUser(session, async (tx) => {
    const rows = await tx
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.accountType,
        maskedNumber: accounts.maskedNumber,
        personId: accounts.personId,
        balance: accounts.currentBalance,
        status: accounts.status,
        // Counted in the same query rather than per row: a household with
        // twenty accounts should not cost twenty round trips.
        transactionCount: sql<number>`(
          select count(*)::int from app.transactions t
          where t.account_id = ${accounts.id} and t.deleted_at is null
        )`,
      })
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), isNull(accounts.deletedAt)))
      .orderBy(desc(accounts.status), accounts.createdAt);

    const views: AccountView[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      maskedNumber: row.maskedNumber,
      personId: row.personId,
      balance: Money.fromDecimalString(row.balance, currency),
      status: row.status,
      isLiability: LIABILITY_SET.has(row.type),
      isLiquid: LIQUID_SET.has(row.type),
      transactionCount: row.transactionCount,
    }));

    const active = views.filter((view) => view.status === 'active');

    const [people, debtRows] = await Promise.all([
      tx
        .select({ id: householdPeople.id, name: householdPeople.displayName })
        .from(householdPeople)
        .where(eq(householdPeople.householdId, householdId)),
      tx
        .select({ personId: debts.personId, balance: debts.currentBalance })
        .from(debts)
        .where(and(eq(debts.householdId, householdId), isNull(debts.deletedAt))),
    ]);

    return {
      currency,
      accounts: views,
      byPerson: totalsByPerson({ accounts: active, debts: debtRows, people, currency }),
      liquid: Money.sum(
        active.filter((view) => view.isLiquid).map((view) => view.balance),
        currency,
      ),
      liabilities: Money.sum(
        active.filter((view) => view.isLiability).map((view) => view.balance.abs()),
        currency,
      ),
      isEmpty: views.length === 0,
    };
  });
}

/**
 * Suma cuentas y deudas por dueño.
 *
 * Las deudas van aparte de las cuentas de pasivo a propósito: una tarjeta puede
 * existir como cuenta —para conciliar sus movimientos— y como deuda —para que el
 * motor la ataque—, y sumar las dos contaría el mismo saldo dos veces. Aquí las
 * cuentas aportan lo que se tiene y las deudas lo que se debe, que es la única
 * lectura en la que ninguna cifra se repite.
 */
export function totalsByPerson(input: {
  accounts: readonly AccountView[];
  debts: readonly { personId: string | null; balance: string }[];
  people: readonly { id: string; name: string }[];
  currency: CurrencyCode;
}): PersonTotals[] {
  const { currency } = input;
  const zero = Money.zero(currency);

  interface Bucket {
    liquid: Money;
    assets: Money;
    liabilities: Money;
    accountCount: number;
    debtCount: number;
  }

  const buckets = new Map<string, Bucket>();
  const bucketFor = (personId: string | null): Bucket => {
    const key = personId ?? '';
    const found = buckets.get(key);
    if (found) return found;
    const fresh: Bucket = {
      liquid: zero,
      assets: zero,
      liabilities: zero,
      accountCount: 0,
      debtCount: 0,
    };
    buckets.set(key, fresh);
    return fresh;
  };

  for (const account of input.accounts) {
    const bucket = bucketFor(account.personId);
    bucket.accountCount += 1;
    if (account.isLiability) {
      bucket.liabilities = bucket.liabilities.add(account.balance.abs());
    } else {
      bucket.assets = bucket.assets.add(account.balance);
      if (account.isLiquid) bucket.liquid = bucket.liquid.add(account.balance);
    }
  }

  for (const debt of input.debts) {
    const bucket = bucketFor(debt.personId);
    bucket.debtCount += 1;
    bucket.liabilities = bucket.liabilities.add(
      Money.fromDecimalString(debt.balance, currency).abs(),
    );
  }

  const named = new Map(input.people.map((person) => [person.id, person.name]));

  const totals: PersonTotals[] = [...buckets.entries()].map(([key, bucket]) => ({
    personId: key === '' ? null : key,
    // Una persona borrada del hogar cuyas filas siguen apuntando a ella no puede
    // dejar una fila sin nombre: se cae en la etiqueta de lo no asignado, que es
    // literalmente lo que es a partir de ese momento.
    name: key === '' ? 'unassigned' : (named.get(key) ?? 'unassigned'),
    liquid: bucket.liquid,
    assets: bucket.assets,
    liabilities: bucket.liabilities,
    net: bucket.assets.subtract(bucket.liabilities),
    accountCount: bucket.accountCount,
    debtCount: bucket.debtCount,
  }));

  // Un desglose de una sola fila no es un desglose.
  if (totals.length <= 1) return [];

  return totals.sort((a, b) => {
    // Lo no asignado siempre al final: no compite con una persona por posición.
    if (a.personId === null) return 1;
    if (b.personId === null) return -1;
    return b.net.compare(a.net);
  });
}
