'use client';

import { Button, Select, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useCallback, useRef, useState, type DragEvent } from 'react';

import { Link, useRouter } from '@/i18n/navigation';
import { AccountQueue } from '@/components/statements/account-queue';
import { useStatementQueue, type UploadItem } from '@/lib/use-statement-queue';
import { assignAccountOwner, type AccountActionResult } from '@/server/account-actions';
import type { BoardAccount, BoardPerson, FamilyBoard } from '@/server/repositories/family-expenses';

/**
 * Gastos familiares: one place per account to drop its statement.
 *
 * Built for the phone first. The person is standing somewhere with the bank's
 * app open; they took a screenshot or downloaded the PDF and want it filed
 * against the right card without choosing from a list. So every account is its
 * own target — tap «Subir estado» under the card the statement is from, and
 * the phone offers camera, photos and files on its own. On a computer the same
 * card takes a file dropped on it.
 *
 * Nothing is saved from here. A file is read and its movements wait on the
 * review screen; the line under the account says how many there were and how
 * many are new, and links to that review.
 */

const ACCEPT =
  '.pdf,.csv,.ofx,.qfx,.xlsx,application/pdf,text/csv,application/x-ofx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*';

export function UploadBoard({
  board,
  locale,
}: {
  readonly board: FamilyBoard;
  readonly locale: string;
}) {
  const t = useTranslations('familyExpenses');
  const router = useRouter();
  // A file just stored for an account: that account's queue polls right away.
  const [bumps, setBumps] = useState<Readonly<Record<string, number>>>({});
  const onQueued = useCallback((accountId: string) => {
    setBumps((current) => ({ ...current, [accountId]: (current[accountId] ?? 0) + 1 }));
  }, []);
  const queue = useStatementQueue(locale, onQueued);
  const picker = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);

  const pick = (accountId: string) => {
    target.current = accountId;
    picker.current?.click();
  };

  return (
    <div className="flex flex-col gap-12">
      {board.people.map((person) => (
        <PersonSection
          key={person.personId ?? 'shared'}
          person={person}
          owners={board.owners}
          locale={locale}
          uploads={queue.items}
          bumps={bumps}
          onPick={pick}
          onDrop={queue.add}
          onDismiss={queue.dismiss}
          onMoved={() => {
            router.refresh();
          }}
        />
      ))}

      <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('formats')}</p>

      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          if (target.current) queue.add(event.target.files, target.current);
          event.target.value = '';
        }}
      />
    </div>
  );
}

