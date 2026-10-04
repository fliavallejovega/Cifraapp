'use client';

import { Button, Card, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type ReactNode } from 'react';

import { useRouter } from '@/i18n/navigation';
import { answerRepeat } from '@/server/import-actions';

/**
 * «Is this one movement or two?» — asked where the files are being read.
 *
 * Every line here sits in more than one pending file of the same account. The
 * answer is the person's, never the engine's: two coffees at the same place
 * on the same day for the same price are real. «It is one» is the first
 * button because overlapping screenshots are by far the common case.
 */

export interface RepeatItem {
  readonly key: string;
  readonly accountId: string;
  readonly fingerprint: string;
  readonly accountName: string;
  readonly date: string;
  readonly description: string;
  /** Formatted on the server, where the money lives. */
  readonly amount: ReactNode;
  readonly files: readonly string[];
}

export function RepeatQuestions({
  items,
  locale,
}: {
  readonly items: readonly RepeatItem[];
  readonly locale: string;
}) {
  const t = useTranslations('repeatQuestions');
  const [answered, setAnswered] = useState<ReadonlyMap<string, boolean>>(new Map());
  const open = items.filter((item) => !answered.has(item.key));
  if (items.length === 0) return null;

  return (
    <Card tone="sunk">
      <h2 className="text-base font-medium text-balance">{t('title', { count: open.length })}</h2>
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
    <li className="flex flex-col gap-2 border-t border-[color:var(--color-rule)] pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">
          {item.description}
        </p>
        <span className="shrink-0">{item.amount}</span>
      </div>
      <p className="text-xs [overflow-wrap:anywhere] text-[color:var(--color-ink-secondary)]">
        {item.accountName} · {item.date}
      </p>
      <p className="text-xs [overflow-wrap:anywhere] text-[color:var(--color-ink-secondary)]">
        {t('inFiles', { count: item.files.length, files: item.files.join(', ') })}
      </p>
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
