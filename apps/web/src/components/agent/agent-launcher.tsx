'use client';

import { Button, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';

import { usePathname, useRouter } from '@/i18n/navigation';
import {
  applyAgentProposal,
  discardAgentProposal,
  loadAgentThread,
  sendAgentMessage,
  type AgentMessageView,
} from '@/server/agent-actions';

/**
 * The assistant, from any screen.
 *
 * One button, always in the same corner, that opens a conversation about what
 * the person is looking at: inside a trip it talks about that trip, anywhere
 * else about the household's money. On a phone it rises as a sheet over the
 * screen; on a wide screen it opens as a panel at the side, so the numbers it
 * talks about stay visible.
 *
 * What it proposes arrives as cards with «Aplicar» and «Descartar». Nothing
 * changes until a person taps one.
 */

const TRIP_PATH = /^\/trips\/([0-9a-f-]{36})(?:\/|$)/;

export function AgentLauncher({ locale }: { readonly locale: string }) {
  const t = useTranslations('agent');
  const pathname = usePathname();
  const router = useRouter();
  const tripId = TRIP_PATH.exec(pathname)?.[1] ?? null;
  const scope = tripId ? `trip:${tripId}` : 'finances';
  const lang = locale === 'en' ? 'en' : 'es';

  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly AgentMessageView[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // The conversation for this scope, read when the sheet first opens on it.
  useEffect(() => {
    if (!open || loaded === scope) return;
    let cancelled = false;
    void loadAgentThread({ scope }).then((view) => {
      if (cancelled) return;
      setThreadId(view.threadId);
      setMessages(view.messages);
      setLoaded(scope);
    });
    return () => {
      cancelled = true;
    };
  }, [open, scope, loaded]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages, pendingQuestion]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const send = (text: string) => {
    const message = text.trim();
    // Not before the thread is read: a question sent first would start a second
    // conversation beside the one being loaded.
    if (message.length < 2 || sending || loaded !== scope) return;
    setError(null);
    setPendingQuestion(message);
    setDraft('');
    startSend(async () => {
      try {
        const view = await sendAgentMessage({ threadId, message, scope, locale: lang });
        if (view.error) {
          setError(view.error);
          setDraft(message);
        } else {
          setThreadId(view.threadId);
          setMessages(view.messages);
        }
      } catch {
        setError('generic');
        setDraft(message);
      } finally {
        setPendingQuestion(null);
      }
    });
  };

  const suggestions = t.raw(tripId ? 'suggestionsTrip' : 'suggestionsFinances') as string[];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          window.setTimeout(() => input.current?.focus(), 250);
        }}
        aria-label={t('open')}
        aria-expanded={open}
        className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] z-30 flex h-14 items-center gap-2 rounded-full bg-[color:var(--color-panel)] px-5 text-sm font-medium text-[color:var(--color-panel-ink)] shadow-(--shadow-card) transition-transform duration-(--duration-quick) hover:bg-[color:var(--color-panel-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-brand)] motion-reduce:transition-none md:bottom-[calc(16px+env(safe-area-inset-bottom,0px))]"
        hidden={open}
      >
        <ChatGlyph />
        <span>{t('title')}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-end lg:items-stretch">
          <button
            type="button"
            aria-label={t('close')}
            className="absolute inset-0 bg-black/40 lg:bg-black/20"
            onClick={() => {
              setOpen(false);
            }}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-title"
            className="relative flex max-h-[85dvh] w-full flex-col rounded-t-(--radius-xl) bg-[color:var(--color-surface)] shadow-(--shadow-card) lg:max-h-none lg:w-[28rem] lg:rounded-none"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <header className="flex items-start justify-between gap-3 border-b border-[color:var(--color-rule)] px-4 py-3">
              <div className="min-w-0">
                <h2 id="agent-title" className="text-base font-medium">
                  {t('title')}
                </h2>
                <p className="text-sm text-[color:var(--color-ink-secondary)]">
                  {tripId ? t('scopeTrip') : t('scopeFinances')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {messages.length > 0 && (
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center rounded-(--radius-sm) px-3 text-sm text-[color:var(--color-ink-secondary)] hover:bg-[color:var(--color-ground-sunk)]"
                    onClick={() => {
                      setThreadId(null);
                      setMessages([]);
                      setError(null);
                    }}
                  >
                    {t('newThread')}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={t('close')}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-(--radius-sm) text-lg hover:bg-[color:var(--color-ground-sunk)]"
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </header>

            <div
              className="flex min-h-48 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4"
              aria-live="polite"
            >
              {loaded !== scope ? (
                <Status tone="neutral">{t('thinking')}</Status>
              ) : messages.length === 0 && !pendingQuestion ? (
                <div className="flex flex-col gap-3">
                  <p className="text-base font-medium">{t('emptyTitle')}</p>
                  <p className="text-sm text-[color:var(--color-ink-secondary)]">
                    {t('emptyBody')}
                  </p>
                  <ul className="flex list-none flex-col gap-2 p-0">
                    {suggestions.map((suggestion) => (
                      <li key={suggestion}>
                        <button
                          type="button"
                          className="min-h-11 w-full rounded-(--radius-md) border border-[color:var(--color-surface-border)] px-3 py-2 text-left text-sm hover:bg-[color:var(--color-ground-sunk)]"
                          onClick={() => {
                            send(suggestion);
                          }}
                        >
                          {suggestion}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    locale={lang}
                    onSettled={(next) => {
                      setMessages((current) =>
                        current.map((m) => (m.id === message.id ? { ...m, proposals: next } : m)),
                      );
                      router.refresh();
                    }}
                  />
                ))
              )}
              {pendingQuestion && (
                <>
                  <Bubble role="user" label={t('you')}>
                    {pendingQuestion}
                  </Bubble>
                  <Status tone="neutral">{t('thinking')}</Status>
                </>
              )}
              {error && (
                <Status tone="negative">
                  {t.has(`errors.${error}`) ? t(`errors.${error}`) : t('errors.generic')}
                </Status>
              )}
              <div ref={end} />
            </div>

            <form
              className="flex items-end gap-2 border-t border-[color:var(--color-rule)] px-4 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                send(draft);
              }}
            >
              <label htmlFor="agent-input" className="sr-only">
                {t('inputLabel')}
              </label>
              <textarea
                id="agent-input"
                ref={input}
                rows={1}
                value={draft}
                maxLength={600}
                placeholder={t('placeholder')}
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    send(draft);
                  }
                }}
                className="max-h-32 min-h-11 flex-1 resize-none rounded-(--radius-md) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-3 py-2 text-base"
              />
              <Button
                type="submit"
                size="md"
                className="min-h-11"
                loading={sending}
                disabled={loaded !== scope}
              >
                {t('send')}
              </Button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

