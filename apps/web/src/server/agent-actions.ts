'use server';

import { chatMessages, chatThreads, tripLegs } from '@app/database/schema';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { assignAccountOwner } from './account-actions';
import { runAgentTurn, type AgentProposal, type AgentScope } from './agent';
import { copilotIsConfigured } from './ai';
import { setMovementCategory } from './movement-actions';
import { conversationGrounding } from './repositories/chat-opening';
import { loadSession, queryAsUser } from './session';
import { saveTripLeg } from './trip-actions';

/**
 * The assistant's conversation: send a message, read the thread, apply or
 * discard what it proposed.
 *
 * Applying runs the same action the screen for that thing runs — the movement's
 * category, the account's owner, the trip leg — so a change made from the chat
 * passes every check a change made by hand passes, and lands in the same
 * history. The proposal is re-read from the database first: what is applied is
 * what was stored, never what the browser sends back.
 */

export interface AgentMessageView {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly body: string;
  readonly proposals: readonly AgentProposal[];
}

export interface AgentThreadView {
  readonly threadId: string | null;
  readonly messages: readonly AgentMessageView[];
  readonly error?: string;
}

const scopeInput = z.union([z.literal('finances'), z.string().regex(/^trip:[0-9a-f-]{36}$/)]);

function scopeOf(raw: string): AgentScope {
  return raw.startsWith('trip:') ? { kind: 'trip', tripId: raw.slice(5) } : { kind: 'finances' };
}

/** The most recent conversation about this scope, so the sheet reopens where it was. */
export async function loadAgentThread(input: { readonly scope: string }): Promise<AgentThreadView> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { threadId: null, messages: [], error: 'signInRequired' };
  const scope = scopeInput.safeParse(input.scope);
  if (!scope.success) return { threadId: null, messages: [] };
  const householdId = session.activeHouseholdId;

  return queryAsUser(session, async (tx) => {
    const [thread] = await tx
      .select({ id: chatThreads.id })
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.householdId, householdId),
          eq(chatThreads.scope, scope.data),
          isNull(chatThreads.deletedAt),
        ),
      )
      .orderBy(desc(chatThreads.updatedAt))
      .limit(1);
    if (!thread) return { threadId: null, messages: [] };
    return { threadId: thread.id, messages: await messagesOf(tx, thread.id) };
  });
}

const sendInput = z.object({
  threadId: z.uuid().nullish(),
  message: z.string().trim().min(2).max(600),
  scope: scopeInput,
  locale: z.enum(['es', 'en']).default('es'),
});

export async function sendAgentMessage(raw: z.input<typeof sendInput>): Promise<AgentThreadView> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { threadId: null, messages: [], error: 'signInRequired' };
  if (!copilotIsConfigured()) return { threadId: null, messages: [], error: 'copilotOff' };
  const parsed = sendInput.safeParse(raw);
  if (!parsed.success) return { threadId: null, messages: [], error: 'messageRequired' };
  const input = parsed.data;
  const householdId = session.activeHouseholdId;

  const prior = input.threadId
    ? await queryAsUser(session, (tx) => messagesOf(tx, input.threadId ?? ''))
    : [];

  const turn = await runAgentTurn(session, householdId, {
    message: input.message,
    scope: scopeOf(input.scope),
    conversation: conversationGrounding(
      prior,
      input.locale === 'en'
        ? { you: 'Household', assistant: 'Assistant' }
        : { you: 'Hogar', assistant: 'Asistente' },
    ),
    locale: input.locale,
  });

  const threadId = await queryAsUser(session, async (tx) => {
    let id = input.threadId ?? null;
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
      const [created] = await tx
        .insert(chatThreads)
        .values({
          householdId,
          createdBy: session.user.id,
          title: input.message.slice(0, 120),
          scope: input.scope,
        })
        .returning({ id: chatThreads.id });
      if (!created) return null;
      id = created.id;
    }
    await tx.insert(chatMessages).values([
      { threadId: id, householdId, role: 'user', body: input.message, authorId: session.user.id },
      {
        threadId: id,
        householdId,
        role: 'assistant',
        body: turn.answer,
        grounding: turn.grounding,
        proposals: [...turn.proposals],
      },
    ]);
    await tx.update(chatThreads).set({ updatedAt: new Date() }).where(eq(chatThreads.id, id));
    return id;
  });

  if (!threadId) return { threadId: null, messages: [], error: 'saveFailed' };
  return {
    threadId,
    messages: await queryAsUser(session, (tx) => messagesOf(tx, threadId)),
  };
}

