import 'server-only';

import { accounts, documents, imports, jobs } from '@app/database/schema';
import { digitsDisagree } from '@app/transaction-engine';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * One account's reading queue: the statements uploaded to it and where each
 * one is — waiting, being read, ready to review, or failed.
 *
 * Read from the jobs table, not from the browser, so it survives the person
 * closing the app: the files were already uploaded and the server keeps
 * reading them. Only this account's files, never the household's whole queue —
 * the place a person drops a card's statement is where they look for it.
 */

export interface QueueEntry {
  readonly jobId: string;
  readonly fileName: string;
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  /** 0–100, as the reader reports it. */
  readonly progress: number;
  /** The reader's stage: `reading`, `parsing`, `reading_scan`, `matching`, `ready`. */
  readonly stage: string | null;
  readonly importId: string | null;
  readonly found: number | null;
  readonly created: number | null;
  /** Whether the movements still wait for someone to confirm them. */
  readonly awaitingReview: boolean;
  readonly createdAt: string;
  /**
   * When the statement prints another account's digits: what it says, the
   * account it was uploaded to, and the household's account that matches.
   */
  readonly mismatch: {
    readonly statedDigits: string;
    readonly uploadedTo: string;
    readonly suggested: { readonly id: string; readonly name: string } | null;
  } | null;
}

/** How far back the queue looks: today's uploads, and yesterday's evening. */
const WINDOW_HOURS = 36;
const LIMIT = 15;

export async function loadStatementQueue(
  session: Session,
  householdId: string,
  accountId: string,
): Promise<readonly QueueEntry[]> {
  return (await loadStatementQueues(session, householdId, accountId)).get(accountId) ?? [];
}

/**
 * Every account's queue in one read, for the board's first paint — or one
 * account's, when `onlyAccountId` is given. Each account keeps its own list.
 */
export async function loadStatementQueues(
  session: Session,
  householdId: string,
  onlyAccountId?: string,
): Promise<ReadonlyMap<string, readonly QueueEntry[]>> {
  const grouped = await queryAsUser(session, async (tx) => {
    const rows = await tx
      .select({
        jobId: jobs.id,
        status: jobs.status,
        progress: jobs.progress,
        stage: jobs.progressNote,
        createdAt: jobs.createdAt,
        documentId: sql<string | null>`${jobs.payload}->>'documentId'`,
        fileName: sql<string | null>`${jobs.payload}->>'fileName'`,
        accountId: sql<string | null>`${jobs.payload}->>'accountId'`,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.householdId, householdId),
          eq(jobs.kind, 'statement_import'),
          onlyAccountId ? sql`${jobs.payload}->>'accountId' = ${onlyAccountId}` : undefined,
          gte(jobs.createdAt, sql`now() - make_interval(hours => ${WINDOW_HOURS})`),
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(onlyAccountId ? LIMIT : LIMIT * 8);

    if (rows.length === 0) return [];

    const runs = await tx
      .select({
        jobId: imports.jobId,
        id: imports.id,
        status: imports.status,
        found: imports.rowsFound,
        created: imports.rowsNew,
        statedDigits: imports.statedAccountDigits,
        suggestedAccountId: imports.suggestedAccountId,
        uploadedTo: accounts.name,
        onFile: accounts.maskedNumber,
      })
      .from(imports)
      .leftJoin(accounts, eq(accounts.id, imports.accountId))
      .where(
        and(
          eq(imports.householdId, householdId),
          inArray(
            imports.jobId,
            rows.map((row) => row.jobId),
          ),
        ),
      );

    // A file deleted from the history leaves the queue too.
    const removed = new Set(
      (
        await tx
          .select({ id: documents.id })
          .from(documents)
          .where(
            and(
              eq(documents.householdId, householdId),
              inArray(
                documents.id,
                rows.map((row) => row.documentId).filter((id): id is string => id !== null),
              ),
              sql`${documents.deletedAt} is not null`,
            ),
          )
      ).map((row) => row.id),
    );

    const suggestedIds = runs
      .map((run) => run.suggestedAccountId)
      .filter((id): id is string => id !== null);
    const suggestedNames = new Map(
      suggestedIds.length === 0
        ? []
        : (
            await tx
              .select({ id: accounts.id, name: accounts.name })
              .from(accounts)
              .where(inArray(accounts.id, suggestedIds))
          ).map((row) => [row.id, row.name] as const),
    );

    return rows
      .filter((row) => !row.documentId || !removed.has(row.documentId))
      .map((row) => {
        const run = runs.find((entry) => entry.jobId === row.jobId);
        return {
          accountId: row.accountId ?? '',
          jobId: row.jobId,
          fileName: row.fileName ?? '',
          status: row.status,
          progress: row.progress,
          stage: row.stage,
          importId: run?.id ?? null,
          found: run?.found ?? null,
          created: run?.created ?? null,
          awaitingReview: run?.status === 'review',
          mismatch:
            run?.statedDigits && run.uploadedTo && digitsDisagree(run.statedDigits, run.onFile)
              ? {
                  statedDigits: run.statedDigits,
                  uploadedTo: run.uploadedTo,
                  suggested: run.suggestedAccountId
                    ? {
                        id: run.suggestedAccountId,
                        name: suggestedNames.get(run.suggestedAccountId) ?? '',
                      }
                    : null,
                }
              : null,
          createdAt: row.createdAt.toISOString(),
        };
      });
  });

  const byAccount = new Map<string, QueueEntry[]>();
  for (const { accountId, ...entry } of grouped) {
    const list = byAccount.get(accountId) ?? [];
    if (list.length < LIMIT) list.push(entry);
    byAccount.set(accountId, list);
  }
  return byAccount;
}
