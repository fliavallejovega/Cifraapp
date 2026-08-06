'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

/**
 * The user-facing error surface.
 *
 * It never shows the underlying error. A stack trace or a database message can
 * carry account numbers, statement descriptions or connection strings, and this
 * boundary catches failures from code that touches all three (spec §47, §74).
 * The technical detail belongs in the server log, which is where it goes.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');
  const common = useTranslations('common');

  useEffect(() => {
    // The digest correlates this screen with the server-side log entry that
    // does contain the detail. Phase 21 forwards it to error tracking.
    console.error('Unhandled error', error.digest ?? '(no digest)');
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <h1 className="mb-3 text-2xl font-medium" style={{ letterSpacing: 'var(--tracking-title)' }}>
        {t('genericTitle')}
      </h1>
      <p className="mb-8 text-pretty text-[color:var(--color-ink-muted)]">{t('genericBody')}</p>
      <button
        type="button"
        onClick={reset}
        className="self-start rounded-[var(--radius-md)] border border-[color:var(--color-border)] px-4 py-2 text-sm transition-opacity duration-200 hover:opacity-70"
      >
        {common('retry')}
      </button>
    </main>
  );
}
