'use client';

import {
  DAILY_CATEGORIES,
  PROFILES,
  rebalanceShares,
  type DailyCategory,
  type Shares,
} from '@app/trip-engine';
import { Button, Card, Field, Input, Select } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { COUNTRIES, countryByCode, inferPlace, type CostLevel } from '@/lib/places';
import {
  archiveTrip,
  deleteTripLeg,
  deleteTripTraveler,
  saveTripLeg,
  saveTripTraveler,
  updateTripSettings,
} from '@/server/trip-actions';

import { useTripAction } from './use-trip-action';

/**
 * Adjusting a trip after it exists: its money and style, its places, its
 * people. Each part saves on its own, and the dashboard above recomputes the
 * per diem from the new figures on the next render.
 */

type Profile = 'economy' | 'balanced' | 'comfort' | 'custom';
type LodgingMode = 'undecided' | 'prepaid' | 'pay_on_site' | 'none';
type TravelerType = 'adult' | 'child' | 'infant';

export interface SetupTrip {
  readonly id: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly totalBudget: string;
  readonly alreadySaved: string;
  readonly contingencyType: 'percent' | 'fixed';
  readonly contingencyValue: string;
  readonly profile: Profile;
  readonly customShares: Record<string, number> | null;
  readonly includeArrivalDay: boolean;
  readonly includeDepartureDay: boolean;
  readonly partialDayWeight: string;
  readonly rollingPolicy: 'rolling' | 'fixed';
}

export interface SetupLeg {
  readonly id: string;
  readonly city: string;
  readonly countryCode: string | null;
  readonly arrivalDate: string;
  readonly departureDate: string;
  readonly localCurrency: string;
  readonly costLevel: CostLevel;
  readonly timezone: string;
  readonly lodgingMode: LodgingMode;
}

export interface SetupTraveler {
  readonly id: string;
  readonly displayName: string;
  readonly travelerType: TravelerType;
}

const lang = (locale: string): 'en' | 'es' => (locale === 'en' ? 'en' : 'es');
/** «3000.0000» → «3000», «12.5000» → «12.5»; whole numbers untouched. */
const trim = (value: string): string =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') || '0' : value;

