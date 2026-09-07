'use client';

import { Button, Field, Input, Problem, Select } from '@app/ui';
import { useActionState, useState } from 'react';

import { createAccount, updateAccount, type AccountActionResult } from '@/server/account-actions';

/**
 * Creating and editing an account.
 *
 * The balance field is where this screen earns its keep. A person typing the
 * balance of a credit card has to know whether the product wants "-1,200" or
 * "1,200", and getting it wrong quietly inverts their net worth. So the hint is
 * bound to the selected type and changes as they choose: for a debt it asks for
 * what is owed, held positive, which is the convention `netWorth` already
 * assumes.
 */

export interface AccountFormLabels {
  readonly name: string;
  readonly nameHint: string;
  readonly type: string;
  readonly balance: string;
  readonly balanceHintAsset: string;
  readonly balanceHintDebt: string;
  readonly mask: string;
  readonly maskHint: string;
  readonly submitCreate: string;
  readonly submitUpdate: string;
  readonly cancel: string;
  readonly errorTitle: string;
  readonly errors: Record<string, string>;
  readonly types: Record<string, string>;
  readonly groups: Record<string, string>;
}

export interface AccountFormProps {
  readonly locale: string;
  readonly labels: AccountFormLabels;
  readonly groups: readonly { readonly key: string; readonly types: readonly string[] }[];
  readonly currencySymbol: string;
  /** Present when editing; absent when creating. */
  readonly account?: {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly balance: string;
    readonly maskedNumber: string | null;
  };
  readonly onDone?: () => void;
}

const DEBT_TYPES = new Set(['credit_card', 'loan', 'mortgage', 'other_liability']);

export function AccountForm({
  locale,
  labels,
  groups,
  currencySymbol,
  account,
  onDone,
}: AccountFormProps) {
  const editing = account !== undefined;
  const [state, formAction, pending] = useActionState<AccountActionResult, FormData>(
    editing ? updateAccount : createAccount,
    {},
  );

  // The most common first account, offered already chosen. Most people never
  // change a sensible default, and the ones who do are one keystroke away.
  const [type, setType] = useState(account?.type ?? 'checking');
  const isDebt = DEBT_TYPES.has(type);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      {editing && <input type="hidden" name="id" value={account.id} />}

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      <Field label={labels.name} hint={labels.nameHint} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="name"
            required
            maxLength={120}
            defaultValue={account?.name ?? ''}
            aria-describedby={describedBy}
          />
        )}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={labels.type}>
          {({ id }) => (
            <Select
              id={id}
              name="accountType"
              value={type}
              onChange={(event) => {
                setType(event.target.value);
              }}
            >
              {groups.map((group) => (
                <optgroup key={group.key} label={labels.groups[group.key] ?? ''}>
                  {group.types.map((value) => (
                    <option key={value} value={value}>
                      {labels.types[value] ?? value}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label={labels.balance}
          hint={isDebt ? labels.balanceHintDebt : labels.balanceHintAsset}
          required
        >
          {({ id, describedBy }) => (
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[color:var(--color-ink-tertiary)]"
              >
                {currencySymbol}
              </span>
              <Input
                id={id}
                name="balance"
                numeric
                required
                // A statement balance is precise and typed rarely: a plain
                // numeric field, not a stepper or a slider.
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={account?.balance ?? ''}
                aria-describedby={describedBy}
                className="pl-8"
              />
            </div>
          )}
        </Field>
      </div>

      <Field label={labels.mask} hint={labels.maskHint}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="maskedNumber"
            numeric
            inputMode="numeric"
            maxLength={4}
            placeholder="0000"
            defaultValue={account?.maskedNumber ?? ''}
            aria-describedby={describedBy}
            className="max-w-28 text-left"
          />
        )}
      </Field>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending} size="lg">
          {editing ? labels.submitUpdate : labels.submitCreate}
        </Button>
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            {labels.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}
