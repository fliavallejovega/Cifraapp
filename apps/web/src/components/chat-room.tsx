'use client';

import { Button, Card, Problem, Status } from '@app/ui';
import { useActionState, useEffect, useRef, useState } from 'react';

import { useRouter } from '@/i18n/navigation';
import { askQuestion, type ChatResult } from '@/server/chat-actions';

/**
 * A conversation about a household's own money.
 *
 * The screen this replaces was a form with a list of past threads underneath —
 * accurate, and nothing anybody would call a chat. Three things changed:
 *
 *   - **The turns are the screen.** Messages read top to bottom with the
 *     composer under them, so the last thing on screen is the thing you reply
 *     to. A form at the top and history at the bottom asks a person to read
 *     upward, which nobody does.
 *   - **The empty state is an opening, not a blank.** It states what the
 *     product already knows — opening with «tell me about yourself» while
 *     holding four months of somebody's statements is what makes financial
 *     chatbots feel like paperwork — then asks the two things no ledger
 *     contains, and offers ways in built from this household's own rows.
 *   - **The question is echoed the instant it is sent.** A copilot call takes
 *     one to three seconds; without the echo the screen looks broken for all
 *     of it.
 *
 * The opening's figures are composed on the server from rows. Nothing the model
 * produces reaches this screen except the body of an answer.
 */

export interface ChatMessageView {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly body: string;
  readonly grounding: Readonly<Record<string, string>>;
  readonly ungrounded: readonly string[];
  readonly at: string;
}

export interface ChatOpeningView {
  readonly greeting: string;
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  readonly questions: readonly string[];
  readonly starters: readonly string[];
}

export interface ChatRoomLabels {
  readonly knowTitle: string;
  readonly knowEmpty: string;
  readonly askTitle: string;
  readonly askDetail: string;
  readonly startersTitle: string;
  readonly composerLabel: string;
  readonly placeholder: string;
  readonly send: string;
  readonly thinking: string;
  readonly hint: string;
  readonly memory: string;
  readonly you: string;
  readonly assistant: string;
  readonly groundingTitle: string;
  readonly groundingDetail: string;
  readonly ungrounded: string;
  readonly errorTitle: string;
  readonly errors: Readonly<Record<string, string>>;
}

export function ChatRoom({
  locale,
  threadId,
  messages,
  opening,
  labels,
}: {
  readonly locale: string;
  readonly threadId?: string;
  readonly messages: readonly ChatMessageView[];
  /** Present only while the conversation is empty. */
  readonly opening?: ChatOpeningView;
  readonly labels: ChatRoomLabels;
}) {
  const [state, formAction, pending] = useActionState<ChatResult, FormData>(askQuestion, {});
  const router = useRouter();

  const form = useRef<HTMLFormElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const foot = useRef<HTMLDivElement>(null);

  /** The question being answered, echoed until the server sends it back. */
  const [inFlight, setInFlight] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) return;
    // Scroll only once the turn is actually on screen.
    foot.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [pending]);

  useEffect(() => {
    if (!state.ok || !state.threadId) return;

    setInFlight(null);
    form.current?.reset();

    if (threadId === state.threadId) router.refresh();
    else router.push(`/chat/${state.threadId}`);
  }, [state.ok, state.threadId, threadId, router]);

  /** Fills the composer rather than sending: a starter is a draft, not a click. */
  const useStarter = (text: string) => {
    if (!field.current) return;
    field.current.value = text;
    field.current.focus();
    // The cursor lands at the end so the person can keep typing.
    field.current.setSelectionRange(text.length, text.length);
  };

  const conversationStarted = messages.length > 0 || inFlight !== null;

  return (
    <div className="flex flex-col gap-8">
      {opening && !conversationStarted && (
        <Opening opening={opening} labels={labels} onStarter={useStarter} />
      )}

      {conversationStarted && (
        <ol className="flex flex-col gap-6">
          {messages.map((message) => (
            <li key={message.id}>
              <Bubble message={message} labels={labels} />
            </li>
          ))}

          {inFlight !== null && (
            <>
              <li>
                <Bubble
                  message={{
                    id: 'in-flight',
                    role: 'user',
                    body: inFlight,
                    grounding: {},
                    ungrounded: [],
                    at: '',
                  }}
                  labels={labels}
                />
              </li>
              <li>
                <p className="px-1 text-sm text-[color:var(--color-ink-tertiary)]">
                  {labels.thinking}
                </p>
              </li>
            </>
          )}
        </ol>
      )}

      <div ref={foot} />

      <form
        ref={form}
        action={formAction}
        onSubmit={(event) => {
          const value = new FormData(event.currentTarget).get('question');
          setInFlight(typeof value === 'string' ? value : null);
        }}
        className="sticky bottom-4 flex flex-col gap-2"
      >
        <input type="hidden" name="locale" value={locale} />
        {threadId && <input type="hidden" name="threadId" value={threadId} />}

        {state.error && (
          <Problem
            title={labels.errorTitle}
            body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
          />
        )}

        <Card padding="md">
          <label className="sr-only" htmlFor="chat-question">
            {labels.composerLabel}
          </label>

          <div className="flex items-end gap-3">
            <textarea
              ref={field}
              id="chat-question"
              name="question"
              rows={2}
              required
              maxLength={500}
              placeholder={labels.placeholder}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter breaks the line — the convention
                // every messaging app has taught, and the hint says so.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              className="min-h-11 w-full resize-none bg-transparent text-sm text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-tertiary)] focus-visible:outline-none"
            />

            <Button type="submit" loading={pending} className="shrink-0">
              {pending ? labels.thinking : labels.send}
            </Button>
          </div>
        </Card>

        <p className="px-1 text-xs text-[color:var(--color-ink-tertiary)]">
          {conversationStarted ? labels.memory : labels.hint}
        </p>
      </form>
    </div>
  );
}

