'use client';

import { Button, Field, Select } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useRouter } from '@/i18n/navigation';
import { formatAmount } from '@/lib/trip-format';
import { closeTrip, duplicateTripAsTemplate } from '@/server/trip-actions';

import { useTripAction } from './use-trip-action';

/**
 * Closing a trip: the report is frozen and, when money is left, the family
 * says where it goes — back into a goal, moved to an account, or left where
 * it is. The button reads out what will happen.
 */

type Destination = 'goal' | 'account' | 'none';

export function ClosePanel({
  tripId,
  surplus,
  currency,
  locale,
  goals,
  accounts,
  fundingAccountId,
}: {
  readonly tripId: string;
  readonly surplus: string;
  readonly currency: string;
  readonly locale: string;
  readonly goals: readonly { id: string; name: string }[];
  readonly accounts: readonly { id: string; name: string }[];
  readonly fundingAccountId: string | null;
}) {
  const t = useTranslations('trips.report.close');
  const { run, pending, error } = useTripAction();
  const hasSurplus = /[1-9]/.test(surplus);
  const options: Destination[] = hasSurplus
    ? [
        ...(goals.length > 0 ? (['goal'] as const) : []),
        ...(accounts.length > 1 ? (['account'] as const) : []),
        'none',
      ]
    : ['none'];
  const [destination, setDestination] = useState<Destination>(options[0] ?? 'none');
  const [goalId, setGoalId] = useState(goals[0]?.id ?? '');
  const from = fundingAccountId ?? accounts[0]?.id ?? '';
  const [toAccountId, setToAccountId] = useState(accounts.find((a) => a.id !== from)?.id ?? '');
  const amount = formatAmount(surplus, currency, locale);
  const lang = locale === 'en' ? 'en' : 'es';

  const goalName = goals.find((g) => g.id === goalId)?.name ?? '';
  const accountName = accounts.find((a) => a.id === toAccountId)?.name ?? '';
  const label = !hasSurplus
    ? t('submitPlain')
    : destination === 'goal'
      ? t('submitGoal', { amount, goal: goalName })
      : destination === 'account'
        ? t('submitAccount', { amount, account: accountName })
        : t('submitKeep');

  return (
    <form
      className="@container flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          closeTrip(
            tripId,
            destination === 'goal'
              ? { destination, goalId }
              : destination === 'account'
                ? { destination, toAccountId, fromAccountId: from }
                : { destination: 'none' },
            lang,
          ),
        );
      }}
    >
      <p className="text-sm text-[color:var(--color-ink-secondary)]">
        {hasSurplus ? t('bodySurplus', { amount }) : t('bodyNoSurplus')}
      </p>
      {hasSurplus && options.length > 1 && (
        <fieldset className="grid gap-3 @2xl:grid-cols-3">
          <legend className="sr-only">{t('legend')}</legend>
          {options.map((option) => {
            const checked = destination === option;
            return (
              <label
                key={option}
                className={`flex min-h-11 cursor-pointer flex-col gap-2 rounded-(--radius-lg) border p-4 ${checked ? 'border-[color:var(--color-ink)] bg-[color:var(--color-brand-sunk)]' : 'border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)]'}`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="destination"
                    className="h-5 w-5 accent-[color:var(--color-panel)]"
                    checked={checked}
                    onChange={() => {
                      setDestination(option);
                    }}
                  />
                  <span className="font-medium">{t(`option.${option}`)}</span>
                </span>
                <span className="text-sm text-[color:var(--color-ink-secondary)]">
                  {t(`optionDetail.${option}`)}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
      {hasSurplus && destination === 'goal' && (
        <Field label={t('goal')}>
          {(f) => (
            <Select
              id={f.id}
              className="h-12 text-base"
              value={goalId}
              onChange={(e) => {
                setGoalId(e.target.value);
              }}
            >
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {hasSurplus && destination === 'account' && (
        <Field label={t('account')}>
          {(f) => (
            <Select
              id={f.id}
              className="h-12 text-base"
              value={toAccountId}
              onChange={(e) => {
                setToAccountId(e.target.value);
              }}
            >
              {accounts
                .filter((a) => a.id !== from)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      )}
      {error && (
        <p role="alert" className="text-sm text-[color:var(--color-negative)]">
          {t('error')}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        loading={pending}
        className="h-auto! min-h-12 w-full py-3 text-center whitespace-normal! sm:w-auto sm:self-start"
      >
        {label}
      </Button>
    </form>
  );
}

export function TemplateButton({
  tripId,
  locale,
}: {
  readonly tripId: string;
  readonly locale: string;
}) {
  const tt = useTranslations('trips.report.template');
  const router = useRouter();
  const { run, pending, error } = useTripAction();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        size="lg"
        className="self-start"
        loading={pending}
        onClick={() => {
          run(
            () => duplicateTripAsTemplate(tripId, locale === 'en' ? 'en' : 'es'),
            (result) => {
              if (result.created) router.push(`/trips/${result.created}`);
            },
          );
        }}
      >
        {tt('action')}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-[color:var(--color-negative)]">
          {tt('error')}
        </p>
      )}
    </div>
  );
}
