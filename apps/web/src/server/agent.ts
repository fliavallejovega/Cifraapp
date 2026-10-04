import 'server-only';

import { AGENT_ANSWER_V1, AGENT_ROUTE_V1, type PromptLocale } from '@app/ai';
import {
  accounts,
  categories,
  obligations,
  transactions,
  tripLegs,
  trips,
} from '@app/database/schema';
import { formatMoney, Money, type CurrencyCode } from '@app/domain';
import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm';

import { findTripGaps } from '../lib/trip-gaps';
import { ask } from './ai';
import { loadHouseholdContext } from './household-context';
import { loadFamilyBoard } from './repositories/family-expenses';
import { loadPlan } from './repositories/plan';
import { queryAsUser, type Session } from './session';

/**
 * The assistant, one message at a time.
 *
 * Two calls, and code between them. The first asks the model which read-only
 * lookups would answer the message — from a closed list, with the filters a
 * person would type. Code runs those lookups against the household's own data,
 * under its own row-level security. The second call answers from what the
 * lookups returned, and may propose changes from a closed catalogue.
 *
 * Nothing the model says is trusted as data:
 *
 *   - Every figure in the answer must already be in the facts it was handed;
 *     the guardrail strikes the answer otherwise.
 *   - Every proposed change is checked here against the ids the lookups
 *     returned and the values the catalogue allows. A row that names something
 *     the household does not have is dropped, not repaired.
 *   - Nothing is written. A proposal waits for a person to tap «Aplicar», and
 *     the apply path checks it again against the database at that moment.
 */

export type AgentScope =
  { readonly kind: 'finances' } | { readonly kind: 'trip'; readonly tripId: string };

export type ProposalKind =
  | 'recategorize_movement'
  | 'set_account_owner'
  | 'set_leg_dates'
  | 'set_leg_lodging'
  | 'record_movement'
  | 'set_commitment_amount';

export interface AgentProposal {
  readonly kind: ProposalKind;
  readonly target: string;
  readonly value: string;
  readonly reason: string;
  /** What will change, in the household's words, built here — not by the model. */
  readonly label: string;
  readonly status: 'proposed' | 'applied' | 'discarded';
}

export interface AgentTurn {
  readonly answer: string;
  readonly proposals: readonly AgentProposal[];
  readonly grounding: Readonly<Record<string, string>>;
  readonly failure: string | null;
}

const LODGING_MODES = ['prepaid', 'pay_on_site', 'none', 'undecided'] as const;
const MAX_MOVEMENTS = 25;

/** What the lookups found, kept so proposals can be checked against it. */
interface Known {
  movements: Map<string, string>;
  categories: Map<string, string>;
  accounts: Map<string, string>;
  people: Map<string, string>;
  legs: Map<string, { city: string; tripId: string }>;
  tripWindow: { start: string; end: string } | null;
  commitments: Map<string, string>;
  today: string;
}

