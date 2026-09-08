'use client';

import { Button, Problem } from '@app/ui';
import { useActionState, useState } from 'react';

import { useRouter } from '@/i18n/navigation';
import { removeThread, type ChatResult } from '@/server/chat-actions';

/** Removing a conversation. Asks first, because it takes the record with it. */
export function ThreadActions({
  locale,
  threadId,
  labels,
}: {
  readonly locale: string;
  readonly threadId: string;
  readonly labels: {
    readonly remove: string;
    readonly removeConfirm: string;
    readonly cancel: string;
    readonly errorTitle: string;
    readonly generic: string;
  };
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<ChatResult, FormData>(removeThread, {});
  const router = useRouter();

  if (state.ok) {
    router.push('/chat');
  }

  return (
    <div className="flex flex-col gap-3">
      {state.error && <Problem title={labels.errorTitle} body={labels.generic} />}

      {confirming ? (
        <form action={formAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={threadId} />
          <span className="text-sm text-[color:var(--color-ink-secondary)]">
            {labels.removeConfirm}
          </span>
          <Button type="submit" variant="destructive" size="sm" loading={pending}>
            {labels.remove}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setConfirming(false);
            }}
          >
            {labels.cancel}
          </Button>
        </form>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            setConfirming(true);
          }}
        >
          {labels.remove}
        </Button>
      )}
    </div>
  );
}
