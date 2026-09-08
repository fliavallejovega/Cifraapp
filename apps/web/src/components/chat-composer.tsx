'use client';

import { Button, Field, Problem } from '@app/ui';
import { useActionState, useEffect, useRef } from 'react';

import { useRouter } from '@/i18n/navigation';
import { askQuestion, type ChatResult } from '@/server/chat-actions';

/**
 * The question box.
 *
 * A textarea rather than an input, because «can I afford the trip in July if we
 * keep the card at its minimum» is two lines and being made to type it into a
 * one-line field is a small, constant insult.
 *
 * Answering navigates to the thread. The alternative — answering in place —
 * would leave the exchange somewhere a person cannot link to, which defeats the
 * point of storing it with its grounding.
 */
export function ChatComposer({
  locale,
  threadId,
  labels,
}: {
  readonly locale: string;
  readonly threadId?: string;
  readonly labels: {
    readonly ask: string;
    readonly askHint: string;
    readonly submit: string;
    readonly thinking: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}) {
  const [state, formAction, pending] = useActionState<ChatResult, FormData>(askQuestion, {});
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.ok || !state.threadId) return;

    form.current?.reset();

    // Already in the thread: the server revalidated it, so a refresh is enough
    // and a push would add a history entry pointing at the same page.
    if (threadId === state.threadId) router.refresh();
    else router.push(`/chat/${state.threadId}`);
  }, [state.ok, state.threadId, threadId, router]);

  return (
    <form ref={form} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      {threadId && <input type="hidden" name="threadId" value={threadId} />}

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      <Field label={labels.ask} hint={labels.askHint} required>
        {({ id, describedBy }) => (
          <textarea
            id={id}
            name="question"
            rows={3}
            required
            maxLength={500}
            aria-describedby={describedBy}
            className="w-full rounded-(--radius-sm) border border-[color:var(--color-rule-strong)] bg-[color:var(--color-surface)] px-3 py-2.5 text-sm text-[color:var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-[color:var(--color-brand)]"
          />
        )}
      </Field>

      <Button type="submit" loading={pending} className="self-start">
        {pending ? labels.thinking : labels.submit}
      </Button>
    </form>
  );
}
