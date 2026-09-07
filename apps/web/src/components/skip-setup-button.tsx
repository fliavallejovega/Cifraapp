'use client';

import { useActionState } from 'react';

import { skipSetup, type SetupResult } from '@/server/onboarding-actions';

/**
 * Leaving setup without answering.
 *
 * Deliberately quiet — a link, not a button — because the questionnaire is
 * worth answering and this is the way out, not the way forward. It still has to
 * exist: a person who wants to look around before typing their salary into a
 * product they just met is being reasonable, and trapping them would be the
 * only thing here that could lose them.
 */
export function SkipSetupButton({
  locale,
  label,
  hint,
}: {
  readonly locale: string;
  readonly label: string;
  readonly hint: string;
}) {
  const [, formAction, pending] = useActionState<SetupResult, FormData>(skipSetup, {});

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        disabled={pending}
        className="self-start text-sm text-[color:var(--color-ink-secondary)] underline underline-offset-4 transition-opacity duration-(--duration-quick) hover:opacity-60 disabled:opacity-45"
      >
        {label}
      </button>
      <span className="text-xs text-[color:var(--color-ink-tertiary)]">{hint}</span>
    </form>
  );
}
