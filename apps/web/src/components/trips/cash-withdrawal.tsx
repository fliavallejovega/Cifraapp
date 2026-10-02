'use client';

import { Button, Card, Field, Input, Select } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { formatAmount } from '@/lib/trip-format';
import { recordCashWithdrawal } from '@/server/trip-actions';

import { useTripAction } from './use-trip-action';

/**
 * Buying local currency or taking cash from an ATM abroad. Two figures — what
 * was received and what the bank charged — and the rate follows from them;
 * the cash expenses afterwards use that rate, not the reference one.
 */

const AMOUNT = /^\d{1,12}(\.\d{1,4})?$/;
const clean = (v: string) => v.replace(/,/g, '.').replace(/[^\d.]/g, '');

export function CashWithdrawal({
  tripId,
  accounts,
  currencies,
  defaultCurrency,
  baseCurrency,
  today,
  locale,
  withdrawals,
}: {
  readonly tripId: string;
  readonly accounts: readonly { id: string; name: string }[];
  readonly currencies: readonly string[];
  readonly defaultCurrency: string;
  readonly baseCurrency: string;
  readonly today: string;
  readonly locale: string;
  readonly withdrawals: readonly {
    id: string;
    originalAmount: string | null;
    originalCurrency: string | null;
    amount: string;
    date: string;
  }[];
}) {
  const t = useTranslations('trips.cash');
  const { run, pending, error } = useTripAction();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(accounts[0]?.id ?? '');
  const [local, setLocal] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [base, setBase] = useState('');
  const [fee, setFee] = useState('');
  const [day, setDay] = useState(today);
  const [touched, setTouched] = useState(false);
  const lang = locale === 'en' ? 'en' : 'es';
  const foreignCurrencies = currencies.filter((c) => c !== baseCurrency);

  return (
    <Card>
      <div className="@container flex flex-col gap-4">
        {withdrawals.length > 0 && (
          <ul className="flex flex-col divide-y divide-[color:var(--color-rule)] text-sm">
            {withdrawals.map((w) => (
              <li key={w.id} className="flex justify-between gap-3 py-2 tabular-nums">
                <span>{w.date}</span>
                <span>
                  {w.originalAmount && w.originalCurrency
                    ? formatAmount(w.originalAmount.replace(/^-/, ''), w.originalCurrency, locale)
                    : ''}
                  {' · '}
                  {formatAmount(w.amount.replace(/^-/, ''), baseCurrency, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {foreignCurrencies.length === 0 ? (
          <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('sameCurrency')}</p>
        ) : open ? (
          <form
            className="grid gap-4 @lg:grid-cols-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (
                !AMOUNT.test(local) ||
                !AMOUNT.test(base) ||
                (fee !== '' && !AMOUNT.test(fee)) ||
                !from
              )
                return;
              run(
                () =>
                  recordCashWithdrawal(
                    tripId,
                    {
                      fromAccountId: from,
                      localAmount: local,
                      localCurrency: currency,
                      baseAmount: base,
                      fee: fee || null,
                      day,
                    },
                    lang,
                  ),
                () => {
                  setOpen(false);
                  setLocal('');
                  setBase('');
                  setFee('');
                  setTouched(false);
                },
              );
            }}
          >
            <Field
              label={t('received')}
              required
              {...(touched && !AMOUNT.test(local) ? { error: t('amountError') } : {})}
            >
              {(f) => (
                <Input
                  id={f.id}
                  inputMode="decimal"
                  numeric
                  className="h-12 text-base"
                  value={local}
                  onChange={(e) => {
                    setLocal(clean(e.target.value));
                  }}
                />
              )}
            </Field>
            <Field label={t('currency')}>
              {(f) => (
                <Select
                  id={f.id}
                  className="h-12 text-base"
                  value={currency}
                  onChange={(e) => {
                    setCurrency(e.target.value);
                  }}
                >
                  {foreignCurrencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label={t('charged', { currency: baseCurrency })}
              hint={t('chargedHint')}
              required
              {...(touched && !AMOUNT.test(base) ? { error: t('amountError') } : {})}
            >
              {(f) => (
                <Input
                  id={f.id}
                  aria-describedby={f.describedBy}
                  inputMode="decimal"
                  numeric
                  className="h-12 text-base"
                  value={base}
                  onChange={(e) => {
                    setBase(clean(e.target.value));
                  }}
                />
              )}
            </Field>
            <Field label={t('fee', { currency: baseCurrency })} hint={t('feeHint')}>
              {(f) => (
                <Input
                  id={f.id}
                  aria-describedby={f.describedBy}
                  inputMode="decimal"
                  numeric
                  className="h-12 text-base"
                  value={fee}
                  onChange={(e) => {
                    setFee(clean(e.target.value));
                  }}
                />
              )}
            </Field>
            <Field label={t('from')}>
              {(f) => (
                <Select
                  id={f.id}
                  className="h-12 text-base"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                  }}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('day')}>
              {(f) => (
                <Input
                  id={f.id}
                  type="date"
                  className="h-12 text-base"
                  value={day}
                  onChange={(e) => {
                    setDay(e.target.value);
                  }}
                />
              )}
            </Field>
            {error && (
              <p role="alert" className="text-sm text-[color:var(--color-negative)] @lg:col-span-2">
                {t('error')}
              </p>
            )}
            <div className="flex flex-wrap gap-3 @lg:col-span-2">
              <Button type="submit" size="lg" loading={pending}>
                {t('save')}
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  setOpen(false);
                }}
              >
                {t('cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('body')}</p>
            <Button
              variant="secondary"
              size="lg"
              className="self-start"
              onClick={() => {
                setOpen(true);
              }}
            >
              {t('open')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
