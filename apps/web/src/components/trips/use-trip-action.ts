'use client';

import { useCallback, useState, useTransition } from 'react';

import { useRouter } from '@/i18n/navigation';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Runs a trips server action from a client component: pending state, the
 * error key it returned, and a refresh of the server components on success so
 * the recomputed budget appears without a reload.
 */
export function useTripAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (action: () => Promise<RecordActionResult>, onDone?: (result: RecordActionResult) => void) => {
      setError(null);
      startTransition(async () => {
        try {
          const result = await action();
          if (result.error) {
            setError(result.error);
            return;
          }
          onDone?.(result);
          router.refresh();
        } catch {
          setError('network');
        }
      });
    },
    [router],
  );

  return { run, pending, error, setError } as const;
}

/** A random v4 id for idempotent creates, generated on the device. */
export function clientRef(): string {
  return crypto.randomUUID();
}
