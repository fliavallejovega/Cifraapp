'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { readJobStatus } from '@/server/job-actions';
import type { JobView } from '@/server/repositories/jobs';

import { uploadStatement } from './statement-upload';

/**
 * Several statements, each against its own account, sent one after another.
 *
 * One at a time on purpose: a phone on a cell connection sending three PDFs in
 * parallel finishes all three later than in a row, and the platform runs one
 * reader per household anyway. Each file keeps its own line — preparing,
 * sending with how much has gone, being read, ready to review or what went
 * wrong — so a person who dropped four files knows what happened to each.
 *
 * Once a file is queued, the line watches its job until it settles, and slows
 * down as the wait goes on, the way the processing screen does.
 */

export type QueueItemState = 'waiting' | 'preparing' | 'sending' | 'reading' | 'ready' | 'failed';

export interface QueueItem {
  readonly key: string;
  readonly accountId: string;
  readonly fileName: string;
  readonly state: QueueItemState;
  /** 0 to 1 while sending; the job's own progress while reading. */
  readonly fraction: number;
  readonly error?: string;
  readonly detail?: string;
  readonly jobId?: string;
  readonly job?: JobView;
}

const FIRST_POLL_MS = 1_500;
const MAX_POLL_MS = 8_000;

export function useStatementQueue(locale: string) {
  const [items, setItems] = useState<readonly QueueItem[]>([]);
  const pending = useRef<{ key: string; file: File; accountId: string }[]>([]);
  const running = useRef(false);
  const counter = useRef(0);

  const patch = useCallback((key: string, change: Partial<QueueItem>) => {
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
              patch(key, {
                state: stage === 'queued' ? 'reading' : stage,
                fraction: stage === 'queued' ? 0 : fraction,
              });
            },
          });
          if (result.jobId) patch(key, { state: 'reading', jobId: result.jobId, fraction: 0 });
          else
            patch(key, {
              state: 'failed',
              error: result.error ?? 'generic',
              ...(result.detail ? { detail: result.detail } : {}),
            });
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
        const key = `${Date.now()}-${counter.current}`;
        pending.current.push({ key, file, accountId });
        return {
          key,
          accountId,
          fileName: file.name,
          state: 'waiting',
          fraction: 0,
        } satisfies QueueItem;
      });
      setItems((current) => [...current, ...added]);
      void drain();
    },
    [drain],
  );

  const dismiss = useCallback((key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  // Watch every line that is being read until its job settles.
  const watching = items
    .filter((item) => item.state === 'reading' && item.jobId)
    .map((item) => `${item.key}:${item.jobId ?? ''}`)
    .join(',');

  useEffect(() => {
    if (!watching) return;
    let cancelled = false;
    let interval = FIRST_POLL_MS;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      for (const pair of watching.split(',')) {
        const [key = '', jobId = ''] = pair.split(':');
        const { job } = await readJobStatus(jobId);
        if (cancelled) return;
        if (!job) continue;
        if (job.status === 'succeeded') patch(key, { state: 'ready', job, fraction: 1 });
        else if (job.status === 'failed' || job.status === 'cancelled')
          patch(key, {
            state: 'failed',
            job,
            error: 'readFailed',
            ...(job.errorMessage ? { detail: job.errorMessage } : {}),
          });
        else patch(key, { job, fraction: job.progress / 100 });
      }
      interval = Math.min(MAX_POLL_MS, Math.round(interval * 1.5));
      if (!cancelled) timer = setTimeout(() => void poll(), interval);
    };

    timer = setTimeout(() => void poll(), interval);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [watching, patch]);

  return { items, add, dismiss };
}
