'use client';

import { convertToLocal, DAILY_CATEGORIES, type DailyCategory } from '@app/trip-engine';
import { Button, Card, Field, Input, Select, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';

import { useRouter } from '@/i18n/navigation';
import { enqueue, pending as pendingQueue, remove as removeQueued } from '@/lib/offline-queue';
import { formatAmount, formatDay, shareOf } from '@/lib/trip-format';
import { uploadTripDocuments } from '@/server/trip-document-actions';
import {
  deleteTripExpense,
  recordTripExpense,
  releaseReserve,
  type TripExpenseInput,
} from '@/server/trip-actions';

/**
 * The trip, today: what can still be spent, and the fastest way to record
 * what was. Three taps — «+ Gasto», the amount, the category — and it is
 * filed. Without a signal it waits on the phone and goes when the signal
 * comes back, once.
 */

export interface TodayData {
  readonly tripId: string;
  readonly today: string;
  readonly dayNumber: number;
  readonly totalDays: number;
  readonly legCity: string | null;
  readonly tripName: string;
  readonly baseCurrency: string;
  readonly localCurrency: string;
  readonly localMinor: number;
  /** Local units per base unit, when the leg is in another currency. */
  readonly rate: string | null;
  readonly allowed: string;
  readonly spent: string;
  readonly remaining: string;
  readonly overspent: string;
  readonly byCategory: Readonly<
    Record<DailyCategory, { allowed: string; spent: string; remaining: string }>
  >;
  readonly rollingNote: { tone: 'positive' | 'caution'; text: string } | null;
  readonly overCategories: readonly string[];
  readonly days: readonly {
    date: string;
    state: 'none' | 'ok' | 'near' | 'over';
    timing: 'past' | 'today' | 'future';
    planned: string;
    spent: string;
  }[];
  readonly expenses: readonly {
    id: string;
    category: string | null;
    description: string;
    amount: string;
    originalAmount: string | null;
    originalCurrency: string | null;
  }[];
  readonly accounts: readonly { id: string; name: string; type: string }[];
  readonly fundingAccountId: string | null;
  readonly cashAccountId: string | null;
  /** The rate the trip's cash was actually bought at, for expenses paid in cash. */
  readonly cashRate: string | null;
  readonly travelers: readonly { id: string; displayName: string }[];
  readonly reserveAvailable: string;
  readonly shortfall: string;
  readonly phase: 'before' | 'during' | 'after';
}

const AMOUNT = /^\d{1,12}(\.\d{1,4})?$/;
const lang = (locale: string): 'en' | 'es' => (locale === 'en' ? 'en' : 'es');

function normalize(raw: string): string {
  const text = raw.replace(/[^\d.,]/g, '');
  const last = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','));
  if (last >= 0 && text.length - last - 1 <= 2)
    return `${text.slice(0, last).replace(/[.,]/g, '')}.${text.slice(last + 1)}`;
  return text.replace(/[.,]/g, '');
}