export async function runAgentTurn(
  session: Session,
  householdId: string,
  input: {
    readonly message: string;
    readonly scope: AgentScope;
    readonly conversation: string;
    readonly locale: 'es' | 'en';
  },
): Promise<AgentTurn> {
  const promptLocale: PromptLocale = input.locale;
  const context = loadHouseholdContext(session, householdId, input.locale);
  const money = (value: Money) => formatMoney(value, { locale: context.moneyLocale });
  const scopeText =
    input.scope.kind === 'trip'
      ? `a trip is open (trip id ${input.scope.tripId})`
      : 'household finances';

  const base: Record<string, string> = {
    message: input.message,
    scope: scopeText,
    today: context.today,
    conversation: input.conversation || 'none',
  };

  // Years and days of the month: what a date the router writes is made of.
  const dateParts = [
    context.today.slice(0, 4),
    String(Number(context.today.slice(0, 4)) - 1),
    String(Number(context.today.slice(0, 4)) + 1),
    ...Array.from({ length: 31 }, (_, i) => String(i + 1)),
  ];

  const route = await ask(session, householdId, {
    prompt: AGENT_ROUTE_V1,
    locale: promptLocale,
    currency: context.currency,
    grounding: base,
    guardrail: { allow: dateParts },
  });

  const lookups = route.ok ? readLookups(route.value.output['lookups']) : [];
  if (input.scope.kind === 'trip' && !lookups.some((l) => l.lookup === 'trip')) {
    // In a trip, the trip is always on the table: «¿qué me falta?» needs it.
    lookups.unshift({ lookup: 'trip', text: '', from: '', to: '', month: '' });
  }

  const known: Known = {
    movements: new Map(),
    categories: new Map(),
    accounts: new Map(),
    people: new Map(),
    legs: new Map(),
    tripWindow: null,
    commitments: new Map(),
    today: context.today,
  };

  const plan = await loadPlan(session, householdId);
  const facts: Record<string, string> = {
    ...base,
    available: money(plan.safeToSpend.safeToSpend),
    liquid: money(plan.safeToSpend.liquid),
    committed: money(plan.safeToSpend.totalClaimed),
  };

  for (const lookup of lookups.slice(0, 3)) {
    if (lookup.lookup === 'movements') {
      facts['movements'] = await lookupMovements(
        session,
        householdId,
        lookup,
        context.currency,
        money,
        known,
      );
      facts['categories'] = await lookupCategories(session, householdId, known);
    }
    if (lookup.lookup === 'spending_by_category') {
      const month = /^\d{4}-\d{2}$/.test(lookup.month) ? lookup.month : context.today.slice(0, 7);
      facts[`spending ${month}`] = await lookupSpending(
        session,
        householdId,
        month,
        context.currency,
        money,
      );
    }
    if (lookup.lookup === 'accounts') {
      facts['accounts'] = await lookupAccounts(
        session,
        householdId,
        context.today.slice(0, 7),
        known,
      );
    }
    if (lookup.lookup === 'trip' && input.scope.kind === 'trip') {
      facts['trip'] = await lookupTrip(session, householdId, input.scope.tripId, known);
    }
  }

  /*
    Lo que la casa dice que pasó o cambió —«gasté 20 en el súper», «el alquiler
    subió a 900»— necesita saber en qué cuenta y qué compromiso. Las cuentas y
    los compromisos van siempre, así el asistente puede armar el cambio y la
    persona sólo toca Aplicar.
  */
  if (input.scope.kind === 'finances') {
    facts['accounts'] ??= await lookupAccounts(
      session,
      householdId,
      context.today.slice(0, 7),
      known,
    );
    facts['commitments'] = await lookupCommitments(session, householdId, money, known);
  }

  const tripDays = known.tripWindow ? calendar(known.tripWindow.start, known.tripWindow.end) : [];

  const answer = await ask(session, householdId, {
    prompt: AGENT_ANSWER_V1,
    locale: promptLocale,
    currency: context.currency,
    grounding: facts,
    guardrail: { allow: tripDays },
    timeoutMs: 45_000,
  });

  if (!answer.ok) {
    return {
      answer: declineText(answer.error.kind, input.locale),
      proposals: [],
      grounding: facts,
      failure: answer.error.kind,
    };
  }

  const text = answer.value.output['answer'];
  return {
    answer:
      typeof text === 'string' && text.trim() !== ''
        ? text.trim()
        : declineText('malformed_output', input.locale),
    proposals: validateProposals(answer.value.output['proposals'], known, input.locale),
    grounding: facts,
    failure: null,
  };
}

interface Lookup {
  lookup: 'movements' | 'spending_by_category' | 'accounts' | 'trip';
  text: string;
  from: string;
  to: string;
  month: string;
}

