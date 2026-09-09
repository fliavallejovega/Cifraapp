import { Card, Page, PageHeader, Problem, Section, Status } from '@app/ui';
import { getTranslations } from 'next-intl/server';

import { ChatRoom } from '@/components/chat-room';
import { PlanProposals } from '@/components/plan-proposals';
import { ThreadActions } from '@/components/thread-actions';
import { Link } from '@/i18n/navigation';
import { formatMoment } from '@/lib/format';
import { copilotIsConfigured } from '@/server/ai';
import { loadChatScreen } from '@/server/repositories/chat-view';
import { describeProposal } from '@/server/repositories/proposal-copy';
import { loadPendingProposals } from '@/server/repositories/proposals';
import { requireHousehold } from '@/server/session';

/**
 * The chat, rendered the same way whether a thread was named or not.
 *
 * Both routes are the same screen: `/chat` continues the most recent
 * conversation, `/chat/[id]` opens a specific one. Writing it twice would have
 * produced two openings, two composers, and eventually two answers to «what
 * does this do when the copilot is off».
 */
export async function ChatScreen({
  locale,
  threadId,
  fresh,
}: {
  readonly locale: string;
  readonly threadId?: string;
  /** Opens on the greeting instead of continuing the most recent thread. */
  readonly fresh?: boolean;
}) {
  const session = await requireHousehold(locale);
  const t = await getTranslations('chat');
  const shared = await getTranslations('records');

  if (!copilotIsConfigured()) {
    return (
      <Page>
        <PageHeader title={t('title')} detail={t('detail')} />
        <Problem title={t('off.title')} body={t('off.body')} />
      </Page>
    );
  }

  const screen = await loadChatScreen(
    session,
    session.activeHouseholdId,
    locale,
    {
      facts: {
        available: t('opening.facts.available'),
        committed: t('opening.facts.committed'),
        liquid: t('opening.facts.liquid'),
        debt: t('opening.facts.debt'),
        goal: t('opening.facts.goal'),
        pending: t('opening.facts.pending'),
      },
      questions: questionsOf(t),
      starters: {
        surplus: rawOf(t)('opening.starters.surplus'),
        shortfall: rawOf(t)('opening.starters.shortfall'),
        debt: rawOf(t)('opening.starters.debt'),
        goal: rawOf(t)('opening.starters.goal'),
        budget: rawOf(t)('opening.starters.budget'),
        month: t('opening.starters.month'),
      },
    },
    threadId,
    fresh ?? false,
  );

  const proposals = await loadPendingProposals(session, session.activeHouseholdId);

  const errors = {
    copilotOff: t('errors.copilotOff'),
    requestRequired: t('errors.questionRequired'),
    copilotUnavailable: t('errors.generic'),
    noProposals: t('proposals.errors.none'),
    expired: t('proposals.errors.expired'),
    targetGone: t('proposals.errors.targetGone'),
    questionRequired: t('errors.questionRequired'),
    createFailed: t('errors.createFailed'),
    signInRequired: t('errors.signInRequired'),
    notFound: t('errors.notFound'),
    generic: t('errors.generic'),
  };

  return (
    <Page>
      <PageHeader
        title={screen.thread && screen.messages.length > 0 ? screen.thread.title : t('title')}
        {...(screen.messages.length > 0 ? {} : { detail: t('detail') })}
        actions={
          screen.messages.length > 0 ? (
            <Link
              href="/chat/new"
              className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
            >
              {t('newThread')}
            </Link>
          ) : undefined
        }
      />

      <ChatRoom
        locale={locale}
        {...(screen.thread && screen.messages.length > 0 ? { threadId: screen.thread.id } : {})}
        messages={screen.messages.map((message) => ({
          id: message.id,
          role: message.role,
          body: message.body,
          grounding: message.grounding,
          ungrounded: message.ungrounded,
          at: formatMoment(message.createdAt, locale, screen.timeZone),
        }))}
        {...(screen.opening
          ? {
              opening: {
                greeting: t('opening.greeting'),
                facts: screen.opening.facts,
                questions: screen.opening.questions,
                starters: screen.opening.starters,
              },
            }
          : {})}
        labels={{
          knowTitle: t('opening.knowTitle'),
          knowEmpty: t('opening.knowEmpty'),
          askTitle: t('opening.askTitle'),
          askDetail: t('opening.askDetail'),
          startersTitle: t('opening.startersTitle'),
          composerLabel: t('composer.label'),
          placeholder: t('composer.placeholder'),
          send: t('composer.send'),
          thinking: t('composer.thinking'),
          hint: t('composer.hint'),
          memory: t('memory'),
          you: t('you'),
          assistant: t('assistant'),
          groundingTitle: t('grounding.title'),
          groundingDetail: t('grounding.detail'),
          ungrounded: rawOf(t)('ungrounded'),
          errorTitle: t('errorTitle'),
          errors,
        }}
      />

      {/* Las propuestas van entre la conversación y el historial: son la
          consecuencia de lo que se acaba de hablar, y ponerlas al final las
          dejaría fuera de la vista justo cuando hacen falta. */}
      <Section
        title={t('proposals.title')}
        detail={t('proposals.detail')}
        className="mt-12"
      >
        <PlanProposals
          locale={locale}
          proposals={await Promise.all(
            proposals.map(async (proposal) => ({
              id: proposal.id,
              description: await describeProposal(proposal, locale),
              reason: proposal.reason,
            })),
          )}
          labels={{
            title: t('proposals.title'),
            detail: t('proposals.detail'),
            emptyTitle: t('proposals.emptyTitle'),
            emptyBody: t('proposals.emptyBody'),
            modelSays: t('proposals.modelSays'),
            approve: t('proposals.approve'),
            reject: t('proposals.reject'),
            composerLabel: t('proposals.composerLabel'),
            composerPlaceholder: t('proposals.composerPlaceholder'),
            composerSubmit: t('proposals.composerSubmit'),
            pending: t('composer.thinking'),
            errorTitle: t('errorTitle'),
            errors,
          }}
        />
      </Section>

      {screen.threads.length > 0 && (
        <Section title={t('threads.title')} className="mt-12">
          <Card>
            <ul className="flex flex-col">
              {screen.threads.map((thread) => (
                <li
                  key={thread.id}
                  className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[color:var(--color-rule)] py-3 last:border-b-0"
                >
                  <Link
                    href={`/chat/${thread.id}`}
                    className="min-w-0 flex-1 text-sm text-[color:var(--color-ink)] underline decoration-transparent underline-offset-4 hover:decoration-[color:var(--color-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-brand)]"
                  >
                    {thread.title}
                    {screen.thread?.id === thread.id && (
                      <span className="ml-2">
                        <Status tone="signal">{t('threads.title')}</Status>
                      </span>
                    )}
                  </Link>
                  <span className="readout shrink-0 text-xs text-[color:var(--color-ink-tertiary)]">
                    {formatMoment(thread.updatedAt, locale, screen.timeZone)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {screen.thread && screen.messages.length > 0 && (
        <Section className="mt-8">
          <ThreadActions
            locale={locale}
            threadId={screen.thread.id}
            labels={{
              remove: t('remove'),
              removeConfirm: t('removeConfirm'),
              cancel: shared('cancel'),
              errorTitle: t('errorTitle'),
              generic: t('errors.generic'),
            }}
          />
        </Section>
      )}
    </Page>
  );
}

/** The two opening questions, which the catalogue holds as an array. */
function questionsOf(t: { raw: (key: string) => unknown }): readonly string[] {
  const value = t.raw('opening.questions');
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

/** A template whose placeholders are filled from rows, not by the catalogue. */
function rawOf(t: { raw: (key: string) => unknown }): (key: string) => string {
  return (key) => {
    const value = t.raw(key);
    return typeof value === 'string' ? value : '';
  };
}