export function TodayView({ data, locale }: { readonly data: TodayData; readonly locale: string }) {
  const t = useTranslations('trips.today');
  const tc = useTranslations('trips.common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [queued, setQueued] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [syncing, startSync] = useTransition();
  const foreign = data.localCurrency !== data.baseCurrency && data.rate !== null;
  const local = (value: string): string =>
    foreign && data.rate
      ? formatAmount(
          convertToLocal(value, data.rate, { minorUnits: 2 }, { minorUnits: data.localMinor }),
          data.localCurrency,
          locale,
        )
      : formatAmount(value, data.baseCurrency, locale);
  const base = (value: string): string => formatAmount(value, data.baseCurrency, locale);

  /** Sends whatever waited without a signal. Idempotent: the server files each clientRef once. */
  const flush = useCallback(() => {
    startSync(async () => {
      const items = await pendingQueue(data.tripId);
      let sent = 0;
      for (const item of items) {
        try {
          const result = await recordTripExpense(item.payload as TripExpenseInput, lang(locale));
          if (!result.error || result.error === 'invalid') {
            await removeQueued(item.clientRef);
            if (!result.error) sent += 1;
          }
        } catch {
          break;
        }
      }
      setQueued((await pendingQueue(data.tripId)).length);
      if (sent > 0) {
        setToast(t('synced', { count: sent }));
        router.refresh();
      }
    });
  }, [data.tripId, locale, router, t]);

  useEffect(() => {
    void pendingQueue(data.tripId).then((items) => {
      setQueued(items.length);
      if (items.length > 0 && navigator.onLine) flush();
    });
    const online = () => {
      flush();
    };
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('online', online);
    };
  }, [data.tripId, flush]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 4000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const over = data.overspent !== '0.00' && data.overspent !== '0';
  const share = shareOf(data.spent, data.allowed);

  return (
    <div className="flex flex-col gap-6">
      <Card tone="panel" padding="lg">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[color:var(--color-panel-ink-secondary)]">
            <span className="font-medium text-[color:var(--color-panel-ink)]">{data.tripName}</span>
            {' · '}
            {t('dayOf', { day: data.dayNumber, total: data.totalDays })}
            {data.legCity ? ` · ${data.legCity}` : ''}
          </p>
          <p className="text-sm text-[color:var(--color-panel-ink-secondary)]">
            {over ? t('overLabel') : t('remainingLabel')}
          </p>
          <p className="readout text-5xl tracking-[-0.03em] tabular-nums">
            {over ? local(data.overspent) : local(data.remaining)}
          </p>
          {foreign && (
            <p className="text-[color:var(--color-panel-ink-secondary)] tabular-nums">
              {base(over ? data.overspent : data.remaining)}
            </p>
          )}
          <div
            className="h-2 overflow-hidden rounded-full bg-[color:var(--color-panel-raised)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(share)}
            aria-label={t('spentOf', { spent: local(data.spent), allowed: local(data.allowed) })}
          >
            <div
              className="h-full origin-left rounded-full bg-[color:var(--color-brand)]"
              style={{ transform: `scaleX(${String(Math.min(1, share / 100))})` }}
            />
          </div>
          <p className="text-sm text-[color:var(--color-panel-ink-secondary)] tabular-nums">
            {t('spentOf', { spent: local(data.spent), allowed: local(data.allowed) })}
          </p>
        </div>
      </Card>

      {data.rollingNote && <Status tone={data.rollingNote.tone}>{data.rollingNote.text}</Status>}
      {data.overCategories.map((text) => (
        <Status key={text} tone="caution">
          {text}
        </Status>
      ))}
      {queued > 0 && (
        <Card tone="sunk">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">{t('queued', { count: queued })}</p>
            <Button variant="secondary" size="lg" loading={syncing} onClick={flush}>
              {t('syncNow')}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <p className="mb-3 font-medium">{t('byCategory')}</p>
        <ul className="flex flex-col gap-4">
          {DAILY_CATEGORIES.filter(
            (c) => data.byCategory[c].allowed !== '0.00' || data.byCategory[c].spent !== '0.00',
          ).map((c) => {
            const row = data.byCategory[c];
            const pct = shareOf(row.spent, row.allowed);
            const beyond = shareOf(row.allowed, row.spent) < 100 && row.spent !== '0.00';
            return (
              <li key={c} className="flex flex-col gap-1">
                <div className="flex justify-between gap-3 text-sm">
                  <span>{tc(`category.${c}`)}</span>
                  <span className="text-[color:var(--color-ink-secondary)] tabular-nums">
                    {beyond
                      ? t('categoryOver', { amount: local(row.spent) })
                      : t('categoryLeft', { amount: local(row.remaining) })}
                  </span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-[color:var(--color-ground-sunk)]"
                  aria-hidden="true"
                >
                  <div
                    className={`h-full origin-left rounded-full ${beyond ? 'bg-[color:var(--color-negative)]' : 'bg-[color:var(--color-ink-tertiary)]'}`}
                    style={{ transform: `scaleX(${String(Math.min(1, pct / 100))})` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <p className="mb-3 font-medium">{t('todayList')}</p>
        {data.expenses.length === 0 ? (
          <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('noExpenses')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[color:var(--color-rule)]">
            {data.expenses.map((e) => (
              <ExpenseRow
                key={e.id}
                expense={e}
                tripId={data.tripId}
                locale={locale}
                baseCurrency={data.baseCurrency}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <p className="mb-3 font-medium">{t('calendar')}</p>
        <ol className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {data.days.map((d) => (
            <li
              key={d.date}
              className={`flex min-h-16 flex-col justify-between rounded-(--radius-md) border p-2 text-xs ${d.timing === 'today' ? 'border-[color:var(--color-ink)]' : 'border-[color:var(--color-rule)]'}`}
            >
              <span className="font-medium">
                {formatDay(d.date, locale, { weekday: 'short', day: 'numeric' })}
              </span>
              <span
                className={
                  d.state === 'over'
                    ? 'text-[color:var(--color-negative)]'
                    : d.state === 'near'
                      ? 'text-[color:var(--color-caution)]'
                      : 'text-[color:var(--color-ink-secondary)]'
                }
              >
                {t(`dayState.${d.state}`)}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <ReserveCard data={data} locale={locale} />

      <QuickActions
        data={data}
        locale={locale}
        onOpen={() => {
          setOpen(true);
        }}
      />
      {open &&
        createPortal(
          <QuickAdd
            data={data}
            locale={locale}
            onClose={() => {
              setOpen(false);
            }}
            onSaved={(text, wasQueued) => {
              setOpen(false);
              setToast(text);
              if (wasQueued)
                void pendingQueue(data.tripId).then((items) => {
                  setQueued(items.length);
                });
              else router.refresh();
            }}
          />,
          document.body,
        )}
      {toast &&
        createPortal(
          <div
            role="status"
            className="fixed inset-x-4 bottom-28 z-30 mx-auto max-w-md rounded-(--radius-md) bg-[color:var(--color-panel)] px-4 py-3 text-sm text-[color:var(--color-panel-ink)] shadow-(--shadow-card)"
          >
            {toast}
          </div>,
          document.body,
        )}
    </div>
  );
}

function ExpenseRow({
  expense,
  tripId,
  locale,
  baseCurrency,
}: {
  readonly expense: TodayData['expenses'][number];
  readonly tripId: string;
  readonly locale: string;
  readonly baseCurrency: string;
}) {
  const t = useTranslations('trips.today');
  const tc = useTranslations('trips.common');
  const router = useRouter();
  const [pending, start] = useTransition();
  const magnitude = (v: string) => v.replace(/^-/, '');
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate">{expense.description}</p>
        <p className="text-sm text-[color:var(--color-ink-secondary)]">
          {expense.category ? tc(`category.${expense.category}`) : ''}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-right">
          <p className="tabular-nums">
            {expense.originalAmount && expense.originalCurrency
              ? formatAmount(magnitude(expense.originalAmount), expense.originalCurrency, locale)
              : formatAmount(magnitude(expense.amount), baseCurrency, locale)}
          </p>
          {expense.originalCurrency && (
            <p className="text-xs text-[color:var(--color-ink-secondary)] tabular-nums">
              {formatAmount(magnitude(expense.amount), baseCurrency, locale)}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-11"
          disabled={pending}
          aria-label={t('remove')}
          onClick={() => {
            if (!window.confirm(t('removeConfirm'))) return;
            start(async () => {
              await deleteTripExpense(tripId, expense.id, lang(locale));
              router.refresh();
            });
          }}
        >
          {t('remove')}
        </Button>
      </div>
    </li>
  );
}

function ReserveCard({ data, locale }: { readonly data: TodayData; readonly locale: string }) {
  const t = useTranslations('trips.today');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState(data.shortfall !== '0.00' ? data.shortfall : '');
  const [error, setError] = useState(false);
  if (data.reserveAvailable === '0.00') return null;
  return (
    <Card>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!AMOUNT.test(amount)) {
            setError(true);
            return;
          }
          start(async () => {
            const result = await releaseReserve(
              data.tripId,
              { amount, tripDay: data.today },
              lang(locale),
            );
            setError(Boolean(result.error));
            if (!result.error) {
              setAmount('');
              router.refresh();
            }
          });
        }}
      >
        <p className="font-medium">{t('reserveTitle')}</p>
        <p className="text-sm text-[color:var(--color-ink-secondary)]">
          {t('reserveBody', {
            amount: formatAmount(data.reserveAvailable, data.baseCurrency, locale),
          })}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field
            label={t('reserveAmount', { currency: data.baseCurrency })}
            className="sm:flex-1"
            {...(error ? { error: t('reserveError') } : {})}
          >
            {(f) => (
              <Input
                id={f.id}
                inputMode="decimal"
                numeric
                className="h-12 text-base"
                value={amount}
                onChange={(e) => {
                  setAmount(normalize(e.target.value));
                }}
              />
            )}
          </Field>
          <Button type="submit" variant="secondary" size="lg" loading={pending}>
            {t('useReserve')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function QuickActions({
  data,
  locale,
  onOpen,
}: {
  readonly data: TodayData;
  readonly locale: string;
  readonly onOpen: () => void;
}) {
  const t = useTranslations('trips.today');
  const router = useRouter();
  const camera = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  return (
    <div className="sticky bottom-0 z-20 -mx-5 border-t border-[color:var(--color-rule)] bg-[color:var(--color-ground-raised)] px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:-mx-10 sm:px-10">
      <div className="mx-auto flex max-w-3xl gap-3">
        <Button size="lg" className="flex-1" onClick={onOpen}>
          {t('addExpense')}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          loading={pending}
          onClick={() => camera.current?.click()}
        >
          {t('scan')}
        </Button>
        <input
          ref={camera}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            start(async () => {
              const form = new FormData();
              form.set('tripId', data.tripId);
              form.set('locale', locale);
              form.append('files', file);
              await uploadTripDocuments(form);
              router.push(`/trips/${data.tripId}#documents`);
            });
          }}
        />
      </div>
    </div>
  );
}

function QuickAdd({
  data,
  locale,
  onClose,
  onSaved,
}: {
  readonly data: TodayData;
  readonly locale: string;
  readonly onClose: () => void;
  readonly onSaved: (text: string, queued: boolean) => void;
}) {
  const t = useTranslations('trips.today');
  const tc = useTranslations('trips.common');
  const [amount, setAmount] = useState('');
  const [useLocal, setUseLocal] = useState(
    data.localCurrency !== data.baseCurrency && data.rate !== null,
  );
  const [more, setMore] = useState(false);
  const [note, setNote] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [day, setDay] = useState(data.today);
  const storageKey = `cifra.trip.account.${data.tripId}`;
  const [accountId, setAccountId] = useState(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved && data.accounts.some((a) => a.id === saved)) return saved;
    } catch {
      /* no storage */
    }
    return (
      data.fundingAccountId ??
      data.accounts.find((a) => a.type === 'cash')?.id ??
      data.accounts[0]?.id ??
      ''
    );
  });
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const currency = useLocal ? data.localCurrency : data.baseCurrency;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const save = (category: DailyCategory) => {
    setError(null);
    if (!AMOUNT.test(amount) || /^0+(\.0+)?$/.test(amount)) {
      setError(t('amountError'));
      document.getElementById('quick-amount')?.focus();
      return;
    }
    if (!accountId) {
      setError(t('accountError'));
      setMore(true);
      return;
    }
    try {
      window.localStorage.setItem(storageKey, accountId);
    } catch {
      /* not remembered */
    }
    const payload: TripExpenseInput = {
      tripId: data.tripId,
      clientRef: crypto.randomUUID(),
      accountId,
      amount,
      currency,
      // Cash bought for the trip is spent at the rate it was bought at.
      fxRate: useLocal
        ? accountId === data.cashAccountId && data.cashRate
          ? data.cashRate
          : data.rate
        : null,
      fxSource: useLocal && accountId === data.cashAccountId && data.cashRate ? 'manual' : 'ecb',
      category,
      tripDay: day,
      description: note.trim() || tc(`category.${category}`),
      paidByTravelerId: paidBy || null,
    };
    const label = t('saved', {
      amount: formatAmount(amount, currency, locale),
      category: tc(`category.${category}`),
    });
    start(async () => {
      if (!navigator.onLine) {
        await enqueue({
          clientRef: payload.clientRef,
          tripId: data.tripId,
          payload: payload,
          queuedAt: new Date().toISOString(),
        });
        onSaved(t('savedOffline'), true);
        return;
      }
      try {
        const result = await recordTripExpense(payload, lang(locale));
        if (result.error) {
          setError(
            t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('errors.saveFailed'),
          );
          return;
        }
        onSaved(label, false);
      } catch {
        await enqueue({
          clientRef: payload.clientRef,
          tripId: data.tripId,
          payload: payload,
          queuedAt: new Date().toISOString(),
        });
        onSaved(t('savedOffline'), true);
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-add-title"
        className="w-full max-w-lg rounded-t-(--radius-lg) bg-[color:var(--color-surface)] p-6 pb-[max(24px,env(safe-area-inset-bottom))] shadow-(--shadow-card) sm:rounded-(--radius-lg)"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="quick-add-title" className="text-lg font-medium">
            {t('addTitle')}
          </h2>
          <Button variant="ghost" size="sm" className="h-11" onClick={onClose}>
            {t('close')}
          </Button>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Input
            id="quick-amount"
            autoFocus
            aria-label={t('amount')}
            inputMode="decimal"
            numeric
            className="h-16 flex-1 text-3xl"
            placeholder="0"
            value={amount}
            onChange={(e) => {
              setAmount(normalize(e.target.value));
            }}
          />
          {data.localCurrency !== data.baseCurrency && data.rate !== null && (
            <div role="group" aria-label={t('currency')} className="flex flex-col gap-1">
              {[true, false].map((isLocal) => (
                <button
                  key={String(isLocal)}
                  type="button"
                  aria-pressed={useLocal === isLocal}
                  onClick={() => {
                    setUseLocal(isLocal);
                  }}
                  className={`h-11 min-w-16 rounded-(--radius-sm) border px-3 text-sm ${useLocal === isLocal ? 'border-[color:var(--color-ink)] bg-[color:var(--color-panel)] text-[color:var(--color-panel-ink)]' : 'border-[color:var(--color-rule)]'}`}
                >
                  {isLocal ? data.localCurrency : data.baseCurrency}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="mt-4 text-sm text-[color:var(--color-ink-secondary)]">{t('pickCategory')}</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {DAILY_CATEGORIES.map((c) => (
            <Button
              key={c}
              variant="secondary"
              size="lg"
              disabled={pending}
              className="h-14 px-3 text-sm whitespace-normal"
              onClick={() => {
                save(c);
              }}
            >
              {tc(`category.${c}`)}
            </Button>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-[color:var(--color-negative)]">
            {error}
          </p>
        )}
        <button
          type="button"
          className="mt-4 min-h-11 text-sm underline underline-offset-4"
          aria-expanded={more}
          onClick={() => {
            setMore(!more);
          }}
        >
          {more ? t('lessDetails') : t('moreDetails')}
        </button>
        {more && (
          <div className="mt-2 grid gap-3">
            <Field label={t('note')}>
              {(f) => (
                <Input
                  id={f.id}
                  className="h-12 text-base"
                  maxLength={200}
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                  }}
                />
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
                  {data.accounts.length === 0 && <option value="">{t('noAccounts')}</option>}
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {data.travelers.length > 1 && (
              <Field label={t('paidBy')}>
                {(f) => (
                  <Select
                    id={f.id}
                    className="h-12 text-base"
                    value={paidBy}
                    onChange={(e) => {
                      setPaidBy(e.target.value);
                    }}
                  >
                    <option value="">{t('paidByNone')}</option>
                    {data.travelers.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.displayName}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
