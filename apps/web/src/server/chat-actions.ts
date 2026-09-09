'use server';

import { QUESTION_ANSWER_V1, type PromptLocale } from '@app/ai';
import type { DeductionKind } from '@app/budget-engine';
import { chatMessages, chatThreads } from '@app/database/schema';
import { formatMoney, type Money } from '@app/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ask, copilotIsConfigured } from './ai';
import { loadHouseholdContext } from './household-context';
import { loadDebts, loadGoals } from './repositories/administration';
import { loadThread } from './repositories/chat';
import { conversationGrounding } from './repositories/chat-opening';
import { loadPlan } from './repositories/plan';
import { localeOf } from './revalidate';
import { loadSession, queryAsUser } from './session';

/**
 * Asking the system about your own finances.
 *
 * The question is a person's; every figure the answer may use is the product's,
 * assembled here from the same readers the screens use. The model never queries
 * anything — it is handed a fixed set of facts and told that a partial answer
 * built on an assumption is worse than none.
 *
 * What is stored is the whole exchange *and* the grounding. Without the second,
 * an answer read in March is a claim nobody can check against anything, which
 * is precisely the failure mode the product exists to avoid.
 *
 * The thread's earlier turns travel with every question, which is what makes
 * this a conversation rather than a row of unrelated answers. Until it did, «and
 * what if I pay $300 instead» was a question the assistant could not understand,
 * because it had never seen the one before it.
 *
 * Feeding prior answers back is safe for one specific reason: every stored
 * answer already passed the guardrail when it was produced, so no figure in the
 * history is one the product could not verify. The household's current figures
 * are sent alongside regardless, so the authoritative set is always present.
 */

export interface ChatResult {
  readonly error?: string;
  readonly threadId?: string;
  readonly ok?: true;
}

/**
 * What each claim against the money is called, in the facts block.
 *
 * English, like every other grounding name: the facts are the model's input,
 * not the household's screen. What the household reads is the answer, written
 * in their own language from these.
 */
const DEDUCTION_LABELS: Record<DeductionKind, string> = {
  committed: 'already-committed spending',
  obligations: 'bills due in the horizon',
  debt_minimums: 'minimum debt payments',
  tax_reserve: 'tax reserve',
  goals: 'goal contributions',
  buffer: 'safety buffer',
};

const questionInput = z.object({
  question: z.string().trim().min(3).max(500),
  threadId: z.preprocess(
    (value) => (value === '' || value === undefined || value === null ? undefined : value),
    z.uuid().optional(),
  ),
});