export function TripSetup({
  trip,
  legs,
  travelers,
  currency,
  locale,
}: {
  readonly trip: SetupTrip;
  readonly legs: readonly SetupLeg[];
  readonly travelers: readonly SetupTraveler[];
  readonly currency: string;
  readonly locale: string;
}) {
  const t = useTranslations('trips.dashboard.setup');
  const tc = useTranslations('trips.common');
  const te = useTranslations('trips.errors');
  const settings = useTripAction();

  const [name, setName] = useState(trip.name);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate);
  const [total, setTotal] = useState(trim(trip.totalBudget));
  const [reserveType, setReserveType] = useState(trip.contingencyType);
  const [reserveValue, setReserveValue] = useState(trim(trip.contingencyValue));
  const [profile, setProfile] = useState<Profile>(trip.profile);
  const [shares, setShares] = useState<Shares>(
    (trip.customShares as Shares | null) ??
      PROFILES[trip.profile === 'custom' ? 'balanced' : trip.profile],
  );
  const [locked, setLocked] = useState<DailyCategory[]>([]);
  const [partial, setPartial] = useState(trip.partialDayWeight !== '1.000');
  const [rolling, setRolling] = useState(trip.rollingPolicy);

  return (
    <div className="@container flex flex-col gap-6">
      <Card>
        <form
          className="grid gap-4 @lg:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            settings.run(() =>
              updateTripSettings(
                trip.id,
                {
                  name,
                  startDate,
                  endDate,
                  totalBudget: total,
                  alreadySaved: trim(trip.alreadySaved),
                  contingencyType: reserveType,
                  contingencyValue: reserveValue,
                  profile,
                  customShares: profile === 'custom' ? { ...shares } : null,
                  includeArrivalDay: trip.includeArrivalDay,
                  includeDepartureDay: trip.includeDepartureDay,
                  partialDayWeight: partial ? '0.5' : '1',
                  rollingPolicy: rolling,
                },
                lang(locale),
              ),
            );
          }}
        >
          <p className="font-medium @lg:col-span-2">{t('money')}</p>
          <Field label={t('name')} className="@lg:col-span-2">
            {(f) => (
              <Input
                id={f.id}
                className="h-12 text-base"
                value={name}
                maxLength={120}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            )}
          </Field>
          <Field label={t('start')}>
            {(f) => (
              <Input
                id={f.id}
                type="date"
                className="h-12 text-base"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                }}
              />
            )}
          </Field>
          <Field label={t('end')}>
            {(f) => (
              <Input
                id={f.id}
                type="date"
                className="h-12 text-base"
                value={endDate}
                min={startDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                }}
              />
            )}
          </Field>
          <Field label={t('total', { currency })}>
            {(f) => (
              <Input
                id={f.id}
                inputMode="decimal"
                numeric
                className="h-12 text-base"
                value={total}
                onChange={(e) => {
                  setTotal(e.target.value.replace(/,/g, '.').replace(/[^\d.]/g, ''));
                }}
              />
            )}
          </Field>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field
              label={
                reserveType === 'percent' ? t('reservePercent') : t('reserveFixed', { currency })
              }
            >
              {(f) => (
                <Input
                  id={f.id}
                  inputMode="decimal"
                  numeric
                  className="h-12 text-base"
                  value={reserveValue}
                  onChange={(e) => {
                    setReserveValue(e.target.value.replace(/,/g, '.').replace(/[^\d.]/g, ''));
                  }}
                />
              )}
            </Field>
            <Field label={t('reserveKind')}>
              {(f) => (
                <Select
                  id={f.id}
                  className="h-12 text-base"
                  value={reserveType}
                  onChange={(e) => {
                    setReserveType(e.target.value as 'percent' | 'fixed');
                  }}
                >
                  <option value="percent">%</option>
                  <option value="fixed">{currency}</option>
                </Select>
              )}
            </Field>
          </div>
          <Field label={t('profile')}>
            {(f) => (
              <Select
                id={f.id}
                className="h-12 text-base"
                value={profile}
                onChange={(e) => {
                  setProfile(e.target.value as Profile);
                }}
              >
                {(['economy', 'balanced', 'comfort', 'custom'] as const).map((p) => (
                  <option key={p} value={p}>
                    {tc(`profile.${p}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('rolling')} hint={t(`rollingHint.${rolling}`)}>
            {(f) => (
              <Select
                id={f.id}
                className="h-12 text-base"
                value={rolling}
                onChange={(e) => {
                  setRolling(e.target.value as 'rolling' | 'fixed');
                }}
              >
                <option value="rolling">{t('rollingOptions.rolling')}</option>
                <option value="fixed">{t('rollingOptions.fixed')}</option>
              </Select>
            )}
          </Field>

          {profile === 'custom' && (
            <fieldset className="flex flex-col gap-3 @lg:col-span-2">
              <legend className="mb-1 text-sm font-medium">{t('custom')}</legend>
              {DAILY_CATEGORIES.map((c) => (
                <div
                  key={c}
                  className="grid grid-cols-[minmax(0,8rem)_1fr_auto_auto] items-center gap-3"
                >
                  <span className="truncate text-sm">{tc(`category.${c}`)}</span>
                  <input
                    type="range"
                    min={0}
                    max={10_000}
                    step={100}
                    value={shares[c]}
                    aria-label={tc(`category.${c}`)}
                    disabled={locked.includes(c)}
                    className="h-11 w-full accent-[color:var(--color-panel)]"
                    onChange={(e) => {
                      setShares(rebalanceShares(shares, c, Number(e.target.value), locked));
                    }}
                  />
                  <span className="w-12 text-right text-sm tabular-nums">
                    {Math.round(shares[c] / 100)} %
                  </span>
                  <label className="flex h-11 items-center gap-1 text-xs text-[color:var(--color-ink-secondary)]">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={locked.includes(c)}
                      onChange={(e) => {
                        setLocked(
                          e.target.checked ? [...locked, c] : locked.filter((x) => x !== c),
                        );
                      }}
                    />
                    {t('lock')}
                  </label>
                </div>
              ))}
            </fieldset>
          )}

          <label className="flex min-h-11 items-center gap-3 @lg:col-span-2">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[color:var(--color-panel)]"
              checked={partial}
              onChange={(e) => {
                setPartial(e.target.checked);
              }}
            />
            <span>{t('partial')}</span>
          </label>
          {settings.error && (
            <p role="alert" className="text-sm text-[color:var(--color-negative)] @lg:col-span-2">
              {te.has(settings.error) ? te(settings.error) : te('saveFailed')}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            className="@lg:col-span-2 @lg:justify-self-start"
            loading={settings.pending}
          >
            {t('saveMoney')}
          </Button>
        </form>
      </Card>

      <LegsEditor tripId={trip.id} legs={legs} currency={currency} locale={locale} />
      <TravelersEditor tripId={trip.id} travelers={travelers} locale={locale} />
      <ArchiveTrip tripId={trip.id} locale={locale} />
    </div>
  );
}

function LegsEditor({
  tripId,
  legs,
  currency,
  locale,
}: {
  readonly tripId: string;
  readonly legs: readonly SetupLeg[];
  readonly currency: string;
  readonly locale: string;
}) {
  const t = useTranslations('trips.dashboard.setup');
  const tc = useTranslations('trips.common');
  const te = useTranslations('trips.errors');
  const { run, pending, error } = useTripAction();
  const [editing, setEditing] = useState<SetupLeg | null>(null);
  const blank = (): SetupLeg => {
    const last = legs[legs.length - 1];
    return {
      id: '',
      city: '',
      countryCode: last?.countryCode ?? null,
      arrivalDate: last?.departureDate ?? '',
      departureDate: last?.departureDate ?? '',
      localCurrency: last?.localCurrency ?? currency,
      costLevel: last?.costLevel ?? 'medium',
      timezone: last?.timezone ?? 'America/Panama',
      lodgingMode: 'undecided',
    };
  };

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <p className="font-medium">{t('legs')}</p>
        <ul className="flex flex-col divide-y divide-[color:var(--color-rule)]">
          {legs.map((leg) => (
            <li key={leg.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="break-words">{leg.city}</p>
                <p className="text-sm text-[color:var(--color-ink-secondary)]">
                  {leg.arrivalDate} → {leg.departureDate} · {leg.localCurrency} ·{' '}
                  {tc(`costLevel.${leg.costLevel}`)} · {tc(`lodgingMode.${leg.lodgingMode}`)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11"
                  onClick={() => {
                    setEditing(leg);
                  }}
                >
                  {t('edit')}
                </Button>
                {legs.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(t('removeLegConfirm')))
                        run(() => deleteTripLeg(tripId, leg.id, lang(locale)));
                    }}
                  >
                    {t('remove')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {editing ? (
          <form
            className="grid gap-4 border-t border-[color:var(--color-rule)] pt-4 @lg:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () =>
                  saveTripLeg(
                    tripId,
                    {
                      ...(editing.id ? { id: editing.id } : {}),
                      city: editing.city,
                      countryCode: editing.countryCode,
                      arrivalDate: editing.arrivalDate,
                      departureDate: editing.departureDate,
                      localCurrency: editing.localCurrency,
                      costLevel: editing.costLevel,
                      timezone: editing.timezone,
                      lodgingMode: editing.lodgingMode,
                    },
                    lang(locale),
                  ),
                () => {
                  setEditing(null);
                },
              );
            }}
          >
            <Field label={t('city')}>
              {(f) => (
                <Input
                  id={f.id}
                  className="h-12 text-base"
                  value={editing.city}
                  onChange={(e) => {
                    setEditing({ ...editing, city: e.target.value });
                  }}
                  onBlur={(e) => {
                    const place = inferPlace(e.target.value, editing.countryCode);
                    if (place.countryCode && !editing.id) {
                      setEditing({
                        ...editing,
                        countryCode: place.countryCode,
                        localCurrency: place.currency ?? editing.localCurrency,
                        timezone: place.timezone ?? editing.timezone,
                        costLevel: place.level,
                      });
                    }
                  }}
                />
              )}
            </Field>
            <Field label={t('country')}>
              {(f) => (
                <Select
                  id={f.id}
                  className="h-12 text-base"
                  value={editing.countryCode ?? ''}
                  onChange={(e) => {
                    const c = countryByCode(e.target.value);
                    setEditing({
                      ...editing,
                      countryCode: e.target.value || null,
                      ...(c ? { localCurrency: c.currency, timezone: c.timezone } : {}),
                    });
                  }}
                >
                  <option value="">—</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {locale === 'en' ? c.en : c.es}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('arrival')}>
              {(f) => (
                <Input
                  id={f.id}
                  type="date"
                  className="h-12 text-base"
                  value={editing.arrivalDate}
                  onChange={(e) => {
                    setEditing({ ...editing, arrivalDate: e.target.value });
                  }}
                />
              )}
            </Field>
            <Field label={t('departure')}>
              {(f) => (
                <Input
                  id={f.id}
                  type="date"
                  className="h-12 text-base"
                  value={editing.departureDate}
                  min={editing.arrivalDate}
                  onChange={(e) => {
                    setEditing({ ...editing, departureDate: e.target.value });
                  }}
                />
              )}
            </Field>
            <Field label={t('costLevel')}>
              {(f) => (
                <Select
                  id={f.id}
                  className="h-12 text-base"
                  value={editing.costLevel}
                  onChange={(e) => {
                    setEditing({ ...editing, costLevel: e.target.value as CostLevel });
                  }}
                >
                  {(['low', 'medium', 'high', 'very_high'] as const).map((l) => (
                    <option key={l} value={l}>
                      {tc(`costLevel.${l}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('lodging')}>
              {(f) => (
                <Select
                  id={f.id}
                  className="h-12 text-base"
                  value={editing.lodgingMode}
                  onChange={(e) => {
                    setEditing({ ...editing, lodgingMode: e.target.value as LodgingMode });
                  }}
                >
                  {(['undecided', 'prepaid', 'pay_on_site', 'none'] as const).map((m) => (
                    <option key={m} value={m}>
                      {tc(`lodgingMode.${m}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {error && (
              <p role="alert" className="text-sm text-[color:var(--color-negative)] @lg:col-span-2">
                {te.has(error) ? te(error) : te('saveFailed')}
              </p>
            )}
            <div className="flex flex-wrap gap-3 @lg:col-span-2">
              <Button type="submit" size="lg" loading={pending}>
                {editing.id ? t('saveLeg') : t('addLeg')}
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  setEditing(null);
                }}
              >
                {t('cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <Button
            variant="secondary"
            size="lg"
            className="self-start"
            onClick={() => {
              setEditing(blank());
            }}
          >
            {t('addLeg')}
          </Button>
        )}
      </div>
    </Card>
  );
}

function TravelersEditor({
  tripId,
  travelers,
  locale,
}: {
  readonly tripId: string;
  readonly travelers: readonly SetupTraveler[];
  readonly locale: string;
}) {
  const t = useTranslations('trips.dashboard.setup');
  const tc = useTranslations('trips.common');
  const { run, pending, error } = useTripAction();
  const [name, setName] = useState('');
  const [type, setType] = useState<TravelerType>('adult');

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <p className="font-medium">{t('travelers')}</p>
        {travelers.length === 0 && (
          <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('noTravelers')}</p>
        )}
        <ul className="flex flex-col divide-y divide-[color:var(--color-rule)]">
          {travelers.map((tr) => (
            <li key={tr.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 break-words">
                {tr.displayName} ·{' '}
                <span className="text-[color:var(--color-ink-secondary)]">
                  {tc(`travelerType.${tr.travelerType}`)}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-11"
                disabled={pending}
                onClick={() => {
                  run(() => deleteTripTraveler(tripId, tr.id, lang(locale)));
                }}
              >
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-col gap-3 @lg:flex-row @lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            run(
              () =>
                saveTripTraveler(
                  tripId,
                  { displayName: name.trim(), travelerType: type },
                  lang(locale),
                ),
              () => {
                setName('');
              },
            );
          }}
        >
          <Field label={t('travelerName')} className="flex-1">
            {(f) => (
              <Input
                id={f.id}
                className="h-12 text-base"
                value={name}
                maxLength={120}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            )}
          </Field>
          <Field label={t('travelerType')}>
            {(f) => (
              <Select
                id={f.id}
                className="h-12 text-base"
                value={type}
                onChange={(e) => {
                  setType(e.target.value as TravelerType);
                }}
              >
                {(['adult', 'child', 'infant'] as const).map((ty) => (
                  <option key={ty} value={ty}>
                    {tc(`travelerType.${ty}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit" variant="secondary" size="lg" loading={pending}>
            {t('addTraveler')}
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-[color:var(--color-negative)]">
            {t('error')}
          </p>
        )}
      </div>
    </Card>
  );
}

function ArchiveTrip({ tripId, locale }: { readonly tripId: string; readonly locale: string }) {
  const t = useTranslations('trips.dashboard.setup');
  const { run, pending } = useTripAction();
  return (
    <div>
      <Button
        variant="ghost"
        size="lg"
        disabled={pending}
        onClick={() => {
          if (window.confirm(t('archiveConfirm'))) {
            run(
              () => archiveTrip(tripId, lang(locale)),
              () => {
                window.location.assign(`/${locale}/trips`);
              },
            );
          }
        }}
      >
        {t('archive')}
      </Button>
    </div>
  );
}
