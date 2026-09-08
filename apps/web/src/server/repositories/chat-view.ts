import 'server-only';

import type { PlainDate } from '@app/domain';

import { loadHouseholdContext } from '../household-context';
import type { Session } from '../session';

import { loadDebts, loadGoals } from './administration';
import { loadBudgets } from './budgets';
import { buildOpening, type ChatOpening, type OpeningLabels } from './chat-opening';
import { loadThread, loadThreads, type ChatMessageView, type ChatThreadView } from './chat';
import { loadPlan } from './plan';
import { loadQueueCounts } from './review';

/**
 * Everything one chat screen needs, in as few round trips as it can be had.
 *
 * The opening is only assembled when there is nothing to open — a conversation
 * already under way does not need to be told what the household owns, and
 * fetching a plan, the debts, the goals, the budgets and the review counts to
 * throw them away is five queries nobody reads.
 */

export interface ChatScreen {
  readonly threads: readonly ChatThreadView[];
  readonly thread: ChatThreadView | null;
  readonly messages: readonly ChatMessageView[];
  readonly opening: ChatOpening | null;
  readonly timeZone: string;
  readonly today: PlainDate;
}

export async function loadChatScreen(
  session: Session,
  householdId: string,
  locale: string,
  labels: OpeningLabels,
  threadId?: string,
  /** True when the person asked for a fresh conversation, not the last one. */
  fresh = false,
): Promise<ChatScreen> {
  const context = loadHouseholdContext(session, householdId, locale);
  const threads = await loadThreads(session, householdId);

  // With no thread named, the most recent one continues. Landing on a blank
  // composer when a conversation is half-finished is how a chat loses its
  // thread — literally.
  const target = fresh ? undefined : (threadId ?? threads[0]?.id);
  const found = target ? await loadThread(session, householdId, target) : null;

  if (found && found.messages.length > 0) {
    return {
      threads,
      thread: found.thread,
      messages: found.messages,
      opening: null,
      timeZone: context.timeZone,
      today: context.today,
    };
  }

  const [plan, debts, goals, budgets, queues] = await Promise.all([
    loadPlan(session, householdId),
    loadDebts(session, householdId, context.currency),
    loadGoals(session, householdId, context.currency),
    loadBudgets(session, householdId, context.currency, context.today),
    loadQueueCounts(session, householdId),
  ]);

  return {
    threads,
    thread: found?.thread ?? null,
    messages: [],
    opening: buildOpening(
      {
        currency: context.currency,
        moneyLocale: context.moneyLocale,
        today: context.today,
        plan,
        debts,
        goals,
        budgets,
        queues,
      },
      labels,
    ),
    timeZone: context.timeZone,
    today: context.today,
  };
}
