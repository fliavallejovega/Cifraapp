'use client';

import { Button, Card, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { Link, useRouter } from '@/i18n/navigation';
import { saveAllReviewed, type SaveAllResult } from '@/server/import-actions';

/**
 * Files read and not saved yet — the step that turns a reading into money on
 * every other screen.
 *
 * Until a file is saved its lines exist only here: not in movements, budgets,
 * income or reports. Saying that plainly is the point of this card, and one
 * button saves them all the way each review screen would. Repeated lines are
 * answered first; that is why the button waits for them.
 */

export interface AwaitingAccount {
  readonly accountId: string;
  readonly label: string;
  readonly files: number;
}

export function SaveAll({
  accounts,
  repeatsOpen,
  locale,
}: {
  readonly accounts: readonly AwaitingAccount[];
  readonly repeatsOpen: number;
  readonly locale: string;
}) {
  const t = useTranslations('saveAll');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SaveAllResult | null>(null);
  const files = accounts.reduce((sum, account) => sum + account.files, 0);

  if (files === 0 && !result?.filed) return null;

  return (
    <Card tone="sunk">
      <h2 className="text-base font-medium text-balance">{t('title', { files })}</h2>
      <p className="mt-1 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {t('detail')}
      </p>
      <ul className="mt-4 flex list-none flex-col gap-2 p-0">
        {accounts.map((account) => (
          <li key={account.accountId} className="flex flex-wrap justify-between gap-x-4 text-sm">
            <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{account.label}</span>
            <span className="tabular shrink-0 text-[color:var(--color-ink-secondary)]">
              {t('files', { count: account.files })}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {t('after')}
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <Button
          size="lg"
          className="self-start"
          loading={pending}
          disabled={repeatsOpen > 0 || files === 0}
          onClick={() => {
            setResult(null);
            start(async () => {
              const outcome = await saveAllReviewed({ locale });
              setResult(outcome);
              router.refresh();
            });
          }}
        >
          {t('action', { files })}
        </Button>
        {repeatsOpen > 0 && (
          <p className="text-sm text-[color:var(--color-caution)]">
            {t('answerFirst', { count: repeatsOpen })}
          </p>
        )}
        {result?.filed !== undefined && result.filed > 0 && (
          <div className="flex flex-col gap-1">
            <Status tone="positive">
              {t('done', { filed: result.filed, files: result.files ?? 0 })}
            </Status>
            <Link
              href="/review"
              className="inline-flex min-h-11 items-center self-start text-sm font-medium underline underline-offset-4"
            >
              {t('toReview')}
            </Link>
          </div>
        )}
        {result?.heldBack !== undefined && result.heldBack > 0 && (
          <Status tone="caution">{t('heldBack', { count: result.heldBack })}</Status>
        )}
        {result?.error === 'nothingFiled' && <Status tone="neutral">{t('nothing')}</Status>}
        {result?.error === 'repeatsOpen' && (
          <Status tone="caution">{t('answerFirst', { count: repeatsOpen || 1 })}</Status>
        )}
      </div>
    </Card>
  );
}
