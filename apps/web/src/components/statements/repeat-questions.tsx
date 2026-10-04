'use client';

import { Button, Card, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type ReactNode } from 'react';

import { useRouter } from '@/i18n/navigation';
import { answerRepeat, undoRepeatMerge } from '@/server/import-actions';

/**
 * Lines read twice, after the engine has done its part.
 *
 * First what it settled by itself — captures that overlap, references that
 * match — said plainly, each with a way back. Then only what it could not
 * settle, as a question carrying everything needed to answer it: the account,
 * whether money went out or came in, why the engine could not tell, and the
 * captures themselves.
 */

export interface RepeatItem {
  readonly key: string;
  readonly accountId: string;
  readonly fingerprint: string;
  /** «Pime panama · 8452». */
  readonly account: string;
  readonly date: string;
  readonly description: string;
  readonly outflow: boolean;
  /** Formatted on the server, where the money lives. */
  readonly amount: ReactNode;
  readonly files: readonly {
    readonly documentId: string;
    readonly fileName: string;
    readonly isImage: boolean;
  }[];
}

export interface MergedItem {
  readonly rowId: string;
  readonly account: string;
  readonly date: string;
  readonly description: string;
  readonly amount: ReactNode;
  readonly reason: 'same_reference' | 'screenshot_overlap' | 'screenshot_seam';
  readonly fileName: string;
}