function Opening({
  opening,
  labels,
  onStarter,
}: {
  readonly opening: ChatOpeningView;
  readonly labels: ChatRoomLabels;
  readonly onStarter: (text: string) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <p className="text-[color:var(--color-ink)]">{opening.greeting}</p>

        <h2 className="gradation-label mt-6 text-[color:var(--color-ink-tertiary)] uppercase">
          {labels.knowTitle}
        </h2>

        {opening.facts.length === 0 ? (
          <p className="mt-3 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {labels.knowEmpty}
          </p>
        ) : (
          <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {opening.facts.map((fact) => (
              <div key={fact.label} className="flex flex-col">
                <dt className="text-[color:var(--color-ink-tertiary)]">{fact.label}</dt>
                <dd className="readout mt-0.5 text-[color:var(--color-ink)] tabular-nums">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <h2 className="gradation-label mt-8 text-[color:var(--color-ink-tertiary)] uppercase">
          {labels.askTitle}
        </h2>
        <ol className="mt-3 flex flex-col gap-2">
          {opening.questions.map((question) => (
            <li key={question} className="max-w-[62ch] text-pretty text-[color:var(--color-ink)]">
              {question}
            </li>
          ))}
        </ol>
        <p className="mt-3 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {labels.askDetail}
        </p>
      </Card>

      {opening.starters.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="gradation-label text-[color:var(--color-ink-tertiary)] uppercase">
            {labels.startersTitle}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {opening.starters.map((starter) => (
              <li key={starter}>
                <button
                  type="button"
                  onClick={() => {
                    onStarter(starter);
                  }}
                  className="min-h-11 rounded-(--radius-sm) border border-[color:var(--color-rule-strong)] bg-[color:var(--color-surface)] px-3.5 text-left text-sm text-pretty text-[color:var(--color-ink)] transition-colors duration-(--duration-quick) hover:border-[color:var(--color-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-brand)]"
                >
                  {starter}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Bubble({
  message,
  labels,
}: {
  readonly message: ChatMessageView;
  readonly labels: ChatRoomLabels;
}) {
  const mine = message.role === 'user';

  return (
    <div className={mine ? 'flex justify-end' : 'flex justify-start'}>
      <div className={mine ? 'max-w-[46ch]' : 'max-w-[64ch]'}>
        <p className="gradation-label mb-2 text-[color:var(--color-ink-tertiary)] uppercase">
          {mine ? labels.you : labels.assistant}
          {message.at && (
            <>
              {' · '}
              <span className="readout normal-case">{message.at}</span>
            </>
          )}
        </p>

        <div
          className={[
            'rounded-(--radius-md) px-4 py-3',
            mine
              ? 'bg-[color:var(--color-ground-sunk)] text-[color:var(--color-ink)]'
              : 'border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] text-[color:var(--color-ink)]',
          ].join(' ')}
        >
          <p className="text-pretty whitespace-pre-wrap">{message.body}</p>

          {message.ungrounded.length > 0 && (
            <p className="mt-3">
              <Status tone="negative">
                {labels.ungrounded.replace('{figures}', message.ungrounded.join(', '))}
              </Status>
            </p>
          )}

          {!mine && Object.keys(message.grounding).length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-[color:var(--color-ink-tertiary)]">
                {labels.groundingTitle}
              </summary>
              <p className="mt-2 text-xs text-[color:var(--color-ink-tertiary)]">
                {labels.groundingDetail}
              </p>
              <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
                {Object.entries(message.grounding).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <dt className="text-[color:var(--color-ink-tertiary)]">{key}</dt>
                    <dd className="readout min-w-0 break-words text-[color:var(--color-ink-secondary)]">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