function readLookups(raw: unknown): Lookup[] {
  if (!Array.isArray(raw)) return [];
  const out: Lookup[] = [];
  for (const row of raw as Record<string, unknown>[]) {
    const lookup = row['lookup'];
    if (
      lookup !== 'movements' &&
      lookup !== 'spending_by_category' &&
      lookup !== 'accounts' &&
      lookup !== 'trip'
    )
      continue;
    const str = (key: string): string => {
      const value = row[key];
      return typeof value === 'string' ? value.trim() : '';
    };
    out.push({ lookup, text: str('text'), from: str('from'), to: str('to'), month: str('month') });
  }
  return out;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function lookupMovements(
  session: Session,
  householdId: string,
  lookup: Lookup,
  currency: CurrencyCode,
  money: (value: Money) => string,
  known: Known,
): Promise<string> {
  const words = lookup.text.replace(/[%_\\]/g, '').slice(0, 60);
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: transactions.id,
        date: transactions.transactionDate,
        description: transactions.descriptionOriginal,
        amount: transactions.amount,
        direction: transactions.direction,
        category: categories.name,
        account: accounts.name,
      })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          isNull(transactions.deletedAt),
          words
            ? or(
                ilike(transactions.descriptionOriginal, `%${words}%`),
                ilike(transactions.descriptionNormalized, `%${words}%`),
              )
            : undefined,
          DATE.test(lookup.from) ? gte(transactions.transactionDate, lookup.from) : undefined,
          DATE.test(lookup.to) ? lte(transactions.transactionDate, lookup.to) : undefined,
        ),
      )
      .orderBy(desc(transactions.transactionDate))
      .limit(MAX_MOVEMENTS),
  );
  if (rows.length === 0) return 'no movements match';
  return rows
    .map((row) => {
      known.movements.set(row.id, row.description);
      const amount = money(Money.fromDecimalString(row.amount, currency).abs());
      return `${row.id} | ${row.date} | ${row.description} | ${row.direction === 'inflow' ? 'in' : 'out'} ${amount} | category: ${row.category ?? 'none'} | account: ${row.account}`;
    })
    .join('\n');
}

async function lookupCommitments(
  session: Session,
  householdId: string,
  money: (value: Money) => string,
  known: Known,
): Promise<string> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: obligations.id,
        name: obligations.name,
        amount: obligations.expectedAmount,
        currency: obligations.currency,
        frequency: obligations.frequency,
      })
      .from(obligations)
      .where(and(eq(obligations.householdId, householdId), isNull(obligations.deletedAt)))
      .orderBy(asc(obligations.name))
      .limit(60),
  );
  return rows
    .map((row) => {
      known.commitments.set(row.id, row.name);
      const amount = money(
        Money.fromDecimalString(row.amount, row.currency.trim() === 'PAB' ? 'PAB' : 'USD'),
      );
      return `commitment ${row.id} | ${row.name} | ${amount} | ${row.frequency ?? 'monthly'}`;
    })
    .join('\n');
}

async function lookupCategories(
  session: Session,
  householdId: string,
  known: Known,
): Promise<string> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({ id: categories.id, name: categories.name, kind: categories.kind })
      .from(categories)
      .where(and(eq(categories.householdId, householdId), isNull(categories.archivedAt)))
      .orderBy(asc(categories.name))
      .limit(120),
  );
  return rows
    .map((row) => {
      known.categories.set(row.id, row.name);
      return `${row.id} | ${row.name} | ${row.kind}`;
    })
    .join('\n');
}

