'use client';

import { Button, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';

import { Link } from '@/i18n/navigation';
import type { UploadItem } from '@/lib/use-statement-queue';
import { moveImportToAccount, readStatementQueue } from '@/server/import-actions';
import type { QueueEntry } from '@/server/repositories/statement-queue';

/**
 * One account's queue, with a bar per file that moves as it happens.
 *
 * Two sources, one list. On top, the files still travelling from this phone —
 * their bar is the bytes sent. Below, everything the server holds for this
 * account in the last hours, read from the jobs table: waiting, being read
 * (the bar is the reader's own progress and its stage), ready to review, or
 * failed. That half survives closing the app, because it never lived here.
 *
 * The list polls only while something is still moving, and slows down as the
 * wait goes on.
 */

const FIRST_POLL_MS = 1_500;
const MAX_POLL_MS = 6_000;

export function AccountQueue({
  accountId,
  initial,
  uploads,
  bump,
  locale,
  onDismissUpload,
  onMoved,
  onSettled,
  title,
}: {
  readonly accountId: string;
  readonly initial: readonly QueueEntry[];
  /** Files from this phone still on their way to this account. */
  readonly uploads: readonly UploadItem[];
  /** Changes whenever a file of this account was just queued: poll now. */
  readonly bump: number;
  readonly locale: string;
  readonly onDismissUpload: (key: string) => void;
  readonly onMoved?: () => void;
  /** Something that was being read finished: the screen around may change. */
  readonly onSettled?: () => void;
  /** Heading when several accounts' queues share a screen. */
  readonly title?: string;
}) {
  const t = useTranslations('statementQueue');
  const [entries, setEntries] = useState<readonly QueueEntry[]>(initial);
  const settled = useRef(onSettled);
  useEffect(() => {
    settled.current = onSettled;
  }, [onSettled]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setEntries(initial);
  }, [initial]);

  const moving = entries.some((e) => e.status === 'queued' || e.status === 'running');

  // When the last file finishes, what is around the queue — the history, the
  // repeat questions — is out of date. Once per transition, not per poll.
  const wasMoving = useRef(moving);
  useEffect(() => {
    if (wasMoving.current && !moving) settled.current?.();
    wasMoving.current = moving;
  }, [moving]);

  useEffect(() => {
    if (!moving && bump === 0) return;
    let cancelled = false;
    let interval = FIRST_POLL_MS;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { entries: fresh } = await readStatementQueue(accountId);
        if (cancelled) return;
        setEntries(fresh);
        if (!fresh.some((e) => e.status === 'queued' || e.status === 'running')) return;
      } catch {
        // A dropped poll is retried on the next tick.
      }
      interval = Math.min(MAX_POLL_MS, Math.round(interval * 1.3));
      if (!cancelled) timer = setTimeout(() => void poll(), interval);
    };
    timer = setTimeout(() => void poll(), bump > 0 ? 300 : FIRST_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accountId, moving, bump]);

  const visible = entries.filter((e) => !hidden.has(e.jobId));
  if (uploads.length === 0 && visible.length === 0) return null;
  const travelling = uploads.some((u) => u.state !== 'failed');

  return (
    <section
      aria-label={title ?? t('title')}
      className="flex flex-col gap-3 border-t border-[color:var(--color-rule)] pt-3"
    >
      <div className="flex flex-col gap-0.5">
        <h4 className="text-sm font-medium [overflow-wrap:anywhere]">{title ?? t('title')}</h4>
        <p className="text-xs text-[color:var(--color-ink-secondary)]">
          {travelling ? t('keepOpen') : t('detail')}
        </p>
      </div>
      <ul className="flex list-none flex-col gap-3 p-0">
        {uploads.map((upload) => (
          <li key={upload.key} className="flex flex-col gap-1.5">
            <Row name={upload.fileName}>
              {upload.state === 'failed' && (
                <DismissButton
                  name={upload.fileName}
                  onClick={() => {
                    onDismissUpload(upload.key);
                  }}
                />
              )}
            </Row>
            {upload.state === 'failed' ? (
              <UploadFailure error={upload.error} />
            ) : (
              <SeekBar
                label={upload.state === 'sending' ? t('sending') : t(upload.state)}
                fraction={upload.state === 'sending' ? upload.fraction : 0}
                name={upload.fileName}
              />
            )}
          </li>
        ))}
        {visible.map((entry) => (
          <li key={entry.jobId} className="flex flex-col gap-1.5">
            <Row name={entry.fileName}>
              {(entry.status === 'failed' ||
                entry.status === 'cancelled' ||
                (entry.status === 'succeeded' && !entry.awaitingReview)) && (
                <DismissButton
                  name={entry.fileName}
                  onClick={() => {
                    setHidden((current) => new Set([...current, entry.jobId]));
                  }}
                />
              )}
            </Row>
            <EntryState entry={entry} locale={locale} onMoved={onMoved} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EntryState({
  entry,
  locale,
  onMoved,
}: {
  readonly entry: QueueEntry;
  readonly locale: string;
  readonly onMoved: (() => void) | undefined;
}) {
  const t = useTranslations('statementQueue');

  if (entry.status === 'queued' || entry.status === 'running') {
    const stage = entry.status === 'queued' ? null : entry.stage;
    return (
      <SeekBar
        label={stage && t.has(`stage.${stage}`) ? t(`stage.${stage}`) : t('queued')}
        fraction={entry.progress / 100}
        name={entry.fileName}
      />
    );
  }

  if (entry.status === 'failed' || entry.status === 'cancelled') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Status tone="negative">{entry.status === 'failed' ? t('failed') : t('cancelled')}</Status>
        <Link
          href={`/documents/processing/${entry.jobId}`}
          className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
        >
          {t('whatHappened')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <SeekBar
        label={
          entry.found !== null && entry.found > 0
            ? t('ready', { found: entry.found, created: entry.created ?? 0 })
            : t('readyNothing')
        }
        fraction={1}
        name={entry.fileName}
        tone="positive"
      />
      {entry.mismatch && entry.awaitingReview && entry.importId && (
        <MismatchNotice
          mismatch={entry.mismatch}
          importId={entry.importId}
          locale={locale}
          onMoved={onMoved}
        />
      )}
      {entry.importId &&
        (entry.awaitingReview ? (
          <Link
            href={`/documents/${entry.importId}`}
            className="inline-flex min-h-11 items-center self-start text-sm font-medium underline underline-offset-4"
          >
            {t('review')}
          </Link>
        ) : (
          <Status tone="positive">{t('saved')}</Status>
        ))}
    </div>
  );
}

function MismatchNotice({
  mismatch,
  importId,
  locale,
  onMoved,
}: {
  readonly mismatch: NonNullable<QueueEntry['mismatch']>;
  readonly importId: string;
  readonly locale: string;
  readonly onMoved: (() => void) | undefined;
}) {
  const tf = useTranslations('familyExpenses');
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const suggested = mismatch.suggested;
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-(--radius-sm) border-l-2 border-[color:var(--color-caution)] bg-[color:var(--color-caution-sunk)] px-3 py-2"
    >
      <p className="text-sm [overflow-wrap:anywhere]">
        {tf('mismatch.body', { digits: mismatch.statedDigits, account: mismatch.uploadedTo })}{' '}
        {suggested
          ? tf('mismatch.suggest', { name: suggested.name })
          : tf('mismatch.noMatch', { digits: mismatch.statedDigits })}
      </p>
      {suggested && (
        <Button
          size="md"
          className="min-h-11 self-start"
          loading={pending}
          onClick={() => {
            setFailed(false);
            start(async () => {
              const result = await moveImportToAccount({
                importId,
                accountId: suggested.id,
                locale,
              });
              if (result.jobId) onMoved?.();
              else setFailed(true);
            });
          }}
        >
          {tf('mismatch.move', { name: suggested.name })}
        </Button>
      )}
      {failed && <Status tone="negative">{tf('mismatch.moveFailed')}</Status>}
    </div>
  );
}

/** The bar: how far, in words and in a number, never moving on a timer. */
function SeekBar({
  label,
  fraction,
  name,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly fraction: number;
  readonly name: string;
  readonly tone?: 'neutral' | 'positive';
}) {
  const t = useTranslations('statementQueue');
  const clamped = Math.max(0, Math.min(1, fraction));
  const percent = new Intl.NumberFormat(undefined, { style: 'percent' }).format(clamped);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 [overflow-wrap:anywhere] text-[color:var(--color-ink-secondary)]">
          {label}
        </span>
        <span className="tabular shrink-0 text-[color:var(--color-ink-secondary)]">{percent}</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-[color:var(--color-rule)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
        aria-label={t('progressLabel', { name, percent })}
      >
        <div
          className={`h-full origin-left transition-transform duration-500 ease-out motion-reduce:transition-none ${
            tone === 'positive'
              ? 'bg-[color:var(--color-positive)]'
              : 'bg-[color:var(--color-brand)]'
          }`}
          style={{ transform: `scaleX(${String(Math.max(0.02, clamped))})` }}
        />
      </div>
    </div>
  );
}

function Row({ name, children }: { readonly name: string; readonly children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
      {children}
    </div>
  );
}

function DismissButton({ name, onClick }: { readonly name: string; readonly onClick: () => void }) {
  const t = useTranslations('statementQueue');
  return (
    <button
      type="button"
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-(--radius-sm) px-2 text-sm text-[color:var(--color-ink-secondary)] hover:bg-[color:var(--color-ground-sunk)]"
      aria-label={t('dismissLabel', { name })}
      onClick={onClick}
    >
      {t('dismiss')}
    </button>
  );
}

function UploadFailure({ error }: { readonly error: string | undefined }) {
  const tf = useTranslations('familyExpenses');
  const key = `errors.${error ?? 'generic'}`;
  return <Status tone="negative">{tf.has(key) ? tf(key) : tf('errors.generic')}</Status>;
}
