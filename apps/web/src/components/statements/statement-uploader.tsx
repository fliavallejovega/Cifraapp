'use client';

import { Button, Field, Select } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';

import { useRouter } from '@/i18n/navigation';
import { useStatementQueue } from '@/lib/use-statement-queue';
import type { QueueEntry } from '@/server/repositories/statement-queue';

import { AccountQueue } from './account-queue';

/**
 * Uploading statements outside Gastos familiares: the import screen, where the
 * account is chosen first, and a card's own screen, where it already is.
 *
 * Same behaviour as the zones: several files at once, a bar per file while it
 * travels and while it is read, and the account's queue underneath — which
 * keeps its place if the app is closed, because it lives on the server.
 */

const ACCEPT =
  '.pdf,.csv,.ofx,.qfx,.xlsx,application/pdf,text/csv,application/x-ofx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*';

/** The choice that means «read the account from the statement». */
const DETECT = 'auto';

export interface UploaderAccount {
  readonly id: string;
  readonly label: string;
  readonly group: string;
}

export function StatementUploader({
  accounts,
  fixedAccountId,
  initialAccountId,
  queues,
  locale,
  labels,
}: {
  readonly accounts: readonly UploaderAccount[];
  /** The account is decided by the screen: no selector. */
  readonly fixedAccountId?: string;
  /** Preselected, e.g. when arriving from «upload a capture of that stretch». */
  readonly initialAccountId?: string;
  readonly queues: Readonly<Record<string, readonly QueueEntry[]>>;
  readonly locale: string;
  readonly labels: {
    readonly account: string;
    readonly accountHint: string;
    readonly hint: string;
    /** «Let the app find it»: the statement's own digits pick the account. */
    readonly detect?: string;
  };
}) {
  const t = useTranslations('statementQueue');
  // Without a choice the statement decides: its printed digits name the
  // account, or a new one is opened from what it prints.
  const detects = fixedAccountId === undefined && labels.detect !== undefined;
  const [accountId, setAccountId] = useState(
    fixedAccountId ??
      accounts.find((account) => account.id === initialAccountId)?.id ??
      (detects ? DETECT : (accounts[0]?.id ?? '')),
  );
  const router = useRouter();
  const [bumps, setBumps] = useState<Readonly<Record<string, number>>>({});
  const onQueued = useCallback(
    (id: string) => {
      setBumps((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
      // The account it went to exists only on the server now: fetch it.
      if (id === DETECT) router.refresh();
    },
    [router],
  );
  const queue = useStatementQueue(locale, onQueued);
  const picker = useRef<HTMLInputElement>(null);
  const label =
    accountId === DETECT
      ? (labels.detect ?? '')
      : (accounts.find((account) => account.id === accountId)?.label ?? '');

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  // On the import screen every account with something in its queue shows it,
  // each under its own name: files were dropped into several accounts and the
  // person wants to see all of them move, not only the one selected now.
  const shown = accounts.filter(
    (account) =>
      (queues[account.id]?.length ?? 0) > 0 ||
      (bumps[account.id] ?? 0) > 0 ||
      queue.items.some((item) => item.accountId === account.id),
  );

  const detecting = queue.items.filter((item) => item.accountId === DETECT);

  const groups = new Map<string, UploaderAccount[]>();
  for (const account of accounts) {
    groups.set(account.group, [...(groups.get(account.group) ?? []), account]);
  }

  return (
    <div id="subir" className="flex max-w-xl scroll-mt-24 flex-col gap-5">
      {fixedAccountId === undefined && accounts.length > 0 && (
        <Field label={labels.account} hint={labels.accountHint} required>
          {({ id, describedBy }) => (
            <Select
              id={id}
              className="h-11"
              aria-describedby={describedBy}
              value={accountId}
              onChange={(event) => {
                setAccountId(event.target.value);
              }}
            >
              {detects && <option value={DETECT}>{labels.detect}</option>}
              {[...groups.entries()].map(([group, entries]) => (
                <optgroup key={group} label={group}>
                  {entries.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>
      )}

      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          className="self-start"
          disabled={!accountId}
          aria-label={t('uploadLabel', { name: label })}
          onClick={() => picker.current?.click()}
        >
          {t('uploadMany')}
        </Button>
        <p className="max-w-[68ch] text-sm text-[color:var(--color-ink-secondary)]">
          {labels.hint}
        </p>
      </div>

      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          if (accountId) queue.add(event.target.files, accountId);
          event.target.value = '';
        }}
      />

      {fixedAccountId !== undefined
        ? accountId && (
            <AccountQueue
              key={accountId}
              accountId={accountId}
              initial={queues[accountId] ?? []}
              uploads={queue.items.filter((item) => item.accountId === accountId)}
              bump={bumps[accountId] ?? 0}
              locale={locale}
              onDismissUpload={queue.dismiss}
              onMoved={refresh}
              onSettled={refresh}
            />
          )
        : (shown.length > 0 || detecting.length > 0) && (
            <section aria-labelledby="statement-queues" className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 id="statement-queues" className="text-base font-medium">
                  {t('allTitle')}
                </h3>
                <p className="max-w-[68ch] text-sm text-[color:var(--color-ink-secondary)]">
                  {t('allDetail')}
                </p>
              </div>
              {detecting.length > 0 && (
                <AccountQueue
                  accountId={DETECT}
                  title={labels.detect ?? ''}
                  initial={[]}
                  uploads={detecting}
                  bump={0}
                  locale={locale}
                  onDismissUpload={queue.dismiss}
                />
              )}
              {shown.map((account) => (
                <AccountQueue
                  key={account.id}
                  accountId={account.id}
                  title={t('accountQueue', { name: account.label })}
                  initial={queues[account.id] ?? []}
                  uploads={queue.items.filter((item) => item.accountId === account.id)}
                  bump={bumps[account.id] ?? 0}
                  locale={locale}
                  onDismissUpload={queue.dismiss}
                  onMoved={refresh}
                  onSettled={refresh}
                />
              ))}
            </section>
          )}
    </div>
  );
}
