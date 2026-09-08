import 'server-only';

import { chatMessages, chatThreads } from '@app/database/schema';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * Conversations about a household's own money.
 *
 * A message carries the grounding it was answered from, and that is what makes
 * this readable months later. «You had $2,740 available» is a claim nobody can
 * check unless the figures the answer was allowed to use travel with it.
 *
 * Nothing here is editable. A message that can be changed after the fact is not
 * a record of what was asked or of what was answered.
 */

export interface ChatMessageView {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly body: string;
  readonly grounding: Readonly<Record<string, string>>;
  readonly ungrounded: readonly string[];
  readonly createdAt: Date;
}

export interface ChatThreadView {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: Date;
  readonly messageCount: number;
}

export async function loadThreads(
  session: Session,
  householdId: string,
): Promise<readonly ChatThreadView[]> {
  return queryAsUser(session, async (tx) => {
    const rows = await tx
      .select({
        id: chatThreads.id,
        title: chatThreads.title,
        updatedAt: chatThreads.updatedAt,
      })
      .from(chatThreads)
      .where(and(eq(chatThreads.householdId, householdId), isNull(chatThreads.deletedAt)))
      .orderBy(desc(chatThreads.updatedAt))
      .limit(30);

    if (rows.length === 0) return [];

    const counts = await tx
      .select({ threadId: chatMessages.threadId })
      .from(chatMessages)
      .where(eq(chatMessages.householdId, householdId));

    const tally = new Map<string, number>();
    for (const row of counts) {
      tally.set(row.threadId, (tally.get(row.threadId) ?? 0) + 1);
    }

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt,
      messageCount: tally.get(row.id) ?? 0,
    }));
  });
}

export async function loadThread(
  session: Session,
  householdId: string,
  threadId: string,
): Promise<{ thread: ChatThreadView; messages: readonly ChatMessageView[] } | null> {
  return queryAsUser(session, async (tx) => {
    const [thread] = await tx
      .select({ id: chatThreads.id, title: chatThreads.title, updatedAt: chatThreads.updatedAt })
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.id, threadId),
          eq(chatThreads.householdId, householdId),
          isNull(chatThreads.deletedAt),
        ),
      )
      .limit(1);

    if (!thread) return null;

    const messages = await tx
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, thread.id))
      .orderBy(asc(chatMessages.createdAt));

    return {
      thread: { ...thread, messageCount: messages.length },
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        body: message.body,
        grounding: asStringRecord(message.grounding),
        ungrounded: message.ungrounded,
        createdAt: message.createdAt,
      })),
    };
  });
}

function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, String(entry)]));
}