export function RepeatQuestions({
  items,
  merged,
  locale,
}: {
  readonly items: readonly RepeatItem[];
  readonly merged: readonly MergedItem[];
  readonly locale: string;
}) {
  const t = useTranslations('repeatQuestions');
  const [answered, setAnswered] = useState<ReadonlyMap<string, boolean>>(new Map());
  const open = items.filter((item) => !answered.has(item.key));
  if (items.length === 0 && merged.length === 0) return null;

  return (
    <div className="flex flex-col gap-8">
      {merged.length > 0 && <MergedNotice merged={merged} locale={locale} />}
      {items.length > 0 && (
        <Card tone="sunk">
          <h2 className="text-base font-medium text-balance">
            {t('title', { count: open.length })}
          </h2>
          <p className="mt-1 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {t('detail')}
          </p>
          <ul className="mt-4 flex list-none flex-col gap-4 p-0">
            {items.map((item) => (
              <Question
                key={item.key}
                item={item}
                locale={locale}
                answer={answered.get(item.key)}
                onAnswered={(same) => {
                  setAnswered((current) => new Map(current).set(item.key, same));
                }}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function MergedNotice({
  merged,
  locale,
}: {
  readonly merged: readonly MergedItem[];
  readonly locale: string;
}) {
  const t = useTranslations('repeatQuestions');
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? merged : merged.slice(0, 3);
  return (
    <Card>
      <h2 className="text-base font-medium text-balance">
        {t('merged.title', { count: merged.length })}
      </h2>
      <p className="mt-1 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {t('merged.detail')}
      </p>
      <ul className="mt-4 flex list-none flex-col gap-3 p-0">
        {shown.map((item) => (
          <MergedLine key={item.rowId} item={item} locale={locale} />
        ))}
      </ul>
      {merged.length > 3 && (
        <button
          type="button"
          className="mt-2 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          {expanded ? t('merged.less') : t('merged.more', { count: merged.length - 3 })}
        </button>
      )}
    </Card>
  );
}

function MergedLine({ item, locale }: { readonly item: MergedItem; readonly locale: string }) {
  const t = useTranslations('repeatQuestions');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [undone, setUndone] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <li className="flex flex-col gap-1 border-t border-[color:var(--color-rule)] pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">
          {item.description}
        </p>
        <span className="shrink-0">{item.amount}</span>
      </div>
      <p className="text-xs [overflow-wrap:anywhere] text-[color:var(--color-ink-secondary)]">
        {item.account} · {item.date}
      </p>
      <p className="text-xs [overflow-wrap:anywhere] text-[color:var(--color-ink-secondary)]">
        {t(`merged.reason.${item.reason}`, { file: item.fileName })}
      </p>
      {undone ? (
        <Status tone="neutral">{t('merged.undone')}</Status>
      ) : (
        <button
          type="button"
          disabled={pending}
          className="inline-flex min-h-11 items-center self-start text-sm text-[color:var(--color-ink-secondary)] underline underline-offset-4 disabled:opacity-60"
          onClick={() => {
            setFailed(false);
            start(async () => {
              const result = await undoRepeatMerge({ rowId: item.rowId, locale });
              if (result.ok) {
                setUndone(true);
                router.refresh();
              } else {
                setFailed(true);
              }
            });
          }}
        >
          {t('merged.undo')}
        </button>
      )}
      {failed && <Status tone="negative">{t('failed')}</Status>}
    </li>
  );
}

function Question({
  item,
  locale,
  answer,
  onAnswered,
}: {
  readonly item: RepeatItem;
  readonly locale: string;
  readonly answer: boolean | undefined;
  readonly onAnswered: (same: boolean) => void;
}) {
  const t = useTranslations('repeatQuestions');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  const reply = (same: boolean) => {
    setFailed(false);
    setChoice(same);
    start(async () => {
      const result = await answerRepeat({
        accountId: item.accountId,
        fingerprint: item.fingerprint,
        same,
        locale,
      });
      if (result.ok) {
        onAnswered(same);
        router.refresh();
      } else {
        setFailed(true);
      }
    });
  };

  return (
    <li className="flex flex-col gap-3 border-t border-[color:var(--color-rule)] pt-4">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt className="text-[color:var(--color-ink-secondary)]">{t('field.account')}</dt>
        <dd className="m-0 font-medium [overflow-wrap:anywhere]">{item.account}</dd>
        <dt className="text-[color:var(--color-ink-secondary)]">{t('field.movement')}</dt>
        <dd className="m-0 [overflow-wrap:anywhere]">
          {item.outflow ? t('outflow') : t('inflow')} · {item.date}
        </dd>
        <dt className="text-[color:var(--color-ink-secondary)]">{t('field.amount')}</dt>
        <dd className="m-0">{item.amount}</dd>
        <dt className="text-[color:var(--color-ink-secondary)]">{t('field.bankSays')}</dt>
        <dd className="m-0 [overflow-wrap:anywhere]">{item.description}</dd>
      </dl>
      <p className="max-w-[68ch] text-xs text-pretty text-[color:var(--color-ink-secondary)]">
        {t('whyAsk', { count: item.files.length })}
      </p>
      <Captures files={item.files} />
      {answer === undefined ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="md"
            className="min-h-11"
            loading={pending && choice === true}
            disabled={pending}
            aria-label={t('sameLabel', { description: item.description })}
            onClick={() => {
              reply(true);
            }}
          >
            {t('same')}
          </Button>
          <Button
            size="md"
            variant="secondary"
            className="min-h-11"
            loading={pending && choice === false}
            disabled={pending}
            aria-label={t('differentLabel', { description: item.description })}
            onClick={() => {
              reply(false);
            }}
          >
            {t('different')}
          </Button>
        </div>
      ) : (
        <Status tone="positive">{answer ? t('answeredSame') : t('answeredDifferent')}</Status>
      )}
      {failed && <Status tone="negative">{t('failed')}</Status>}
    </li>
  );
}

/** The captures side by side; a tap opens one at full size in a new tab. */
function Captures({ files }: { readonly files: RepeatItem['files'] }) {
  const t = useTranslations('repeatQuestions');
  return (
    <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
      {files.map((file) => (
        <li key={file.documentId} className="flex min-w-0 flex-col gap-1">
          {file.isImage ? (
            <a
              href={`/api/documents/${file.documentId}/file`}
              target="_blank"
              rel="noopener"
              className="block overflow-hidden rounded-(--radius-sm) border border-[color:var(--color-rule)] bg-[color:var(--color-ground)]"
              aria-label={t('openCapture', { file: file.fileName })}
            >
              <img
                src={`/api/documents/${file.documentId}/file`}
                alt={t('captureAlt', { file: file.fileName })}
                loading="lazy"
                className="aspect-[9/16] w-full object-cover object-top"
              />
            </a>
          ) : null}
          <span className="truncate text-xs text-[color:var(--color-ink-secondary)]">
            {file.fileName}
          </span>
        </li>
      ))}
    </ul>
  );
}