async function lookupSpending(
  session: Session,
  householdId: string,
  month: string,
  currency: CurrencyCode,
  money: (value: Money) => string,
): Promise<string> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        category: sql<string>`coalesce(${categories.name}, 'sin rubro')`,
        total: sql<string>`sum(${transactions.amount})::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          isNull(transactions.deletedAt),
          eq(transactions.direction, 'outflow'),
          eq(transactions.status, 'posted'),
          sql`to_char(${transactions.transactionDate}, 'YYYY-MM') = ${month}`,
        ),
      )
      .groupBy(sql`coalesce(${categories.name}, 'sin rubro')`)
      .orderBy(sql`sum(${transactions.amount}) asc`),
  );
  if (rows.length === 0) return 'no spending recorded that month';
  return rows
    .map(
      (row) =>
        `${row.category}: ${money(Money.fromDecimalString(row.total, currency).abs())} in ${String(row.count)} movements`,
    )
    .join('\n');
}

async function lookupAccounts(
  session: Session,
  householdId: string,
  currentMonth: string,
  known: Known,
): Promise<string> {
  const board = await loadFamilyBoard(session, householdId, currentMonth);
  board.owners.forEach((owner) => known.people.set(owner.id, owner.name));
  const lines: string[] = board.owners.map((owner) => `person ${owner.id} | ${owner.name}`);
  for (const person of board.people) {
    for (const account of [...person.accounts, ...person.cards]) {
      known.accounts.set(account.id, account.name);
      lines.push(
        [
          `account ${account.id}`,
          account.name,
          account.maskedNumber ? `ending ${account.maskedNumber}` : 'no digits',
          account.kind === 'card' ? 'card' : 'bank account',
          `owner: ${person.name ?? 'household (shared)'}`,
          account.latestMonth
            ? `statements through ${account.latestMonth}`
            : 'no statement ever uploaded',
          account.missingMonths.length > 0 ? `missing ${account.missingMonths.join(', ')}` : '',
          account.toReview.length > 0
            ? `${String(account.toReview.length)} imports waiting for review`
            : '',
        ]
          .filter(Boolean)
          .join(' | '),
      );
    }
  }
  return lines.join('\n');
}

async function lookupTrip(
  session: Session,
  householdId: string,
  tripId: string,
  known: Known,
): Promise<string> {
  const data = await queryAsUser(session, async (tx) => {
    const [trip] = await tx
      .select({ name: trips.name, start: trips.startDate, end: trips.endDate })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.householdId, householdId)))
      .limit(1);
    if (!trip) return null;
    const legs = await tx
      .select({
        id: tripLegs.id,
        city: tripLegs.city,
        arrivalDate: tripLegs.arrivalDate,
        departureDate: tripLegs.departureDate,
        lodgingMode: tripLegs.lodgingMode,
      })
      .from(tripLegs)
      .where(eq(tripLegs.tripId, tripId))
      .orderBy(asc(tripLegs.arrivalDate));
    return { trip, legs };
  });
  if (!data) return 'trip not found';

  known.tripWindow = { start: data.trip.start, end: data.trip.end };
  const lines = [`trip: ${data.trip.name}, ${data.trip.start} to ${data.trip.end}`];
  for (const leg of data.legs) {
    known.legs.set(leg.id, { city: leg.city, tripId });
    lines.push(
      `leg ${leg.id} | ${leg.city} | ${leg.arrivalDate} to ${leg.departureDate} | lodging: ${leg.lodgingMode}`,
    );
  }
  const gaps = findTripGaps({ startDate: data.trip.start, endDate: data.trip.end }, data.legs);
  lines.push(
    gaps.length === 0
      ? 'gaps: none'
      : `gaps: ${gaps
          .map((g) =>
            g.kind === 'no_city'
              ? `nights ${g.from} to ${g.to} have no city`
              : `${g.city} ${g.from} to ${g.to} has no lodging`,
          )
          .join('; ')}`,
  );
  return lines.join('\n');
}

/** Every rule a proposed change must satisfy before a person even sees it. */
export function validateProposals(
  raw: unknown,
  known: Known,
  locale: 'es' | 'en',
): AgentProposal[] {
  if (!Array.isArray(raw)) return [];
  const es = locale === 'es';
  const out: AgentProposal[] = [];
  for (const row of (raw as Record<string, unknown>[]).slice(0, 5)) {
    const kind = row['kind'];
    const target = typeof row['target'] === 'string' ? row['target'].trim() : '';
    const value = typeof row['value'] === 'string' ? row['value'].trim() : '';
    const reason = typeof row['reason'] === 'string' ? row['reason'].trim().slice(0, 160) : '';
    let label: string | null = null;

    if (kind === 'recategorize_movement') {
      const movement = known.movements.get(target);
      const category = known.categories.get(value);
      if (movement && category) {
        label = es ? `Pasar «${movement}» a ${category}` : `Move “${movement}” to ${category}`;
      }
    }
    if (kind === 'set_account_owner') {
      const account = known.accounts.get(target);
      const person =
        value === 'household' ? (es ? 'la casa' : 'the household') : known.people.get(value);
      if (account && person)
        label = es ? `${account} es de ${person}` : `${account} belongs to ${person}`;
    }
    if (kind === 'set_leg_dates') {
      const leg = known.legs.get(target);
      const [from = '', to = ''] = value.split('..');
      const window = known.tripWindow;
      if (
        leg &&
        window &&
        DATE.test(from) &&
        DATE.test(to) &&
        from < to &&
        from >= window.start &&
        to <= window.end
      ) {
        label = es ? `${leg.city}: del ${from} al ${to}` : `${leg.city}: ${from} to ${to}`;
      }
    }
    if (kind === 'set_leg_lodging') {
      const leg = known.legs.get(target);
      if (leg && (LODGING_MODES as readonly string[]).includes(value)) {
        const names: Record<string, [string, string]> = {
          prepaid: ['hospedaje pagado', 'lodging prepaid'],
          pay_on_site: ['hospedaje se paga allá', 'lodging paid on site'],
          none: ['sin hospedaje (no hace falta)', 'no lodging needed'],
          undecided: ['hospedaje por decidir', 'lodging undecided'],
        };
        label = `${leg.city}: ${names[value]?.[es ? 0 : 1] ?? value}`;
      }
    }

    if (kind === 'record_movement') {
      const account = known.accounts.get(target);
      const [amountText = '', date = '', ...rest] = value.split('|');
      const description = rest.join('|').trim().slice(0, 80);
      if (
        account &&
        /^-?\d{1,9}(\.\d{1,2})?$/.test(amountText) &&
        Number(amountText) !== 0 &&
        DATE.test(date) &&
        date <= known.today &&
        description !== ''
      ) {
        const spent = amountText.startsWith('-');
        const shown = amountText.replace('-', '');
        label = es
          ? `${spent ? 'Registrar gasto' : 'Registrar ingreso'} de ${shown} · ${description} · ${account} · ${date}`
          : `${spent ? 'Record spending' : 'Record income'} of ${shown} · ${description} · ${account} · ${date}`;
      }
    }
    if (kind === 'set_commitment_amount') {
      const commitment = known.commitments.get(target);
      if (commitment && /^\d{1,9}(\.\d{1,2})?$/.test(value) && Number(value) > 0) {
        label = es ? `${commitment} pasa a ${value}` : `${commitment} becomes ${value}`;
      }
    }

    if (label && !out.some((p) => p.kind === kind && p.target === target)) {
      out.push({ kind: kind as ProposalKind, target, value, reason, label, status: 'proposed' });
    }
  }
  return out;
}

function calendar(start: string, end: string): string[] {
  const out: string[] = [];
  const [y = 0, m = 1, d = 1] = start.split('-').map(Number);
  for (let i = 0; i < 400; i += 1) {
    const day = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    if (day > end) break;
    out.push(day);
  }
  return out;
}

function declineText(kind: string, locale: 'es' | 'en'): string {
  if (locale === 'en') {
    if (kind === 'budget_exhausted')
      return 'This month’s assistant budget is used up. Every figure on your screens is unaffected.';
    if (kind === 'not_configured') return 'The assistant is not set up yet.';
    if (kind === 'ungrounded_figures' || kind === 'malformed_output' || kind === 'refused') {
      return 'I could not answer that without inventing a figure, so I did not. Try asking it another way.';
    }
    return 'I could not reach the assistant just now. Try again in a moment.';
  }
  if (kind === 'budget_exhausted')
    return 'Se acabó el presupuesto del asistente de este mes. Las cifras de tus pantallas no cambian.';
  if (kind === 'not_configured') return 'El asistente todavía no está configurado.';
  if (kind === 'ungrounded_figures' || kind === 'malformed_output' || kind === 'refused') {
    return 'No pude responder sin inventar una cifra, así que no respondí. Prueba preguntándolo de otra forma.';
  }
  return 'No pude comunicarme con el asistente ahora. Intenta de nuevo en un momento.';
}

export type { Known as AgentKnown };
