import 'server-only';

import {
  accounts,
  householdMembers,
  householdPeople,
  imports,
  institutions,
} from '@app/database/schema';
import { findCoverageGaps, type AccountActivity } from '@app/transaction-engine';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';
import { loadStatementQueues, type QueueEntry } from './statement-queue';

/**
 * Gastos familiares: every account and card in the house, under the person it
 * belongs to, each one a place to drop that account's statement.
 *
 * The shape follows the question a person holding a phone is asking — «whose
 * is this, and which one» — so it is people first, then accounts and cards,
 * and each account says what it is still owed: months without a statement,
 * files being read, files waiting for review.
 *
 * Both partners see everything (the household decided so); the person looking
 * comes first, because their own statements are the ones in their hand.
 */

export type AccountKind = 'bank' | 'card';

export interface BoardAccount {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly kind: AccountKind;
  readonly maskedNumber: string | null;
  readonly institutionName: string | null;
  /** `YYYY-MM` of the most recent month with movements, or null if none ever. */
  readonly latestMonth: string | null;
  /** Months before this one with no movements since the first statement. */
  readonly missingMonths: readonly string[];
  /** Imports still being read. */
  readonly reading: number;
  /** Imports read and waiting for someone to confirm them. */
  readonly toReview: readonly { readonly importId: string; readonly rows: number }[];
  /** This account's own reading queue: what was uploaded and where each file is. */
  readonly queue: readonly QueueEntry[];
}

export interface BoardPerson {
  /** Null for the household's shared accounts. */
  readonly personId: string | null;
  readonly name: string | null;
  readonly isViewer: boolean;
  readonly accounts: readonly BoardAccount[];
  readonly cards: readonly BoardAccount[];
}

export interface FamilyBoard {
  readonly people: readonly BoardPerson[];
  /** Everyone who can own an account, for the «whose is it?» choice. */
  readonly owners: readonly { readonly id: string; readonly name: string }[];
  readonly totalAccounts: number;
}

const OPEN_IMPORTS = ['uploaded', 'parsing', 'importing', 'review'] as const;

export async function loadFamilyBoard(
  session: Session,
  householdId: string,
  currentMonth: string,
): Promise<FamilyBoard> {
  const [people, rows, open] = await queryAsUser(session, async (tx) => {
    const people = await tx
      .select({
        id: householdPeople.id,
        name: householdPeople.displayName,
        relationship: householdPeople.relationship,
        userId: householdMembers.userId,
      })
      .from(householdPeople)
      .leftJoin(householdMembers, eq(householdMembers.id, householdPeople.memberId))
      .where(and(eq(householdPeople.householdId, householdId), isNull(householdPeople.deletedAt)))
      .orderBy(asc(householdPeople.createdAt));

    const rows = await tx
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.accountType,
        maskedNumber: accounts.maskedNumber,
        personId: accounts.personId,
        institutionName: institutions.name,
        months: sql<string[]>`coalesce((
          select array_agg(distinct to_char(t.transaction_date, 'YYYY-MM'))
          from app.transactions t
          where t.account_id = app.accounts.id
            and t.deleted_at is null
        ), '{}')`,
      })
      .from(accounts)
      .leftJoin(institutions, eq(institutions.id, accounts.institutionId))
      .where(
        and(
          eq(accounts.householdId, householdId),
          eq(accounts.status, 'active'),
          isNull(accounts.deletedAt),
        ),
      )
      .orderBy(asc(accounts.name));

    const open = await tx
      .select({
        id: imports.id,
        accountId: imports.accountId,
        status: imports.status,
        rows: imports.rowsFound,
      })
      .from(imports)
      .where(and(eq(imports.householdId, householdId), inArray(imports.status, [...OPEN_IMPORTS])));

    return [people, rows, open] as const;
  });

  const queues = await loadStatementQueues(session, householdId);

  const activity: AccountActivity[] = rows.map((row) => ({
    accountId: row.id,
    name: row.name,
    maskedNumber: row.maskedNumber,
    kind: row.type === 'credit_card' ? 'card' : 'bank',
    monthsSeen: row.months,
  }));
  const coverage = findCoverageGaps(activity, currentMonth);
  const missingBy = new Map(coverage.gaps.map((gap) => [gap.accountId, gap.missing]));

  const toAccount = (row: (typeof rows)[number]): BoardAccount => {
    const mine = open.filter((entry) => entry.accountId === row.id);
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      kind: row.type === 'credit_card' ? 'card' : 'bank',
      maskedNumber: row.maskedNumber,
      institutionName: row.institutionName,
      latestMonth: [...row.months].sort().at(-1) ?? null,
      missingMonths: missingBy.get(row.id) ?? [],
      reading: mine.filter((entry) => entry.status !== 'review').length,
      toReview: mine
        .filter((entry) => entry.status === 'review')
        .map((entry) => ({ importId: entry.id, rows: entry.rows })),
      queue: queues.get(row.id) ?? [],
    };
  };

  // The person looking: the one their login is linked to, or — for the owner
  // who has not linked themselves yet — the one they described as «self».
  const viewerRole = session.households.find((h) => h.id === householdId)?.role;
  const linked = people.find((person) => person.userId === session.user.id);
  const viewerId =
    linked?.id ??
    (viewerRole === 'owner'
      ? people.find((person) => person.relationship === 'self' && person.userId === null)?.id
      : undefined);

  const ordered = [
    ...people.filter((person) => person.id === viewerId),
    ...people.filter((person) => person.id !== viewerId),
  ];

  const split = (personId: string | null) => {
    const owned = rows.filter((row) => row.personId === personId).map(toAccount);
    return {
      accounts: owned.filter((account) => account.kind === 'bank'),
      cards: owned.filter((account) => account.kind === 'card'),
    };
  };

  const known = new Set(people.map((person) => person.id));
  const shared = rows
    .filter((row) => row.personId === null || !known.has(row.personId))
    .map(toAccount);

  const board: BoardPerson[] = ordered.map((person) => ({
    personId: person.id,
    name: person.name,
    isViewer: person.id === viewerId,
    ...split(person.id),
  }));

  if (shared.length > 0) {
    board.push({
      personId: null,
      name: null,
      isViewer: false,
      accounts: shared.filter((account) => account.kind === 'bank'),
      cards: shared.filter((account) => account.kind === 'card'),
    });
  }

  return {
    people: board,
    owners: people.map((person) => ({ id: person.id, name: person.name })),
    totalAccounts: rows.length,
  };
}
