import type { Money, PlainDate } from '@app/domain';

/**
 * The facts a rule is allowed to ask about.
 *
 * This catalogue *is* the sandbox. A rule cannot name a property path, a table,
 * a column or a function — it can only reference a key that appears here, and
 * the caller decides what each key contains before evaluation begins. There is
 * no expression to evaluate and nothing to escape from, because nothing in a
 * rule is ever executed (spec §110).
 *
 * Adding a fact is a deliberate act: it widens what customer-authored rules can
 * see, which is exactly the decision that should require a code change and a
 * review rather than a row in a table.
 */

export type FactKind = 'money' | 'number' | 'text' | 'boolean' | 'date';

/**
 * Keys ending in `.*` are families: the segment after the prefix names one of
 * the household's own records, so `goal.balance.emergency-fund` asks about a
 * specific goal without letting the rule reach anywhere else.
 */
export const FACT_CATALOGUE = {
  // Position
  'position.liquid': 'money',
  'position.available': 'money',
  'position.safe_to_spend': 'money',
  'position.buffer_minimum': 'money',
  'position.runway_months': 'number',

  // Incoming money, when a rule is evaluated against an arrival
  'income.amount': 'money',
  'income.type': 'text',
  'income.is_recurring': 'boolean',
  'income.date': 'date',

  // Goals
  'goal.balance': 'money',
  'goal.target': 'money',
  'goal.progress': 'number',

  // Debt
  'debt.balance': 'money',
  'debt.apr': 'number',
  'debt.utilization': 'number',
  'debt.minimum_payment': 'money',
  'debt.total_balance': 'money',

  // Budgets
  'budget.remaining': 'money',
  'budget.projected_over': 'boolean',

  // Tax
  'tax.reserve_balance': 'money',
  'tax.reserve_shortfall': 'money',

  // The transaction being classified, when a rule runs against one
  'transaction.amount': 'money',
  'transaction.direction': 'text',
  'transaction.merchant': 'text',
  'transaction.category': 'text',
  'transaction.scope': 'text',
} as const satisfies Record<string, FactKind>;

export type FactKey = keyof typeof FACT_CATALOGUE;

/** Facts that may be scoped to one named record, e.g. `goal.balance.travel`. */
const SCOPABLE_PREFIXES = [
  'goal.balance',
  'goal.target',
  'goal.progress',
  'debt.balance',
  'debt.apr',
  'debt.utilization',
  'debt.minimum_payment',
  'budget.remaining',
  'budget.projected_over',
] as const;

export type FactValue =
  | { readonly kind: 'money'; readonly value: Money }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'date'; readonly value: PlainDate };

export type FactSet = ReadonlyMap<string, FactValue>;

/**
 * Resolves a reference to the catalogue entry it names, or null.
 *
 * A scoped reference (`goal.balance.emergency-fund`) resolves to the kind of its
 * base fact. An unrecognized reference resolves to nothing at all — it is
 * rejected at validation time and can never reach evaluation.
 */
export function factKind(reference: string): FactKind | null {
  const direct = (FACT_CATALOGUE as Record<string, FactKind | undefined>)[reference];
  if (direct) return direct;

  for (const prefix of SCOPABLE_PREFIXES) {
    if (reference.startsWith(`${prefix}.`) && reference.length > prefix.length + 1) {
      return FACT_CATALOGUE[prefix];
    }
  }

  return null;
}

export function isKnownFact(reference: string): boolean {
  return factKind(reference) !== null;
}

/** Every reference a rule may legally name, for a builder's field list. */
export function listFacts(): { reference: FactKey; kind: FactKind }[] {
  return Object.entries(FACT_CATALOGUE).map(([reference, kind]) => ({
    reference: reference as FactKey,
    kind,
  }));
}
