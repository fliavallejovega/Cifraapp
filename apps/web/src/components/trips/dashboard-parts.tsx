'use client';

import { convertToLocal, DAILY_CATEGORIES, type TripBudget } from '@app/trip-engine';
import { Button, Card, Field, Input, Select, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { formatAmount } from '@/lib/trip-format';
import {
  activateTripScenario,
  addChecklistItem,
  deleteTripScenario,
  linkTripGoal,
  saveTripScenario,
  toggleChecklistItem,
} from '@/server/trip-actions';

import { useTripAction } from './use-trip-action';

type Locale = 'en' | 'es';
const asLocale = (locale: string): Locale => (locale === 'en' ? 'en' : 'es');

/**
 * The per diem, by leg and by category, in base or local currency, and per
 * traveller. Choosing a leg or a currency changes only the view: the figures
 * all come from the one budget the server computed.
 */
export function PerDiemPanel({
  budget,
  legs,
  travelers,
  currency,
  locale,
}: {
  readonly budget: TripBudget;
  readonly legs: readonly {
    id: string;
    city: string;
    localCurrency: string;
    rate: string | null;
  }[];
  readonly travelers: readonly { id: string; displayName: string }[];
  readonly currency: string;
  readonly locale: string;
}) {
  const tp = useTranslations('trips.dashboard.perDiem');
  const tc = useTranslations('trips.common');
  const [legId, setLegId] = useState(legs[0]?.id ?? '');
  const [local, setLocal] = useState(false);
  const leg = legs.find((l) => l.id === legId) ?? legs[0];
  const summary = budget.legs.find((l) => l.legId === leg?.id);
  const foreign = leg && leg.localCurrency !== currency && leg.rate;

  const show = (value: string): string => {
    if (local && foreign && leg.rate) {
      const minor = leg.localCurrency === 'JPY' || leg.localCurrency === 'CLP' ? 0 : 2;
      return formatAmount(
        convertToLocal(value, leg.rate, { minorUnits: 2 }, { minorUnits: minor }),
        leg.localCurrency,
        locale,
      );
    }
    return formatAmount(value, currency, locale);
  };

  if (!summary) return null;

  return (
    <Card>
      <div className="@container flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {legs.length > 1 ? (
            <div role="tablist" aria-label={tp('legs')} className="flex flex-wrap gap-2">
              {legs.map((l) => (
                <button
                  key={l.id}
                  role="tab"
                  type="button"
                  aria-selected={l.id === legId}
                  onClick={() => {
                    setLegId(l.id);
                  }}
                  className={`h-11 rounded-(--radius-md) border px-4 text-sm ${l.id === legId ? 'border-[color:var(--color-ink)] bg-[color:var(--color-brand-sunk)] font-medium' : 'border-[color:var(--color-rule)] text-[color:var(--color-ink-secondary)]'}`}
                >
                  {l.city}
                </button>
              ))}
            </div>
          ) : (
            <p className="font-medium">{leg?.city}</p>
          )}
          {foreign && (
            <div
              role="group"
              aria-label={tp('currency')}
              className="flex gap-1 rounded-(--radius-md) border border-[color:var(--color-rule)] p-1"
            >
              {[false, true].map((isLocal) => (
                <button
                  key={String(isLocal)}
                  type="button"
                  aria-pressed={local === isLocal}
                  onClick={() => {
                    setLocal(isLocal);
                  }}
                  className={`h-9 min-w-11 rounded-(--radius-sm) px-3 text-sm ${local === isLocal ? 'bg-[color:var(--color-panel)] text-[color:var(--color-panel-ink)]' : ''}`}
                >
                  {isLocal ? leg.localCurrency : currency}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-4 @lg:grid-cols-2">
          <div>
            <p className="text-sm text-[color:var(--color-ink-secondary)]">{tp('fullDay')}</p>
            <p className="readout text-3xl tabular-nums">
              {summary.perDiemFull ? show(summary.perDiemFull) : '—'}
            </p>
          </div>
          {summary.perDiemPartial && (
            <div>
              <p className="text-sm text-[color:var(--color-ink-secondary)]">{tp('partialDay')}</p>
              <p className="readout text-3xl tabular-nums">{show(summary.perDiemPartial)}</p>
            </div>
          )}
        </div>

        {summary.fullDay && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-t border-[color:var(--color-rule)] pt-4 text-sm">
            {DAILY_CATEGORIES.filter((c) => summary.fullDay?.[c] !== '0.00').map((c) => (
              <div key={c} className="contents">
                <dt>{tc(`category.${c}`)}</dt>
                <dd className="text-right tabular-nums">{show(summary.fullDay?.[c] ?? '0')}</dd>
              </div>
            ))}
          </dl>
        )}

        {summary.lodgingToBook && (
          <Status tone="caution">
            {tp('lodgingToBook', {
              amount: show(summary.lodgingToBook.perNight),
              nights: summary.lodgingToBook.nights,
            })}
          </Status>
        )}

        {budget.perTraveler.length > 1 && (
          <div className="border-t border-[color:var(--color-rule)] pt-4">
            <p className="mb-2 text-sm font-medium">{tp('perTraveler')}</p>
            <ul className="flex max-w-md flex-col gap-2 text-sm">
              {budget.perTraveler.map((p) => (
                <li key={p.travelerId} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {travelers.find((tr) => tr.id === p.travelerId)?.displayName}
                  </span>
                  <span className="tabular-nums">{show(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Creates the trip's savings goal from the dashboard. */
export function SaveForTripButton({
  tripId,
  locale,
}: {
  readonly tripId: string;
  readonly locale: string;
}) {
  const tsv = useTranslations('trips.dashboard.savings');
  const { run, pending, error } = useTripAction();
  return (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        loading={pending}
        onClick={() => {
          run(() => linkTripGoal(tripId, { create: true }, asLocale(locale)));
        }}
      >
        {tsv('create')}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-[color:var(--color-negative)]">
          {tsv('error')}
        </p>
      )}
    </div>
  );
}

export interface ScenarioRow {
  readonly id: string;
  readonly name: string;
  readonly total: string;
  readonly perDiem: string | null;
  readonly status: TripBudget['diagnostics']['status'];
}

/** Up to three what-ifs beside the plan: a different fund, style or exchange rate. */
export function ScenarioPanel({
  tripId,
  activeId,
  base,
  scenarios,
  currency,
  locale,
}: {
  readonly tripId: string;
  readonly activeId: string | null;
  readonly base: Omit<ScenarioRow, 'id' | 'name'>;
  readonly scenarios: readonly ScenarioRow[];
  readonly currency: string;
  readonly locale: string;
}) {
  const tsn = useTranslations('trips.dashboard.scenarios');
  const tc = useTranslations('trips.common');
  const { run, pending, error } = useTripAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [total, setTotal] = useState('');
  const [profile, setProfile] = useState<'economy' | 'balanced' | 'comfort'>('economy');
  const [shift, setShift] = useState('');
  const money = (v: string) => formatAmount(v, currency, locale);

  const rows: (ScenarioRow & { isBase: boolean })[] = [
    { id: 'base', name: tsn('plan'), ...base, isBase: true },
    ...scenarios.map((s) => ({ ...s, isBase: false })),
  ];
  const active = activeId ?? 'base';

  return (
    <div className="@container flex flex-col gap-4">
      <div className="grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-4">
        {rows.map((row) => (
          <Card
            key={row.id}
            className={row.id === active ? 'ring-1 ring-[color:var(--color-ink)]' : ''}
          >
            <div className="flex h-full flex-col gap-2">
              <p className="line-clamp-2 font-medium break-words">{row.name}</p>
              <p className="text-sm text-[color:var(--color-ink-secondary)] tabular-nums">
                {tsn('fund', { amount: money(row.total) })}
              </p>
              <p className="readout text-xl tabular-nums">
                {row.perDiem ? tsn('perDay', { amount: money(row.perDiem) }) : '—'}
              </p>
              <Status
                tone={
                  row.status === 'healthy'
                    ? 'positive'
                    : row.status === 'tight'
                      ? 'caution'
                      : 'negative'
                }
              >
                {tc(`status.${row.status}`)}
              </Status>
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                {row.id === active ? (
                  <span className="text-sm text-[color:var(--color-ink-secondary)]">
                    {tsn('active')}
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-11"
                    disabled={pending}
                    onClick={() => {
                      run(() =>
                        activateTripScenario(tripId, row.isBase ? null : row.id, asLocale(locale)),
                      );
                    }}
                  >
                    {tsn('activate')}
                  </Button>
                )}
                {!row.isBase && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11"
                    disabled={pending}
                    onClick={() => {
                      run(() => deleteTripScenario(tripId, row.id, asLocale(locale)));
                    }}
                  >
                    {tsn('remove')}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {scenarios.length < 3 &&
        (open ? (
          <Card>
            <form
              className="grid gap-4 @lg:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () =>
                    saveTripScenario(
                      tripId,
                      {
                        name: name.trim() || tc(`profile.${profile}`),
                        params: {
                          ...(total.trim() ? { totalBudget: total.trim() } : {}),
                          profile,
                          ...(shift.trim() ? { fxShiftPercent: shift.trim() } : {}),
                        },
                      },
                      asLocale(locale),
                    ),
                  () => {
                    setOpen(false);
                    setName('');
                    setTotal('');
                    setShift('');
                  },
                );
              }}
            >
              <Field label={tsn('name')}>
                {(f) => (
                  <Input
                    id={f.id}
                    className="h-12 text-base"
                    value={name}
                    placeholder={tsn('namePlaceholder')}
                    onChange={(e) => {
                      setName(e.target.value);
                    }}
                  />
                )}
              </Field>
              <Field label={tsn('total')} hint={tsn('totalHint')}>
                {(f) => (
                  <Input
                    id={f.id}
                    inputMode="decimal"
                    numeric
                    className="h-12 text-base"
                    value={total}
                    onChange={(e) => {
                      setTotal(e.target.value.replace(/[^\d.]/g, ''));
                    }}
                  />
                )}
              </Field>
              <Field label={tsn('profile')}>
                {(f) => (
                  <Select
                    id={f.id}
                    className="h-12 text-base"
                    value={profile}
                    onChange={(e) => {
                      setProfile(e.target.value as typeof profile);
                    }}
                  >
                    {(['economy', 'balanced', 'comfort'] as const).map((p) => (
                      <option key={p} value={p}>
                        {tc(`profile.${p}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={tsn('fxShift')} hint={tsn('fxShiftHint')}>
                {(f) => (
                  <Input
                    id={f.id}
                    inputMode="decimal"
                    numeric
                    className="h-12 text-base"
                    value={shift}
                    placeholder="10"
                    onChange={(e) => {
                      setShift(e.target.value.replace(/[^\d.-]/g, ''));
                    }}
                  />
                )}
              </Field>
              {error && (
                <p
                  role="alert"
                  className="text-sm text-[color:var(--color-negative)] @lg:col-span-2"
                >
                  {tsn('error')}
                </p>
              )}
              <div className="flex flex-wrap gap-3 @lg:col-span-2">
                <Button type="submit" size="lg" loading={pending}>
                  {tsn('save')}
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  {tsn('cancel')}
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
            {tsn('add')}
          </Button>
        ))}
    </div>
  );
}

export interface ChecklistRow {
  readonly id: string;
  readonly title: string;
  readonly dueOn: string | null;
  readonly due: string | null;
  readonly done: boolean;
}

/** The financial to-dos before leaving: balances to pay, the bank to warn, cash to get. */
export function ChecklistPanel({
  tripId,
  items,
  locale,
}: {
  readonly tripId: string;
  readonly items: readonly ChecklistRow[];
  readonly locale: string;
}) {
  const tck = useTranslations('trips.dashboard.checklist');
  const { run, pending, error } = useTripAction();
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState('');

  return (
    <Card>
      <div className="@container flex flex-col gap-4">
        {items.length === 0 ? (
          <p className="text-sm text-[color:var(--color-ink-secondary)]">{tck('empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[color:var(--color-rule)]">
            {items.map((item) => (
              <li key={item.id}>
                <label className="flex min-h-12 items-start gap-3 py-2">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 accent-[color:var(--color-panel)]"
                    checked={item.done}
                    disabled={pending}
                    onChange={(e) => {
                      run(() =>
                        toggleChecklistItem(tripId, item.id, e.target.checked, asLocale(locale)),
                      );
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block break-words ${item.done ? 'text-[color:var(--color-ink-tertiary)] line-through' : ''}`}
                    >
                      {item.title}
                    </span>
                    {item.due && (
                      <span className="block text-sm text-[color:var(--color-ink-secondary)]">
                        {item.due}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-col gap-3 border-t border-[color:var(--color-rule)] pt-4 @lg:flex-row @lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            run(
              () =>
                addChecklistItem(
                  tripId,
                  { title: title.trim(), dueOn: dueOn || null },
                  asLocale(locale),
                ),
              () => {
                setTitle('');
                setDueOn('');
              },
            );
          }}
        >
          <Field label={tck('new')} className="flex-1">
            {(f) => (
              <Input
                id={f.id}
                className="h-12 text-base"
                value={title}
                maxLength={160}
                placeholder={tck('newPlaceholder')}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
              />
            )}
          </Field>
          <Field label={tck('due')}>
            {(f) => (
              <Input
                id={f.id}
                type="date"
                className="h-12 text-base"
                value={dueOn}
                onChange={(e) => {
                  setDueOn(e.target.value);
                }}
              />
            )}
          </Field>
          <Button type="submit" variant="secondary" size="lg" loading={pending}>
            {tck('add')}
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-[color:var(--color-negative)]">
            {tck('error')}
          </p>
        )}
      </div>
    </Card>
  );
}
