'use client';

import { Money, type CurrencyCode } from '@app/domain';
import { Button, Card, Field, Input, Select, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  ClientLodging,
  ClientLodgingOption,
  ClientLodgingStop,
  ClientNotice,
} from '@/lib/rumbo-types';
import {
  addLodgingOption,
  removeLodgingOption,
  setMyLodgingPrice,
  applyLodgingOption,
} from '@/server/rumbo-actions';

import { useTripAction } from '../trips/use-trip-action';

/**
 * Where to sleep: one list per stop, the person's own price, and totals that
 * follow every keystroke. Prices are typed in the trip's currency and saved
 * on their own; nothing here pays or books — «Reservar» opens the listing
 * with the dates and party size filled in, «Ver fotos» opens its own photo
 * tour. No third-party photo is embedded.
 */

const AMOUNT = /^\d{1,12}(\.\d{1,4})?$/;

function money(value: string | null, currency: string): Money | null {
  if (!value || !AMOUNT.test(value)) return null;
  return Money.fromDecimalString(value, currency as CurrencyCode);
}

export function LodgingBoard({
  tripId,
  data,
  locale,
}: {
  readonly tripId: string;
  readonly data: ClientLodging;
  readonly locale: string;
}) {
  const t = useTranslations('rumbo');
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.stops.map((s) => [s.legId, s.myPrice ? trimZeros(s.myPrice) : ''])),
  );
  const fmt = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: data.currency,
        maximumFractionDigits: 0,
      }),
    [locale, data.currency],
  );
  const show = (m: Money | null) => (m ? fmt.format(Number(m.toDecimalString())) : '—');

  const totals = useMemo(() => {
    const zero = Money.zero(data.currency as CurrencyCode);
    let mine = zero;
    let recommended = zero;
    let cheapest = zero;
    let nights = 0;
    let withPrice = 0;
    let toPrice = 0;
    for (const s of data.stops) {
      if (s.hosted) continue;
      toPrice += 1;
      nights += s.nights;
      const own = money(prices[s.legId] ?? null, data.currency);
      const rec = money(s.recommendedTotal, data.currency);
      const cheap = money(s.cheapestTotal, data.currency);
      if (own) withPrice += 1;
      const planned = own ?? rec;
      if (planned) mine = mine.add(planned);
      if (rec) recommended = recommended.add(rec);
      if (cheap) cheapest = cheapest.add(cheap);
    }
    return { mine, recommended, cheapest, nights, withPrice, toPrice };
  }, [data.stops, data.currency, prices]);

  if (data.stops.length === 0) {
    return (
      <Card>
        <p className="text-[color:var(--color-ink-secondary)]">{t('lodging.empty')}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Card tone="panel" padding="lg">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-[color:var(--color-panel-ink-secondary)]">
              {t('lodging.totals.myPlan')}
            </p>
            <p
              className="readout text-4xl tracking-[-0.03em] tabular-nums sm:text-5xl"
              aria-live="polite"
            >
              {show(totals.mine)}
            </p>
            <p className="text-sm text-[color:var(--color-panel-ink-secondary)]">
              {t('lodging.totals.progress', { done: totals.withPrice, total: totals.toPrice })}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <PanelFigure label={t('lodging.totals.recommended')} value={show(totals.recommended)} />
            <PanelFigure label={t('lodging.totals.cheapest')} value={show(totals.cheapest)} />
            <PanelFigure label={t('lodging.totals.nights')} value={String(totals.nights)} />
            <PanelFigure
              label={t('lodging.totals.average')}
              value={totals.nights > 0 ? show(totals.mine.divide(totals.nights)) : '—'}
            />
          </dl>
          <p className="text-xs text-[color:var(--color-panel-ink-secondary)]">
            {t('lodging.disclaimer')}
          </p>
        </div>
      </Card>

      {data.notices.length > 0 && <Notices notices={data.notices} />}

      <div className="flex flex-col gap-6">
        {data.stops.map((stop) => (
          <StopCard
            key={stop.legId}
            tripId={tripId}
            stop={stop}
            currency={data.currency}
            price={prices[stop.legId] ?? ''}
            onPrice={(value) => {
              setPrices((p) => ({ ...p, [stop.legId]: value }));
            }}
            show={show}
          />
        ))}
      </div>

      <Card>
        <h3 className="mb-4 text-base font-medium">{t('lodging.summaryTable.title')}</h3>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="text-left text-[color:var(--color-ink-secondary)]">
                <th className="py-2 pr-4 font-normal">{t('lodging.summaryTable.stop')}</th>
                <th className="py-2 pr-4 text-right font-normal">
                  {t('lodging.summaryTable.recommended')}
                </th>
                <th className="py-2 pr-4 text-right font-normal">
                  {t('lodging.summaryTable.cheapest')}
                </th>
                <th className="py-2 text-right font-normal">{t('lodging.summaryTable.mine')}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.stops
                .filter((s) => !s.hosted)
                .map((s) => (
                  <tr key={s.legId} className="border-t border-[color:var(--color-rule)]">
                    <td className="py-2 pr-4">{s.placeName}</td>
                    <td className="py-2 pr-4 text-right">
                      {show(money(s.recommendedTotal, data.currency))}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {show(money(s.cheapestTotal, data.currency))}
                    </td>
                    <td className="py-2 text-right">
                      {show(money(prices[s.legId] ?? null, data.currency))}
                    </td>
                  </tr>
                ))}
              <tr className="border-t border-[color:var(--color-rule-strong)] font-medium">
                <td className="py-2 pr-4">{t('lodging.summaryTable.total')}</td>
                <td className="py-2 pr-4 text-right">{show(totals.recommended)}</td>
                <td className="py-2 pr-4 text-right">{show(totals.cheapest)}</td>
                <td className="py-2 text-right">{show(totals.mine)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function trimZeros(v: string): string {
  return v.includes('.') ? v.replace(/\.?0+$/, '') : v;
}

function PanelFigure({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-[color:var(--color-panel-ink-secondary)]">{label}</dt>
      <dd className="text-lg tabular-nums">{value}</dd>
    </div>
  );
}

export function Notices({ notices }: { readonly notices: readonly ClientNotice[] }) {
  const t = useTranslations('rumbo');
  return (
    <ul className="flex flex-col gap-2">
      {notices.map((n, i) => (
        <li key={String(i)} className="flex items-start gap-3 text-sm">
          <Status
            tone={
              n.severity === 'critical'
                ? 'signal'
                : n.severity === 'warning'
                  ? 'caution'
                  : 'neutral'
            }
          >
            {t(`severity.${n.severity}`)}
          </Status>
          <span className="min-w-0 text-pretty">{n.text}</span>
        </li>
      ))}
    </ul>
  );
}

function StopCard({
  tripId,
  stop,
  currency,
  price,
  onPrice,
  show,
}: {
  readonly tripId: string;
  readonly stop: ClientLodgingStop;
  readonly currency: string;
  readonly price: string;
  readonly onPrice: (value: string) => void;
  readonly show: (m: Money | null) => string;
}) {
  const t = useTranslations('rumbo');
  const te = useTranslations('rumbo.errors');
  const { run, pending, error } = useTripAction();
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | null>(null);
  const valid = price === '' || AMOUNT.test(price);

  const save = (value: string) => {
    if (value !== '' && !AMOUNT.test(value)) return;
    run(
      () => setMyLodgingPrice({ tripId, legId: stop.legId, price: value === '' ? null : value }),
      () => {
        setSaved(true);
      },
    );
  };

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const airbnb = stop.options.filter((o) => o.provider === 'airbnb');
  const hotels = stop.options.filter((o) => o.provider !== 'airbnb');

  return (
    <Card padding="lg">
      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-xl font-medium text-balance">{stop.placeName}</h3>
            <p className="text-sm text-[color:var(--color-ink-secondary)]">
              {stop.dates} · {t('lodging.nights', { count: stop.nights })}
            </p>
          </div>
          {stop.hosted && <Status tone="positive">{t('lodging.hosted')}</Status>}
          {stop.paid && !stop.hosted && <Status tone="positive">{t('lodging.paid')}</Status>}
        </header>

        {!stop.hosted && (
          <>
            <Field
              label={t('lodging.myPrice')}
              hint={t('lodging.myPriceHint', { currency })}
              {...(!valid ? { error: te('invalid') } : error ? { error: te(error) } : {})}
            >
              {({ id, describedBy, invalid }) => (
                <div className="flex flex-wrap items-center gap-4">
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    numeric
                    inputMode="decimal"
                    value={price}
                    className="min-h-11 w-40"
                    onChange={(e) => {
                      const v = e.target.value.replace(',', '.').trim();
                      onPrice(v);
                      setSaved(false);
                      if (timer.current) window.clearTimeout(timer.current);
                      timer.current = window.setTimeout(() => {
                        save(v);
                      }, 700);
                    }}
                    onBlur={() => {
                      if (timer.current) window.clearTimeout(timer.current);
                      save(price);
                    }}
                  />
                  <span
                    className="text-sm text-[color:var(--color-ink-secondary)]"
                    aria-live="polite"
                  >
                    {pending ? t('lodging.saving') : saved ? t('lodging.saved') : ''}
                  </span>
                </div>
              )}
            </Field>

            <OptionList
              title={t('lodging.airbnb')}
              options={airbnb}
              tripId={tripId}
              currency={currency}
              nights={stop.nights}
              show={show}
              onUse={(o) => {
                if (o.total) onPrice(trimZeros(o.total));
              }}
            />
            {hotels.length > 0 && (
              <OptionList
                title={t('lodging.hotels')}
                options={hotels}
                tripId={tripId}
                currency={currency}
                nights={stop.nights}
                show={show}
                onUse={(o) => {
                  if (o.total) onPrice(trimZeros(o.total));
                }}
              />
            )}
            {stop.options.length === 0 && (
              <p className="text-sm text-[color:var(--color-ink-secondary)]">
                {t('lodging.noOptions')}
              </p>
            )}
            {stop.unconvertedOptions > 0 && (
              <p className="text-sm text-[color:var(--color-ink-secondary)]">
                {t('lodging.unconverted', { count: stop.unconvertedOptions })}
              </p>
            )}

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <a href={stop.airbnbSearchUrl} target="_blank" rel="noreferrer" className={LINK}>
                {t('lodging.searchAirbnb')}
              </a>
              <a href={stop.bookingSearchUrl} target="_blank" rel="noreferrer" className={LINK}>
                {t('lodging.searchBooking')}
              </a>
            </div>
            <AddOption tripId={tripId} legId={stop.legId} />
          </>
        )}
      </div>
    </Card>
  );
}

function OptionList({
  title,
  options,
  tripId,
  nights,
  show,
  currency,
  onUse,
}: {
  readonly title: string;
  readonly options: readonly ClientLodgingOption[];
  readonly tripId: string;
  readonly nights: number;
  readonly currency: string;
  readonly show: (m: Money | null) => string;
  readonly onUse: (o: ClientLodgingOption) => void;
}) {
  const t = useTranslations('rumbo');
  const { run, pending } = useTripAction();
  if (options.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-sm font-medium text-[color:var(--color-ink-secondary)]">{title}</h4>
      <ul className="flex flex-col">
        {options.map((o) => {
          const total = money(o.total, currency);
          return (
            <li
              key={o.id}
              className="flex flex-col gap-3 border-t border-[color:var(--color-rule)] py-4 first:border-t-0"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-pretty">{o.name}</span>
                    {o.recommended && <Status tone="positive">{t('lodging.recommended')}</Status>}
                    {o.cheapest && <Status tone="neutral">{t('lodging.cheapest')}</Status>}
                  </span>
                  <span className="text-sm text-[color:var(--color-ink-secondary)]">
                    {[
                      o.kind,
                      o.rating
                        ? t('lodging.rating', { rating: o.rating, count: o.reviews ?? 0 })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <div className="text-right tabular-nums">
                  <p className="text-lg">
                    {o.provider !== 'airbnb' && total ? `${t('lodging.from')} ` : ''}
                    {show(total)}
                  </p>
                  {total && nights > 0 && (
                    <p className="text-sm text-[color:var(--color-ink-secondary)]">
                      {t('lodging.perNight', { amount: show(total.divide(nights)) })}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                {total && (
                  <Button
                    className="min-h-11"
                    size="sm"
                    variant="secondary"
                    loading={pending}
                    onClick={() => {
                      onUse(o);
                      run(() => applyLodgingOption({ tripId, optionId: o.id }));
                    }}
                  >
                    {t('lodging.use')}
                  </Button>
                )}
                {o.bookUrl && (
                  <a href={o.bookUrl} target="_blank" rel="noreferrer" className={LINK}>
                    {t('lodging.book')}
                  </a>
                )}
                {o.photosUrl && (
                  <a href={o.photosUrl} target="_blank" rel="noreferrer" className={LINK}>
                    {t('lodging.photos')}
                  </a>
                )}
                <button
                  type="button"
                  className={`${LINK} text-[color:var(--color-ink-secondary)]`}
                  onClick={() => {
                    run(() => removeLodgingOption(tripId, o.id));
                  }}
                >
                  {t('lodging.remove')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AddOption({ tripId, legId }: { readonly tripId: string; readonly legId: string }) {
  const t = useTranslations('rumbo');
  const te = useTranslations('rumbo.errors');
  const { run, pending, error } = useTripAction();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<'airbnb' | 'booking' | 'other'>('airbnb');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [listingId, setListingId] = useState('');
  const [rating, setRating] = useState('');
  const [reviews, setReviews] = useState('');
  const [total, setTotal] = useState('');
  const [url, setUrl] = useState('');
  const [recommended, setRecommended] = useState(false);

  if (!open) {
    return (
      <div>
        <Button
          className="min-h-11"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('lodging.add.open')}
        </Button>
      </div>
    );
  }

  // A pasted Airbnb link fills the listing number.
  const onUrl = (value: string) => {
    setUrl(value);
    const m = /airbnb\.[a-z.]+\/rooms\/(\d+)/.exec(value);
    if (m?.[1]) {
      setProvider('airbnb');
      setListingId(m[1]);
    }
  };

  return (
    <form
      className="flex flex-col gap-4 rounded-(--radius-md) bg-[color:var(--color-ground-sunk)] p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            addLodgingOption({
              tripId,
              legId,
              provider,
              name,
              kind: kind || null,
              listingId: listingId || null,
              rating: rating ? rating.replace(',', '.') : null,
              reviews: reviews ? Number(reviews) : null,
              totalPrice: total ? total.replace(',', '.') : null,
              url: url || null,
              recommended,
            }),
          () => {
            setOpen(false);
            setName('');
            setKind('');
            setListingId('');
            setRating('');
            setReviews('');
            setTotal('');
            setUrl('');
            setRecommended(false);
          },
        );
      }}
    >
      <Field label={t('lodging.add.url')}>
        {({ id }) => (
          <Input
            className="min-h-11"
            id={id}
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => {
              onUrl(e.target.value);
            }}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('lodging.add.provider')}>
          {({ id }) => (
            <Select
              className="min-h-11"
              id={id}
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as typeof provider);
              }}
            >
              <option value="airbnb">{t('lodging.add.providers.airbnb')}</option>
              <option value="booking">{t('lodging.add.providers.booking')}</option>
              <option value="other">{t('lodging.add.providers.other')}</option>
            </Select>
          )}
        </Field>
        <Field label={t('lodging.add.name')} required>
          {({ id }) => (
            <Input
              className="min-h-11"
              id={id}
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t('lodging.add.total')}>
          {({ id }) => (
            <Input
              className="min-h-11"
              id={id}
              numeric
              inputMode="decimal"
              value={total}
              onChange={(e) => {
                setTotal(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t('lodging.add.kind')}>
          {({ id }) => (
            <Input
              className="min-h-11"
              id={id}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t('lodging.add.rating')}>
          {({ id }) => (
            <Input
              className="min-h-11"
              id={id}
              inputMode="decimal"
              value={rating}
              onChange={(e) => {
                setRating(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t('lodging.add.reviews')}>
          {({ id }) => (
            <Input
              className="min-h-11"
              id={id}
              inputMode="numeric"
              value={reviews}
              onChange={(e) => {
                setReviews(e.target.value);
              }}
            />
          )}
        </Field>
        {provider === 'airbnb' && (
          <Field label={t('lodging.add.listingId')} hint={t('lodging.add.listingHint')}>
            {({ id, describedBy }) => (
              <Input
                className="min-h-11"
                id={id}
                aria-describedby={describedBy}
                inputMode="numeric"
                value={listingId}
                onChange={(e) => {
                  setListingId(e.target.value);
                }}
              />
            )}
          </Field>
        )}
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={recommended}
          onChange={(e) => {
            setRecommended(e.target.checked);
          }}
        />
        {t('lodging.add.recommended')}
      </label>
      {error && <p className="text-sm text-[color:var(--color-negative)]">{te(error)}</p>}
      <div className="flex flex-wrap gap-4">
        <Button className="min-h-11" type="submit" loading={pending} disabled={name.trim() === ''}>
          {t('lodging.add.save')}
        </Button>
        <Button
          className="min-h-11"
          type="button"
          variant="ghost"
          onClick={() => {
            setOpen(false);
          }}
        >
          {t('lodging.add.cancel')}
        </Button>
      </div>
    </form>
  );
}

const LINK =
  'inline-flex min-h-11 items-center text-sm font-medium underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-ink)]';
