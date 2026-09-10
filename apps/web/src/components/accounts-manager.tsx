'use client';

import { Button, EmptyState, Field, Input, Problem, Select, Status } from '@app/ui';
import { useActionState, useState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { setAccountStatus, type AccountActionResult } from '@/server/account-actions';
import { createManualMovement } from '@/server/movement-actions';
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
  /** Whose it is, so a total can be broken down by person. */
  readonly personId: string | null;
  readonly personName: string | null;
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
  /** «Registrar un movimiento», que abre el formulario aquí mismo. */
  readonly addMovement: string;
  readonly quick: {
    readonly description: string;
    readonly amount: string;
    readonly date: string;
    readonly direction: string;
    readonly outflow: string;
    readonly inflow: string;
    readonly category: string;
    readonly categoryNone: string;
    readonly save: string;
    readonly saved: string;
  };
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
  /** Los rubros del hogar, para clasificar un movimiento al anotarlo. */
  readonly categories: readonly CategoryOption[];
  /** La fecha del hogar. Lo que se anota a mano suele ser de hoy. */
  readonly today: string;
  readonly groups: readonly { readonly key: string; readonly types: readonly string[] }[];
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly labels: AccountsManagerLabels;
}

export function AccountsManager({
  locale,
  currencySymbol,
  accounts,
  groups,
  people,
  categories,
  today,
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
              className="border-b border-[color:var(--color-rule)] last:border-b-0"
            >
              {editing === account.id ? (
                <div className="py-6">
                  <AccountForm
                    people={people}
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
                      personId: account.personId,
                    }}
                    onDone={() => {
                      setEditing(null);
                    }}
                  />
                </div>
              ) : (
                <AccountRow
                  locale={locale}
                  currencySymbol={currencySymbol}
                  account={account}
                  categories={categories}
                  today={today}
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
            people={people}
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
  currencySymbol,
  account,
  categories,
  today,
  labels,
  onEdit,
}: {
  readonly locale: string;
  readonly currencySymbol: string;
  readonly account: AccountRowView;
  readonly categories: readonly CategoryOption[];
  readonly today: string;
  readonly labels: AccountsManagerLabels;
  readonly onEdit: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [recording, setRecording] = useState(false);
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
        {/* Registrar a mano, aquí mismo. El efectivo es donde las cifras de una
            casa dejan de coincidir con su vida, y sacar a alguien a otra
            pantalla a buscar esta misma cuenta en una lista es el paso que hace
            que no se registre. */}
        {!archived && (
          <div className="mt-3">
            <button
              type="button"
              aria-expanded={recording}
              onClick={() => {
                setRecording(!recording);
              }}
              className="text-sm underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
            >
              {recording ? labels.cancel : labels.addMovement}
            </button>

            {recording && (
              <QuickMovement
                locale={locale}
                currencySymbol={currencySymbol}
                accountId={account.id}
                today={today}
                categories={categories}
                labels={labels}
                onDone={() => {
                  setRecording(false);
                }}
              />
            )}
          </div>
        )}
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

/** Un rubro del hogar, para clasificar sin salir de la cuenta. */
export interface CategoryOption {
  readonly id: string;
  readonly name: string;
}

/**
 * Anotar un movimiento en esta cuenta, sin salir de la lista.
 *
 * El efectivo es donde las cifras de una casa dejan de coincidir con su vida:
 * el taxi, la fonda, los veinte dólares al vecino. Nada de eso aparece en un
 * estado de cuenta, y un producto que sólo sabe lo que sabe el banco reporta
 * menos gasto del que hubo — lo que hace «disponible» generoso justo en la
 * dirección que duele.
 *
 * Lo que decide si se anota o no es cuántos pasos cuesta. Por eso vive aquí,
 * con la cuenta ya puesta y la fecha en hoy.
 */
function QuickMovement({
  locale,
  currencySymbol,
  accountId,
  today,
  categories,
  labels,
  onDone,
}: {
  readonly locale: string;
  readonly currencySymbol: string;
  readonly accountId: string;
  readonly today: string;
  readonly categories: readonly CategoryOption[];
  readonly labels: AccountsManagerLabels;
  readonly onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    createManualMovement,
    {},
  );

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="stay" value="true" />

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}
      {state.ok && <Status tone="positive">{labels.quick.saved}</Status>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={labels.quick.description} required className="sm:col-span-2">
          {({ id }) => <Input id={id} name="description" required maxLength={200} />}
        </Field>

        <Field label={labels.quick.amount} required>
          {({ id }) => (
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[color:var(--color-ink-tertiary)]"
              >
                {currencySymbol}
              </span>
              <Input
                id={id}
                name="amount"
                numeric
                inputMode="decimal"
                required
                placeholder="0.00"
                className="pl-8"
              />
            </div>
          )}
        </Field>

        <Field label={labels.quick.date} required>
          {({ id }) => (
            <Input id={id} name="transactionDate" type="date" required defaultValue={today} />
          )}
        </Field>

        <Field label={labels.quick.direction}>
          {({ id }) => (
            <Select id={id} name="direction" defaultValue="outflow">
              <option value="outflow">{labels.quick.outflow}</option>
              <option value="inflow">{labels.quick.inflow}</option>
            </Select>
          )}
        </Field>

        {categories.length > 0 && (
          <Field label={labels.quick.category}>
            {({ id }) => (
              <Select id={id} name="categoryId" defaultValue="">
                <option value="">{labels.quick.categoryNone}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {labels.quick.save}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {labels.cancel}
        </Button>
      </div>
    </form>
  );
}
