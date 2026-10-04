'use client';

import { useState, useTransition } from 'react';

import { useRouter } from '@/i18n/navigation';
import { undoAutoFiledImport } from '@/server/import-actions';

/** «Guardado solo · Deshacer»: puts an import the app saved back into review. */
export function UndoAutoFiled({
  importId,
  locale,
  labels,
}: {
  readonly importId: string;
  readonly locale: string;
  readonly labels: Readonly<Record<'saved' | 'undo' | 'error', string>>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--color-ink-secondary)]">
      <span>{labels.saved}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          start(async () => {
            const result = await undoAutoFiledImport({ importId, locale });
            if (result.error) setFailed(true);
            else router.refresh();
          });
        }}
        className="inline-flex min-h-11 items-center font-medium text-[color:var(--color-ink)] underline decoration-[color:var(--color-brand)] underline-offset-4 disabled:opacity-50"
      >
        {labels.undo}
      </button>
      {failed && (
        <span role="alert" className="text-[color:var(--color-negative)]">
          {labels.error}
        </span>
      )}
    </span>
  );
}