export async function askQuestion(_previous: ChatResult, formData: FormData): Promise<ChatResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  if (!copilotIsConfigured()) return { error: 'copilotOff' };

  const parsed = questionInput.safeParse({
    question: formData.get('question'),
    threadId: formData.get('threadId'),
  });

  if (!parsed.success) return { error: 'questionRequired' };

  const householdId = session.activeHouseholdId;
  const locale = localeOf(formData);
  const promptLocale: PromptLocale = locale === 'en' ? 'en' : 'es';

  const context = loadHouseholdContext(session, householdId, locale);
  const [plan, debts, goals, priorTurns] = await Promise.all([
    loadPlan(session, householdId),
    loadDebts(session, householdId, context.currency),
    loadGoals(session, householdId, context.currency),
    parsed.data.threadId
      ? loadThread(session, householdId, parsed.data.threadId)
      : Promise.resolve(null),
  ]);

  const money = (value: Money) => formatMoney(value, { locale: context.moneyLocale });

  const grounding: Record<string, string> = {
    question: parsed.data.question,
    today: context.today,
    available: money(plan.safeToSpend.safeToSpend),
    liquid: money(plan.safeToSpend.liquid),
    committed: money(plan.safeToSpend.totalClaimed),
    // The total on its own cannot answer the question people actually ask,
    // which is «why that much». Somebody looking at $1,265 of committed money
    // wants to know it is the sum of five minimum payments, not a figure the
    // product produced. Without the parts in the facts the assistant cannot
    // say so — and the guardrail would strike the figures out if it tried,
    // because a number that is not grounded is not quotable.
    committedBreakdown:
      plan.safeToSpend.deductions
        .filter((deduction) => deduction.claimed.isPositive())
        .map((deduction) => `${DEDUCTION_LABELS[deduction.kind]} ${money(deduction.claimed)}`)
        .join(' · ') || 'nothing committed',
    // The claim each debt makes this month, which is what the committed figure
    // is built from — separate from the balance, which is what it will cost in
    // the end. Confusing the two is the whole of the question.
    debtMinimums:
      debts.filter((debt) => debt.minimumPayment.isPositive()).length === 0
        ? 'none'
        : debts
            .filter((debt) => debt.minimumPayment.isPositive())
            .map((debt) => `${debt.name}: ${money(debt.minimumPayment)} per month`)
            .join(' · '),
    obligationsCounted: String(plan.safeToSpend.countedObligations.length),
    obligationsHorizon: plan.safeToSpend.horizon,
    debts:
      debts.length === 0
        ? 'none'
        : debts
            .map((debt) => `${debt.name}: ${money(debt.currentBalance)} at ${debt.apr}%`)
            .join(' · '),
    goals:
      goals.length === 0
        ? 'none'
        : goals
            .map(
              (goal) => `${goal.name}: ${money(goal.currentAmount)} of ${money(goal.targetAmount)}`,
            )
            .join(' · '),
    // What makes this a conversation rather than a row of unrelated answers:
    // «and what if I pay $300 instead» is unanswerable without the turn before.
    conversation: conversationGrounding(
      priorTurns?.messages ?? [],
      promptLocale === 'en'
        ? { you: 'Household', assistant: 'Assistant' }
        : { you: 'Hogar', assistant: 'Asistente' },
    ),
  };

  const result = await ask(session, householdId, {
    prompt: QUESTION_ANSWER_V1,
    locale: promptLocale,
    currency: context.currency,
    grounding,
  });

  const answer = result.ok ? result.value.output['answer'] : undefined;
  const answerText =
    typeof answer === 'string' && answer.trim() !== ''
      ? answer
      : declineText(result.ok ? 'malformed_output' : result.error.kind, promptLocale);

  const threadId = await queryAsUser(session, async (tx) => {
    let id = parsed.data.threadId ?? null;

    if (id) {
      const [existing] = await tx
        .select({ id: chatThreads.id })
        .from(chatThreads)
        .where(
          and(
            eq(chatThreads.id, id),
            eq(chatThreads.householdId, householdId),
            isNull(chatThreads.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) id = null;
    }

    if (!id) {
      // The thread is named from the question, so it is findable later without
      // anybody being made to title it before they have asked anything.
      const [created] = await tx
        .insert(chatThreads)
        .values({
          householdId,
          createdBy: session.user.id,
          title: parsed.data.question.slice(0, 120),
        })
        .returning({ id: chatThreads.id });

      if (!created) return null;
      id = created.id;
    }

    await tx.insert(chatMessages).values([
      {
        threadId: id,
        householdId,
        role: 'user',
        body: parsed.data.question,
        authorId: session.user.id,
      },
      {
        threadId: id,
        householdId,
        role: 'assistant',
        body: answerText,
        // Stored whether the call succeeded or not: «the assistant declined
        // because the month's budget was spent» is part of the record too.
        grounding,
      },
    ]);

    await tx.update(chatThreads).set({ updatedAt: new Date() }).where(eq(chatThreads.id, id));

    return id;
  });

  if (!threadId) return { error: 'createFailed' };

  revalidatePath(`/${locale}/chat`);
  revalidatePath(`/${locale}/chat/${threadId}`);

  return { threadId, ok: true };
}

export async function removeThread(_previous: ChatResult, formData: FormData): Promise<ChatResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const [removed] = await queryAsUser(session, (tx) =>
    tx
      .update(chatThreads)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(chatThreads.id, id.data),
          eq(chatThreads.householdId, householdId),
          isNull(chatThreads.deletedAt),
        ),
      )
      .returning({ id: chatThreads.id }),
  );

  if (!removed) return { error: 'notFound' };

  revalidatePath(`/${localeOf(formData)}/chat`);
  return { ok: true };
}

/**
 * What the assistant says when it will not answer.
 *
 * Written here, in the household's language, rather than surfaced as an error
 * code — because it is stored as a message in the thread and has to read like
 * one months later. The reason is always named: «over budget» and «I could not
 * verify the figures» are different things and a person deserves to know which.
 */
function declineText(kind: string, locale: PromptLocale): string {
  if (locale === 'en') {
    if (kind === 'budget_exhausted') {
      return 'I have used this month’s assistant budget. The figures on your screens are unaffected.';
    }
    if (kind === 'ungrounded_figures' || kind === 'malformed_output' || kind === 'refused') {
      return 'I could not answer this without inventing a figure, so I did not answer it.';
    }
    return 'I could not reach the assistant just now. Every figure on your screens is still exact.';
  }

  if (kind === 'budget_exhausted') {
    return 'Se acabó el presupuesto del asistente de este mes. Las cifras de tus pantallas no cambian.';
  }
  if (kind === 'ungrounded_figures' || kind === 'malformed_output' || kind === 'refused') {
    return 'No pude responder sin inventar una cifra, así que no respondí.';
  }
  return 'No pude comunicarme con el asistente ahora. Todas las cifras de tus pantallas siguen siendo exactas.';
}