function PersonSection({
  person,
  owners,
  locale,
  uploads,
  bumps,
  onPick,
  onDrop,
  onDismiss,
  onMoved,
}: {
  readonly person: BoardPerson;
  readonly owners: FamilyBoard['owners'];
  readonly locale: string;
  readonly uploads: readonly UploadItem[];
  readonly bumps: Readonly<Record<string, number>>;
  readonly onPick: (accountId: string) => void;
  readonly onDrop: (files: FileList, accountId: string) => void;
  readonly onDismiss: (key: string) => void;
  readonly onMoved: () => void;
}) {
  const t = useTranslations('familyExpenses');
  const shared = person.personId === null;
  const empty = person.accounts.length === 0 && person.cards.length === 0;
  const headingId = `person-${person.personId ?? 'shared'}`;

  return (
    <section aria-labelledby={headingId} className="@container flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 id={headingId} className="flex flex-wrap items-center gap-2 text-lg font-medium">
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {shared ? t('shared') : person.name}
          </span>
          {person.isViewer && <Status tone="signal">{t('you')}</Status>}
        </h2>
        {shared && (
          <p className="max-w-[68ch] text-sm text-[color:var(--color-ink-secondary)]">
            {t('sharedHint')}
          </p>
        )}
      </header>

      {empty ? (
        <div className="flex flex-col gap-2 rounded-(--radius-md) border border-dashed border-[color:var(--color-rule-strong)] p-4">
          <p className="text-sm">{t('personEmpty', { name: person.name ?? '' })}</p>
          <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('personEmptyHint')}</p>
          <Link
            href="/accounts"
            className="inline-flex min-h-11 items-center self-start text-sm font-medium underline underline-offset-4 hover:no-underline"
          >
            {t('addAccount')}
          </Link>
        </div>
      ) : (
        <>
          {[
            ['accounts', person.accounts],
            ['cards', person.cards],
          ].map(([group, list]) =>
            (list as readonly BoardAccount[]).length === 0 ? null : (
              <div key={group as string} className="flex flex-col gap-2">
                <h3 className="text-xs font-medium tracking-wide text-[color:var(--color-ink-secondary)] uppercase">
                  {t(group as 'accounts' | 'cards')}
                </h3>
                <ul className="grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-3 p-0">
                  {(list as readonly BoardAccount[]).map((account) => (
                    <li key={account.id} className="min-w-0">
                      <AccountZone
                        account={account}
                        owners={shared ? owners : null}
                        locale={locale}
                        uploads={uploads.filter((item) => item.accountId === account.id)}
                        bump={bumps[account.id] ?? 0}
                        onPick={onPick}
                        onDrop={onDrop}
                        onDismiss={onDismiss}
                        onMoved={onMoved}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </>
      )}
    </section>
  );
}

function AccountZone({
  account,
  owners,
  locale,
  uploads,
  bump,
  onPick,
  onDrop,
  onDismiss,
  onMoved,
}: {
  readonly account: BoardAccount;
  /** Offered only where an account has no owner yet. */
  readonly owners: FamilyBoard['owners'] | null;
  readonly locale: string;
  readonly uploads: readonly UploadItem[];
  readonly bump: number;
  readonly onPick: (accountId: string) => void;
  readonly onDrop: (files: FileList, accountId: string) => void;
  readonly onDismiss: (key: string) => void;
  readonly onMoved: () => void;
}) {
  const t = useTranslations('familyExpenses');
  const tq = useTranslations('statementQueue');
  const [over, setOver] = useState(false);
  const label = account.maskedNumber
    ? `${account.name} ${t('zone.digits', { digits: account.maskedNumber })}`
    : account.name;

  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setOver(false);
    if (event.dataTransfer.files.length > 0) onDrop(event.dataTransfer.files, account.id);
  };

  // Reviews the queue below does not already show (older than its window).
  const inQueue = new Set(account.queue.map((entry) => entry.importId));
  const olderReviews = account.toReview.filter((entry) => !inQueue.has(entry.importId));
  const reviewTotal = olderReviews.reduce((sum, entry) => sum + entry.rows, 0);
  const firstReview = olderReviews[0];

  return (
    <article
      aria-label={label}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={drop}
      className={`relative flex h-full flex-col gap-3 rounded-(--radius-md) border bg-[color:var(--color-surface)] p-4 transition-colors duration-(--duration-quick) ${
        over
          ? 'border-[color:var(--color-brand)] bg-[color:var(--color-brand-sunk)]'
          : 'border-[color:var(--color-surface-border)]'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
          <p className="font-medium [overflow-wrap:anywhere]">
            {account.name}
            {account.maskedNumber && (
              <span className="tabular ml-2 font-normal text-[color:var(--color-ink-secondary)]">
                {t('zone.digits', { digits: account.maskedNumber })}
              </span>
            )}
          </p>
          {account.institutionName && (
            <p className="text-sm [overflow-wrap:anywhere] text-[color:var(--color-ink-secondary)]">
              {account.institutionName}
            </p>
          )}
        </div>
        <Button
          variant="secondary"
          size="md"
          className="min-h-11 shrink-0"
          aria-label={tq('uploadLabel', { name: label })}
          onClick={() => {
            onPick(account.id);
          }}
        >
          {tq('uploadMany')}
        </Button>
      </div>

      <CoverageLine account={account} locale={locale} />

      {firstReview && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Status tone="caution">{t('zone.toReview', { count: reviewTotal })}</Status>
          <Link
            href={`/documents/${firstReview.importId}`}
            className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 hover:no-underline"
          >
            {t('zone.review')}
          </Link>
        </div>
      )}

      <AccountQueue
        accountId={account.id}
        initial={account.queue}
        uploads={uploads}
        bump={bump}
        locale={locale}
        onDismissUpload={onDismiss}
        onMoved={onMoved}
      />

      {owners && owners.length > 0 && (
        <OwnerChoice accountId={account.id} owners={owners} locale={locale} />
      )}

      {over && (
        <p
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-(--radius-md) bg-[color:var(--color-brand-sunk)] p-4 text-center text-sm font-medium"
        >
          {t('zone.drop', { name: label })}
        </p>
      )}
    </article>
  );
}

function CoverageLine({
  account,
  locale,
}: {
  readonly account: BoardAccount;
  readonly locale: string;
}) {
  const t = useTranslations('familyExpenses');

  if (account.latestMonth === null) {
    return <Status tone="caution">{t('zone.never')}</Status>;
  }
  if (account.missingMonths.length > 0) {
    return (
      <Status tone="caution">
        {t('zone.missing', {
          months: new Intl.ListFormat(locale === 'en' ? 'en-US' : 'es-PA', {
            type: 'conjunction',
          }).format(account.missingMonths.map((month) => monthName(month, locale))),
        })}
      </Status>
    );
  }
  return (
    <Status tone="positive">
      {t('zone.upToDate', { month: monthName(account.latestMonth, locale) })}
    </Status>
  );
}

function OwnerChoice({
  accountId,
  owners,
  locale,
}: {
  readonly accountId: string;
  readonly owners: FamilyBoard['owners'];
  readonly locale: string;
}) {
  const t = useTranslations('familyExpenses');
  const [state, action, pending] = useActionState<AccountActionResult, FormData>(
    assignAccountOwner,
    {},
  );
  const form = useRef<HTMLFormElement>(null);
  const id = `owner-${accountId}`;

  return (
    <form ref={form} action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={accountId} />
      <input type="hidden" name="locale" value={locale} />
      <label htmlFor={id} className="text-sm text-[color:var(--color-ink-secondary)]">
        {t('owner.label')}
      </label>
      <Select
        id={id}
        className="h-11"
        name="personId"
        defaultValue=""
        disabled={pending}
        onChange={() => form.current?.requestSubmit()}
      >
        <option value="">{t('owner.household')}</option>
        {owners.map((owner) => (
          <option key={owner.id} value={owner.id}>
            {owner.name}
          </option>
        ))}
      </Select>
      {state.error && <Status tone="negative">{t('owner.failed')}</Status>}
    </form>
  );
}

/** `2026-08` as «agosto de 2026», in the reader's language. */
function monthName(month: string, locale: string): string {
  const [year = '', index = ''] = month.split('-');
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(year), Number(index) - 1, 1)));
}
