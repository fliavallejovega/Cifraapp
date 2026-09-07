'use client';

import { Button, EmptyState, Problem } from '@app/ui';
import { useActionState, useState } from 'react';

import { setAccountStatus, type AccountActionResult } from '@/server/account-actions';
import { AccountForm, type AccountFormLabels } from './account-form';

/**
 * The account list, and everything a person does to it.
 *
 * A statement table would be the wrong shape here: these rows are managed, not
 * read, so each one is a row with its own controls rather than a cell in a
 * ledger. The figures still sit in the measurement face and still align on the
 * right, because a column of balances that does not line up is a column nobody
 * can scan.
 *
 * Archiving asks first. It is reversible, so it is not destructive in the sense
 * the rules reserve that word for — but it removes an account from the position
 * and from the plan, and a figure that changes because of a mis-click is a
 * figure the person will not trust again.
 */

export interface AccountRowView {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly maskedNumber: string | null;
  /** Formatted for reading. */
  readonly balance: string;
  /** The plain decimal, for the edit form. */
  readonly rawBalance: string;
  readonly status: 'active' | 'closed' | 'archived';
  readonly transactionCount: number;
}

export interface AccountsManagerLabels {
  readonly form: AccountFormLabels;
  readonly addAction: string;
  readonly addTitle: string;
  readonly edit: string;
  readonly archive: string;
  readonly restore: string;
  readonly archiveConfirm: string;
  readonly archiveConfirmYes: string;
  readonly cancel: string;
  readonly archivedBadge: string;
  readonly movements: string;
  readonly noMovements: string;
  readonly maskPrefix: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly errorTitle: string;
  readonly errors: Record<string, string>;
  readonly types: Record<string, string>;
}

export interface AccountsManagerProps {
  readonly locale: string;
  readonly currencySymbol: string;
  readonly accounts: readonly AccountRowView[];
  readonly groups: readonly { readonly key: string; readonly types: readonly string[] }[];
  readonly labels: AccountsManagerLabels;
}

export function AccountsManager({
  locale,
  currencySymbol,
  accounts,
  groups,
  labels,
}: AccountsManagerProps) {
  // With nothing yet, the form is the screen — hiding the only useful action
  // behind a button would be a step that teaches nothing.
  const [adding, setAdding] = useState(accounts.length === 0);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-8">
      {accounts.length === 0 ? (
        <EmptyState title={labels.emptyTitle} body={labels.emptyBody} />
      ) : (
        <ul className="flex flex-col">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="border-t border-[color:var(--color-rule)] last:border-b"
            >
              {editing === account.id ? (
                <div className="py-6">
                  <AccountForm
                    locale={locale}
                    labels={labels.form}
                    groups={groups}
                    currencySymbol={currencySymbol}
                    account={{
                      id: account.id,
                      name: account.name,
                      type: account.type,
                      balance: account.rawBalance,
                      maskedNumber: account.maskedNumber,
                    }}
                    onDone={() => {
                      setEditing(null);
                    }}
                  />
                </div>
              ) : (
                <AccountRow
                  locale={locale}
                  account={account}
                  labels={labels}
                  onEdit={() => {
                    setEditing(account.id);
                    setAdding(false);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <section aria-label={labels.addTitle} className="flex flex-col gap-5">
          {accounts.length > 0 && (
            <h3 className="text-sm font-medium text-[color:var(--color-ink)]">{labels.addTitle}</h3>
          )}
          <AccountForm
            locale={locale}
            labels={labels.form}
            groups={groups}
            currencySymbol={currencySymbol}
            {...(accounts.length > 0
              ? {
                  onDone: () => {
                    setAdding(false);
                  },
                }
              : {})}
          />
        </section>
      ) : (
        <Button
          size="lg"
          className="self-start"
          onClick={() => {
            setAdding(true);
            setEditing(null);
          }}
        >
          {labels.addAction}
        </Button>
      )}
    </div>
  );
}

function AccountRow({
  locale,
  account,
  labels,
  onEdit,
}: {
  readonly locale: string;
  readonly account: AccountRowView;
  readonly labels: AccountsManagerLabels;
  readonly onEdit: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<AccountActionResult, FormData>(
    setAccountStatus,
    {},
  );

  const archived = account.status !== 'active';

  return (
    <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {/* A long account name wraps rather than pushing the balance off the
              row; `min-w-0` above is what lets it. */}
          <span className="font-medium break-words text-[color:var(--color-ink)]">
            {account.name}
          </span>
          {account.maskedNumber && (
            <span className="readout text-xs text-[color:var(--color-ink-tertiary)]">
              {labels.maskPrefix}
              {account.maskedNumber}
            </span>
          )}
          {archived && (
            <span className="gradation-label text-[color:var(--color-ink-tertiary)] uppercase">
              {labels.archivedBadge}
            </span>
          )}
        </p>
        <p className="mt-1 text-sm text-[color:var(--color-ink-secondary)]">
          {labels.types[account.type] ?? account.type}
          {' · '}
          {account.transactionCount === 0
            ? labels.noMovements
            : labels.movements.replace('{count}', String(account.transactionCount))}
        </p>
        {state.error && (
          <div className="mt-3 max-w-sm">
            <Problem
              title={labels.errorTitle}
              body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
            />
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-4 sm:justify-end">
        <span className="readout text-base text-[color:var(--color-ink)] tabular-nums">
          {account.balance}
        </span>

        {/* Restoring only ever adds an account back to the position, so it acts
            at once. Archiving takes one away, and asks. */}
        {archived ? (
          <form action={formAction} className="flex items-center gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={account.id} />
            <input type="hidden" name="status" value="active" />
            <Button type="submit" size="sm" variant="secondary" loading={pending}>
              {labels.restore}
            </Button>
          </form>
        ) : confirming ? (
          <form action={formAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={account.id} />
            <input type="hidden" name="status" value="archived" />
            <span className="text-xs text-[color:var(--color-ink-secondary)]">
              {labels.archiveConfirm}
            </span>
            <Button type="submit" size="sm" variant="secondary" loading={pending}>
              {labels.archiveConfirmYes}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              {labels.cancel}
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onEdit}>
              {labels.edit}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setConfirming(true);
              }}
            >
              {labels.archive}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