function MessageBubble({
  message,
  locale,
  onSettled,
}: {
  readonly message: AgentMessageView;
  readonly locale: 'es' | 'en';
  readonly onSettled: (next: AgentMessageView['proposals']) => void;
}) {
  const t = useTranslations('agent');
  return (
    <div className="flex flex-col gap-2">
      <Bubble role={message.role} label={message.role === 'user' ? t('you') : t('assistant')}>
        {message.body}
      </Bubble>
      {message.proposals.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-wide text-[color:var(--color-ink-secondary)] uppercase">
            {t('proposalsTitle')}
          </p>
          {message.proposals.map((proposal, index) => (
            <ProposalCard
              key={`${proposal.kind}-${proposal.target}`}
              messageId={message.id}
              index={index}
              proposal={proposal}
              locale={locale}
              onSettled={(status) => {
                onSettled(message.proposals.map((p, i) => (i === index ? { ...p, status } : p)));
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalCard({
  messageId,
  index,
  proposal,
  locale,
  onSettled,
}: {
  readonly messageId: string;
  readonly index: number;
  readonly proposal: AgentMessageView['proposals'][number];
  readonly locale: 'es' | 'en';
  readonly onSettled: (status: 'applied' | 'discarded') => void;
}) {
  const t = useTranslations('agent');
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  const act = (outcome: 'applied' | 'discarded') => {
    setFailed(false);
    start(async () => {
      const call = outcome === 'applied' ? applyAgentProposal : discardAgentProposal;
      const result = await call({ messageId, index, locale });
      if (result.error) setFailed(true);
      else onSettled(outcome);
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-(--radius-md) border border-[color:var(--color-surface-border)] p-3">
      <p className="text-sm font-medium [overflow-wrap:anywhere]">{proposal.label}</p>
      {proposal.reason && (
        <p className="text-sm [overflow-wrap:anywhere] text-[color:var(--color-ink-secondary)]">
          {proposal.reason}
        </p>
      )}
      {proposal.status === 'proposed' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="md"
            className="min-h-11"
            loading={pending}
            onClick={() => {
              act('applied');
            }}
          >
            {t('apply')}
          </Button>
          <Button
            size="md"
            variant="secondary"
            className="min-h-11"
            disabled={pending}
            onClick={() => {
              act('discarded');
            }}
          >
            {t('discard')}
          </Button>
        </div>
      ) : (
        <Status tone={proposal.status === 'applied' ? 'positive' : 'neutral'}>
          {proposal.status === 'applied' ? t('applied') : t('discarded')}
        </Status>
      )}
      {failed && <Status tone="negative">{t('applyFailed')}</Status>}
    </div>
  );
}

function Bubble({
  role,
  label,
  children,
}: {
  readonly role: 'user' | 'assistant';
  readonly label: string;
  readonly children: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${role === 'user' ? 'items-end' : 'items-start'}`}>
      <span className="text-xs text-[color:var(--color-ink-tertiary)]">{label}</span>
      <p
        className={`max-w-[90%] rounded-(--radius-md) px-3 py-2 text-sm [overflow-wrap:anywhere] whitespace-pre-line ${
          role === 'user'
            ? 'bg-[color:var(--color-panel)] text-[color:var(--color-panel-ink)]'
            : 'bg-[color:var(--color-ground-sunk)]'
        }`}
      >
        {children}
      </p>
    </div>
  );
}

function ChatGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <path d="M17 11.5a3 3 0 0 1-3 3H8l-4 3v-3a3 3 0 0 1-1-2.25v-5A3 3 0 0 1 6 4.5h8a3 3 0 0 1 3 3Z" />
      <path d="M7 8.5h6" />
      <path d="M7 11h3.5" />
    </svg>
  );
}
