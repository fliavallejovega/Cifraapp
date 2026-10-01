'use client';

import { Button, Card, Field, Input, Select, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { formatAmount, formatDay } from '@/lib/trip-format';
import { deleteTripBooking, saveTripBooking } from '@/server/trip-actions';

import { useTripAction } from './use-trip-action';

/**
 * The trip's bookings: what is paid, what is still owed and when.
 *
 * Adding one asks only what changes the budget — type, amount, currency and
 * whether it is paid. Paying it can record the real movement from an account
 * in the same step, which also credits the trip's goal. Provider, reference
 * and dates are optional and folded away.
 */

const TYPES = ['flight', 'lodging', 'insurance', 'tour', 'transport', 'visa', 'other'] as const;
const STATUSES = ['paid', 'deposit_paid', 'pay_later', 'pay_on_site'] as const;
type BookingType = (typeof TYPES)[number];
type PaymentStatus = (typeof STATUSES)[number];

export interface BookingRow {
  readonly id: string;
  readonly bookingType: BookingType;
  readonly provider: string | null;
  readonly referenceCode: string | null;
  readonly amount: string;
  readonly currency: string;
  readonly amountBase: string;
  readonly paymentStatus: PaymentStatus;
  readonly paidAmount: string;
  readonly dueDate: string | null;
  readonly legId: string | null;
  readonly hasMovement: boolean;
}

const AMOUNT = /^\d{1,12}(\.\d{1,4})?$/;

export function BookingManager({
  tripId,
  bookings,
  legs,
  accounts,
  currencies,
  baseCurrency,
  today,
  locale,
}: {
  readonly tripId: string;
  readonly bookings: readonly BookingRow[];
  readonly legs: readonly { id: string; city: string }[];
  readonly accounts: readonly { id: string; name: string }[];
  readonly currencies: readonly string[];
  readonly baseCurrency: string;
  readonly today: string;
  readonly locale: string;
}) {
  const t = useTranslations('trips.dashboard.bookings');
  const tc = useTranslations('trips.common');
  const te = useTranslations('trips.errors');
  const { run, pending, error } = useTripAction();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<BookingType>('flight');
  const [provider, setProvider] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(baseCurrency);
  const [status, setStatus] = useState<PaymentStatus>('paid');
  const [paid, setPaid] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [legId, setLegId] = useState('');
  const [reference, setReference] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [recordPayment, setRecordPayment] = useState(accounts.length > 0);
  const [touched, setTouched] = useState(false);
  const lang = locale === 'en' ? 'en' : 'es';

  const reset = () => {
    setOpen(false);
    setProvider('');
    setAmount('');
    setPaid('');
    setDueDate('');
    setReference('');
    setTouched(false);
  };

  const submit = () => {
    setTouched(true);
    if (!AMOUNT.test(amount)) return;
    if (status === 'deposit_paid' && !AMOUNT.test(paid)) return;
    run(
      () =>
        saveTripBooking(
          tripId,
          {
            bookingType: type,
            provider: provider.trim() || null,
            referenceCode: reference.trim() || null,
            amount,
            currency,
            paymentStatus: status,
            paidAmount: status === 'deposit_paid' ? paid : '0',
            dueDate: status === 'paid' ? null : dueDate || null,
            legId: legId || null,
            payment:
              recordPayment && accountId && (status === 'paid' || status === 'deposit_paid')
                ? { accountId, paidOn: today }
                : null,
          },
          lang,
        ),
      reset,
    );
  };

  return (
    <div className="@container flex flex-col gap-4">
      {bookings.length === 0 ? (
        <Card tone="sunk">
          <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('empty')}</p>
        </Card>
      ) : (
        <Card padding="none">
          <ul className="flex flex-col divide-y divide-[color:var(--color-rule)]">
            {bookings.map((b) => {
              const owed = b.paymentStatus !== 'paid';
              return (
                <li
                  key={b.id}
                  className="flex flex-wrap items-start justify-between gap-3 p-4 @lg:p-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">
                      {tc(`bookingType.${b.bookingType}`)}
                      {b.provider ? ` · ${b.provider}` : ''}
                    </p>
                    <p className="text-sm text-[color:var(--color-ink-secondary)]">
                      {[
                        legs.find((l) => l.id === b.legId)?.city,
                        b.referenceCode,
                        b.dueDate && owed
                          ? t('due', {
                              date: formatDay(b.dueDate, locale, {
                                day: 'numeric',
                                month: 'short',
                              }),
                            })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <Status tone={owed ? 'caution' : 'positive'} className="mt-2">
                      {tc(`paymentStatus.${b.paymentStatus}`)}
                    </Status>
                  </div>
                  <div className="flex flex-col items-end gap-2 text-right">
                    <p className="tabular-nums">{formatAmount(b.amount, b.currency, locale)}</p>
                    {b.currency !== baseCurrency && (
                      <p className="text-sm text-[color:var(--color-ink-secondary)] tabular-nums">
                        {formatAmount(b.amountBase, baseCurrency, locale)}
                      </p>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-11"
                      disabled={pending}
                      onClick={() => {
                        if (
                          window.confirm(
                            b.hasMovement ? t('removeConfirmMovement') : t('removeConfirm'),
                          )
                        ) {
                          run(() => deleteTripBooking(tripId, b.id, {}, lang));
                        }
                      }}
                    >
                      {t('remove')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {open ? (
        <Card>
          <form
            className="grid gap-4 @lg:grid-cols-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Field label={t('type')}>
              {(f) => (
                <Select
                  id={f.id}
                  className="h-12 text-base"
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as BookingType);
                  }}
                >
                  {TYPES.map((ty) => (
                    <option key={ty} value={ty}>
                      {tc(`bookingType.${ty}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('provider')}>
              {(f) => (
                <Input
                  id={f.id}
                  className="h-12 text-base"
                  value={provider}
                  maxLength={120}
                  placeholder={t('providerPlaceholder')}
                  onChange={(e) => {
                    setProvider(e.target.value);
                  }}
                />
              )}
            </Field>
            <Field
              label={t('amount')}
              required
              {...(touched && !AMOUNT.test(amount) ? { error: te('amount') } : {})}
            >
              {(f) => (
                <Input
                  id={f.id}
                  aria-describedby={f.describedBy}
                  invalid={f.invalid}
                  inputMode="decimal"
                  numeric
                  className="h-12 text-base"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value.replace(/,/g, '.').replace(/[^\d.]/g, ''));
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
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('status')}>
              {(f) => (
                <Select
                  id={f.id}
                  className="h-12 text-base"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value as PaymentStatus);
                  }}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {tc(`paymentStatus.${s}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {status === 'deposit_paid' && (
              <Field
                label={t('paid')}
                required
                {...(touched && !AMOUNT.test(paid) ? { error: te('amount') } : {})}
              >
                {(f) => (
                  <Input
                    id={f.id}
                    inputMode="decimal"
                    numeric
                    className="h-12 text-base"
                    value={paid}
                    onChange={(e) => {
                      setPaid(e.target.value.replace(/,/g, '.').replace(/[^\d.]/g, ''));
                    }}
                  />
                )}
              </Field>
            )}
            {status !== 'paid' && (
              <Field label={t('dueDate')} hint={t('dueHint')}>
                {(f) => (
                  <Input
                    id={f.id}
                    type="date"
                    className="h-12 text-base"
                    value={dueDate}
                    onChange={(e) => {
                      setDueDate(e.target.value);
                    }}
                  />
                )}
              </Field>
            )}
            {legs.length > 1 && (
              <Field label={t('leg')}>
                {(f) => (
                  <Select
                    id={f.id}
                    className="h-12 text-base"
                    value={legId}
                    onChange={(e) => {
                      setLegId(e.target.value);
                    }}
                  >
                    <option value="">{t('wholeTrip')}</option>
                    {legs.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.city}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label={t('reference')}>
              {(f) => (
                <Input
                  id={f.id}
                  className="h-12 text-base"
                  value={reference}
                  maxLength={60}
                  onChange={(e) => {
                    setReference(e.target.value);
                  }}
                />
              )}
            </Field>
            {accounts.length > 0 && (status === 'paid' || status === 'deposit_paid') && (
              <div className="flex flex-col gap-3 @lg:col-span-2">
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[color:var(--color-panel)]"
                    checked={recordPayment}
                    onChange={(e) => {
                      setRecordPayment(e.target.checked);
                    }}
                  />
                  <span>{t('recordPayment')}</span>
                </label>
                {recordPayment && (
                  <Field label={t('account')}>
                    {(f) => (
                      <Select
                        id={f.id}
                        className="h-12 text-base"
                        value={accountId}
                        onChange={(e) => {
                          setAccountId(e.target.value);
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
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-[color:var(--color-negative)] @lg:col-span-2">
                {te.has(error) ? te(error) : te('saveFailed')}
              </p>
            )}
            <div className="flex flex-wrap gap-3 @lg:col-span-2">
              <Button type="submit" size="lg" loading={pending}>
                {t('save')}
              </Button>
              <Button variant="ghost" size="lg" onClick={reset}>
                {t('cancel')}
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Button
          variant="secondary"
          size="lg"
          className="self-start"
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('add')}
        </Button>
      )}
    </div>
  );
}
