'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { uploadStatement } from './statement-upload';

/**
 * The upload half of the queue: files on their way from the phone.
 *
 * Several files, each against its own account, sent one after another — a
 * phone on a cell connection finishes three PDFs sooner in a row than in
 * parallel. Each line shows how much has travelled. The moment a file is
 * stored the server owns it: the line leaves this list and appears in the
 * account's own queue, read from the server, where it keeps its place if the
 * app is closed.
 *
 * Until then the file only exists in the browser, so closing the app would
 * lose it: while anything is still travelling, leaving the page asks first.
 */

export type UploadState = 'waiting' | 'preparing' | 'sending' | 'failed';

export interface UploadItem {
  readonly key: string;
  readonly accountId: string;
  readonly fileName: string;
  readonly state: UploadState;
  /** 0 to 1, over the bytes sent. */
  readonly fraction: number;
  readonly error?: string;
  readonly detail?: string;
}

export function useStatementQueue(
  locale: string,
  onQueued: (accountId: string, jobId: string) => void,
) {
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  const pending = useRef<{ key: string; file: File; accountId: string }[]>([]);
  const running = useRef(false);
  const counter = useRef(0);
  const queued = useRef(onQueued);
  useEffect(() => {
    queued.current = onQueued;
  }, [onQueued]);

  const patch = useCallback((key: string, change: Partial<UploadItem>) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...change } : item)),
    );
  }, []);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (let next = pending.current.shift(); next; next = pending.current.shift()) {
        const { key, file, accountId } = next;
        try {
          const result = await uploadStatement(file, {
            accountId,
            locale,
            onProgress: ({ stage, fraction }) => {
              if (stage !== 'queued') patch(key, { state: stage, fraction });
            },
          });
          if (result.jobId) {
            setItems((current) => current.filter((item) => item.key !== key));
            queued.current(accountId, result.jobId);
          } else {
            patch(key, {
              state: 'failed',
              error: result.error ?? 'generic',
              ...(result.detail ? { detail: result.detail } : {}),
            });
          }
        } catch {
          patch(key, { state: 'failed', error: 'generic' });
        }
      }
    } finally {
      running.current = false;
    }
  }, [locale, patch]);

  const add = useCallback(
    (files: FileList | readonly File[] | null, accountId: string) => {
      if (!files || files.length === 0) return;
      const added = Array.from(files).map((file) => {
        counter.current += 1;
        const key = `${String(Date.now())}-${String(counter.current)}`;
        pending.current.push({ key, file, accountId });
        return {
          key,
          accountId,
          fileName: file.name,
          state: 'waiting',
          fraction: 0,
        } satisfies UploadItem;
      });
      setItems((current) => [...current, ...added]);
      void drain();
    },
    [drain],
  );

  const dismiss = useCallback((key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  // Closing the app mid-upload loses the file: ask first.
  const travelling = items.some((item) => item.state !== 'failed');
  useEffect(() => {
    if (!travelling) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [travelling]);

  return { items, add, dismiss };
}
