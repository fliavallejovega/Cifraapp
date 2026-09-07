import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { Monogram } from './shell-icons';

/**
 * The door.
 *
 * Two halves on a desk, one column on a phone. The left half is the house —
 * ink, the brass monogram, the one sentence that says what this place is. The
 * right half is the form, on a raised surface, because signing in is the first
 * thing a person does here and it should feel like being received, not like
 * filling a field floating on a blank page.
 *
 * Every auth screen shares this frame so the door always looks like the same
 * door. The forms inside keep their own semantics untouched.
 */
export async function AuthScreen({
  title,
  detail,
  wide = false,
  children,
}: {
  readonly title: string;
  readonly detail?: string;
  /** The questionnaire needs room for its rows; a sign-in form does not. */
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  const common = await getTranslations('common');

  return (
    <div className="flex min-h-dvh">
      {/* The house. Only on a desk — a phone goes straight to the form. */}
      <aside
        aria-hidden
        className="hidden w-[42%] max-w-xl flex-col justify-between bg-[color:var(--color-panel)] p-10 lg:flex"
        style={{
          backgroundImage:
            'linear-gradient(180deg, var(--color-panel-raised) 0%, var(--color-panel) 24rem)',
        }}
      >
        <div className="flex items-center gap-3">
          <Monogram />
          <span className="font-(family-name:--font-mono) text-sm font-semibold tracking-[0.18em] text-[color:var(--color-panel-ink)] uppercase">
            {common('appName')}
          </span>
        </div>

        <p className="max-w-[26ch] text-2xl leading-snug text-balance text-[color:var(--color-panel-ink)]">
          {common('tagline')}
        </p>

        {/* The brass rule that signs the panel. */}
        <div className="h-px w-16 bg-[color:var(--color-brand)]" />
      </aside>

      <main className="flex min-w-0 flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className={wide ? 'w-full max-w-2xl' : 'w-full max-w-sm'}>
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Monogram size={30} />
            <span className="font-(family-name:--font-mono) text-sm font-semibold tracking-[0.18em] text-[color:var(--color-ink)] uppercase">
              {common('appName')}
            </span>
          </div>

          <div className="rounded-(--radius-xl) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] p-6 shadow-(--shadow-card) sm:p-8">
            <header className="mb-8">
              <h1
                className="text-2xl font-semibold"
                style={{ letterSpacing: 'var(--tracking-title)' }}
              >
                {title}
              </h1>
              {detail && (
                <p className="mt-2 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
                  {detail}
                </p>
              )}
            </header>

            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