const proposalInput = z.object({
  messageId: z.uuid(),
  index: z.number().int().min(0).max(4),
  locale: z.enum(['es', 'en']).default('es'),
});

export async function applyAgentProposal(
  raw: z.input<typeof proposalInput>,
): Promise<{ readonly error?: string; readonly ok?: true }> {
  return settle(raw, 'applied');
}

export async function discardAgentProposal(
  raw: z.input<typeof proposalInput>,
): Promise<{ readonly error?: string; readonly ok?: true }> {
  return settle(raw, 'discarded');
}

async function settle(
  raw: z.input<typeof proposalInput>,
  outcome: 'applied' | 'discarded',
): Promise<{ readonly error?: string; readonly ok?: true }> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };
  const parsed = proposalInput.safeParse(raw);
  if (!parsed.success) return { error: 'notFound' };
  const { messageId, index, locale } = parsed.data;
  const householdId = session.activeHouseholdId;

  const [message] = await queryAsUser(session, (tx) =>
    tx
      .select({ proposals: chatMessages.proposals })
      .from(chatMessages)
      .where(and(eq(chatMessages.id, messageId), eq(chatMessages.householdId, householdId)))
      .limit(1),
  );
  const proposal = message?.proposals[index];
  if (!message || !proposal) return { error: 'notFound' };
  if (proposal.status !== 'proposed') return { error: 'alreadySettled' };

  if (outcome === 'applied') {
    const result = await execute(proposal as AgentProposal, locale);
    if (result.error) return { error: result.error };
  }

  const next = message.proposals.map((p, i) => (i === index ? { ...p, status: outcome } : p));
  await queryAsUser(session, (tx) =>
    tx
      .update(chatMessages)
      .set({ proposals: next })
      .where(and(eq(chatMessages.id, messageId), eq(chatMessages.householdId, householdId))),
  );
  return { ok: true };
}

/** The same action each screen runs. Every one re-checks the household and the ids. */
async function execute(
  proposal: AgentProposal,
  locale: 'es' | 'en',
): Promise<{ readonly error?: string }> {
  if (proposal.kind === 'recategorize_movement') {
    const form = new FormData();
    form.set('id', proposal.target);
    form.set('categoryId', proposal.value);
    form.set('locale', locale);
    const result = await setMovementCategory({}, form);
    return result.error ? { error: result.error } : {};
  }

  if (proposal.kind === 'set_account_owner') {
    const form = new FormData();
    form.set('id', proposal.target);
    form.set('personId', proposal.value === 'household' ? '' : proposal.value);
    form.set('locale', locale);
    const result = await assignAccountOwner({}, form);
    return result.error ? { error: result.error } : {};
  }

  // A trip leg: the whole leg is re-read and saved with one field changed, through
  // the same action the trip screen uses.
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };
  const householdId = session.activeHouseholdId;
  const [leg] = await queryAsUser(session, (tx) =>
    tx
      .select()
      .from(tripLegs)
      .where(and(eq(tripLegs.id, proposal.target), eq(tripLegs.householdId, householdId)))
      .limit(1),
  );
  if (!leg) return { error: 'notFound' };

  const [from = '', to = ''] = proposal.value.split('..');
  const lodging = ['prepaid', 'pay_on_site', 'none', 'undecided'] as const;
  const mode = lodging.find((m) => m === proposal.value);
  const result = await saveTripLeg(
    leg.tripId,
    {
      id: leg.id,
      city: leg.city,
      countryCode: leg.countryCode?.trim() ?? null,
      placeLabel: leg.placeLabel,
      arrivalDate: proposal.kind === 'set_leg_dates' ? from : leg.arrivalDate,
      departureDate: proposal.kind === 'set_leg_dates' ? to : leg.departureDate,
      localCurrency: leg.localCurrency.trim(),
      costLevel: leg.costLevel,
      costIndex: leg.costIndex,
      timezone: leg.timezone,
      lodgingMode: proposal.kind === 'set_leg_lodging' && mode ? mode : leg.lodgingMode,
    },
    locale,
  );
  return result.error ? { error: result.error } : {};
}

type Tx = Parameters<Parameters<typeof queryAsUser>[1]>[0];

async function messagesOf(tx: Tx, threadId: string): Promise<AgentMessageView[]> {
  const rows = await tx
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      body: chatMessages.body,
      proposals: chatMessages.proposals,
    })
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(asc(chatMessages.createdAt))
    .limit(80);
  return rows.map((row) => ({
    id: row.id,
    role: row.role === 'user' ? 'user' : 'assistant',
    body: row.body,
    proposals: row.proposals as AgentProposal[],
  }));
}
