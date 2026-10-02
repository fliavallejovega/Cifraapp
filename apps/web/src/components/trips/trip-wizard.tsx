'use client';

import { toPlainDate } from '@app/domain';
import {
  COST_INDEX_BY_LEVEL,
  computeTripBudget,
  convertToBase,
  DAILY_CATEGORIES,
  DEFAULT_TRAVELER_WEIGHT,
  divide,
  fromMinor,
  suggestBudgetRange,
  toMinor,
  type ProfileKey,
  type TripBudget,
} from '@app/trip-engine';
import { Button, Card, Field, Input, Select, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState, useTransition } from 'react';

import { useRouter } from '@/i18n/navigation';
import { COUNTRIES, CITIES, countryByCode, inferPlace, type CostLevel } from '@/lib/places';
import { formatAmount, formatDateRange } from '@/lib/trip-format';
import { createTrip, saveTripBooking } from '@/server/trip-actions';
import type { QuickTrip } from '@/server/trip-quick';

import { TripQuickDescribe } from './trip-quick-describe';

/**
 * Creating a trip, in six short steps.
 *
 * Where → who → what is already bought → how much → which style → the plan.
 * Every step infers what it can: the currency and time zone from the city,
 * the travellers from the household, a budget range from the destination and
 * the days, and the per diem of each style is computed live by the same pure
 * engine the server uses. The draft lives on the device until the trip is
 * created, so a person can leave halfway and come back.
 */

type BookingKind = 'flight' | 'lodging' | 'insurance' | 'tour' | 'transport' | 'visa' | 'other';
type LodgingMode = 'undecided' | 'prepaid' | 'pay_on_site' | 'none';
type TravelerType = 'adult' | 'child' | 'infant';

interface LegDraft {
  key: string;
  city: string;
  countryCode: string;
  arrivalDate: string;
  departureDate: string;
  localCurrency: string;
  costLevel: CostLevel;
  timezone: string;
  lodgingMode: LodgingMode;
}

interface TravelerDraft {
  key: string;
  personId: string | null;
  displayName: string;
  travelerType: TravelerType;
  selected: boolean;
}

interface BookingDraft {
  key: string;
  bookingType: BookingKind;
  provider: string;
  amount: string;
  currency: string;
  paid: boolean;
}

interface Draft {
  step: number;
  legs: LegDraft[];
  travelers: TravelerDraft[];
  bookings: BookingDraft[];
  nothingYet: boolean;
  totalBudget: string;
  alreadySaved: string;
  profile: ProfileKey;
  reservePercent: number;
  partialDays: boolean;
  name: string;
  createGoal: boolean;
}

export interface WizardPerson {
  readonly id: string;
  readonly name: string;
  readonly type: TravelerType;
}

const STEPS = ['where', 'who', 'have', 'money', 'style', 'plan'] as const;
const DRAFT_KEY = 'cifra.trip-wizard.v1';
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

const key = () => Math.random().toString(36).slice(2, 10);

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** «1,250.50» or «1.250,50» or «1250» → «1250.50». Empty when it is not a figure. */
function normalizeAmount(raw: string): string {
  const text = raw.replace(/[^\d.,]/g, '');
  if (!text) return '';
  const lastSep = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','));
  const decimals = lastSep >= 0 ? text.length - lastSep - 1 : 0;
  if (lastSep >= 0 && decimals > 0 && decimals <= 2) {
    return `${text.slice(0, lastSep).replace(/[.,]/g, '')}.${text.slice(lastSep + 1)}`;
  }
  return text.replace(/[.,]/g, '');
}

export function TripWizard({
  locale,
  currency,
  today,
  people,
  rates,
  from,
  quickCreate = false,
}: {
  readonly locale: string;
  /** The household's base currency. */
  readonly currency: string;
  readonly today: string;
  readonly people: readonly WizardPerson[];
  /** Latest reference rates: local units per one unit of the base currency. */
  readonly rates: Readonly<Record<string, string>>;
  readonly from: 'budget' | 'documents' | null;
  /** Whether «describe the trip in a sentence» is offered: a model is configured. */
  readonly quickCreate?: boolean;
}) {
  const t = useTranslations('trips.wizard');
  const tq = useTranslations('trips.wizard.quick');
  const tc = useTranslations('trips.common');
  const router = useRouter();
  const formId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const blank = (): Draft => {
    const start = addDays(today, 60);
    return {
      step: from === 'documents' ? 0 : 0,
      legs: [
        {
          key: key(),
          city: '',
          countryCode: '',
          arrivalDate: start,
          departureDate: addDays(start, 6),
          localCurrency: currency,
          costLevel: 'medium',
          timezone: 'America/Panama',
          lodgingMode: from === 'documents' ? 'prepaid' : 'undecided',
        },
      ],
      travelers: people.map((p) => ({
        key: p.id,
        personId: p.id,
        displayName: p.name,
        travelerType: p.type,
        selected: true,
      })),
      bookings: [],
      nothingYet: from !== 'documents',
      totalBudget: '',
      alreadySaved: '0',
      profile: 'balanced',
      reservePercent: 10,
      partialDays: true,
      name: '',
      createGoal: true,
    };
  };

  const [draft, setDraft] = useState<Draft>(blank);
  const [restored, setRestored] = useState(false);

  // The draft survives a closed tab. Storage can be missing or full; the wizard works without it.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Draft;
        if (Array.isArray(parsed.legs) && parsed.legs.length > 0) setDraft(parsed);
      }
    } catch {
      /* no storage: start fresh */
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage full or blocked: the draft lives only in memory */
    }
  }, [draft, restored]);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  };
  // A sentence's reading fills the first answers; every one stays editable.
  const applyQuick = (quick: QuickTrip) => {
    setDraft((d) => {
      const next: Draft = { ...d };
      if (quick.name) next.name = quick.name;
      if (quick.legs.length > 0)
        next.legs = quick.legs.map((leg) => ({
          key: key(),
          city: leg.city,
          countryCode: leg.countryCode,
          arrivalDate: leg.arrivalDate,
          departureDate: leg.departureDate,
          localCurrency: leg.localCurrency,
          costLevel: leg.costLevel,
          timezone: leg.timezone,
          lodgingMode: 'undecided',
        }));
      if (quick.totalBudget) next.totalBudget = quick.totalBudget;
      if (quick.profile) next.profile = quick.profile;
      if (quick.travelers) {
        const wanted = quick.travelers;
        const left = { adult: wanted.adults, child: wanted.children, infant: wanted.infants };
        const people = d.travelers
          .filter((tr) => tr.personId !== null)
          .map((tr) => {
            const take = left[tr.travelerType] > 0;
            if (take) left[tr.travelerType] -= 1;
            return { ...tr, selected: take };
          });
        const extra: TravelerDraft[] = (['adult', 'child', 'infant'] as const).flatMap((type) =>
          Array.from({ length: left[type] }, (_, i) => ({
            key: key(),
            personId: null,
            displayName: tq(`extra.${type}`, { n: i + 1 }),
            travelerType: type,
            selected: true,
          })),
        );
        next.travelers = [...people, ...extra];
      }
      return next;
    });
  };
  const updateLeg = (k: string, patch: Partial<LegDraft>) => {
    setDraft((d) => ({
      ...d,
      legs: d.legs.map((leg) => (leg.key === k ? { ...leg, ...patch } : leg)),
    }));
  };

  const startDate = draft.legs.reduce(
    (min, leg) => (leg.arrivalDate < min ? leg.arrivalDate : min),
    draft.legs[0]?.arrivalDate ?? today,
  );
  const endDate = draft.legs.reduce(
    (max, leg) => (leg.departureDate > max ? leg.departureDate : max),
    draft.legs[0]?.departureDate ?? today,
  );
  const days = Math.max(
    1,
    Math.round(
      (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000,
    ) + 1,
  );
  const future = startDate > today;
  const travelers = draft.travelers.filter((tr) => tr.selected && tr.displayName.trim() !== '');

  const rateFor = (code: string): string | null =>
    code === currency ? '1' : (rates[code] ?? null);

  /** Bookings in base currency, for the engine and the summary. */
  const bookingsBase = draft.nothingYet
    ? []
    : draft.bookings
        .filter((b) => AMOUNT.test(b.amount))
        .map((b) => {
          const rate = rateFor(b.currency);
          const base = rate
            ? convertToBase(b.amount, rate, { minorUnits: 2 }, { minorUnits: 2 })
            : b.amount;
          return { ...b, base };
        });

  const legErrors = draft.legs.map((leg, i) => {
    if (!leg.city.trim()) return 'city';
    if (!leg.arrivalDate || !leg.departureDate || leg.departureDate < leg.arrivalDate)
      return 'dates';
    const prev = draft.legs[i - 1];
    if (prev && leg.arrivalDate < prev.departureDate) return 'overlap';
    return null;
  });

  const budgetFor = (profile: ProfileKey): TripBudget | null => {
    if (!AMOUNT.test(draft.totalBudget) || legErrors.some(Boolean)) return null;
    try {
      return computeTripBudget({
        currency: { code: currency, minorUnits: 2 },
        totalBudget: draft.totalBudget,
        today: toPlainDate(today),
        startDate: toPlainDate(startDate),
        endDate: toPlainDate(endDate),
        legs: draft.legs.map((leg) => ({
          id: leg.key,
          arrivalDate: toPlainDate(leg.arrivalDate),
          departureDate: toPlainDate(leg.departureDate),
          costIndex: COST_INDEX_BY_LEVEL[leg.costLevel],
          lodgingMode: leg.lodgingMode,
          localCurrency: {
            code: leg.localCurrency,
            minorUnits: leg.localCurrency === 'JPY' || leg.localCurrency === 'CLP' ? 0 : 2,
          },
          fxRate: rateFor(leg.localCurrency),
        })),
        travelers: travelers.map((tr) => ({
          id: tr.key,
          weight: DEFAULT_TRAVELER_WEIGHT[tr.travelerType],
        })),
        bookings: bookingsBase.map((b) => ({
          id: b.key,
          type: b.bookingType,
          paymentStatus: b.paid ? ('paid' as const) : ('pay_later' as const),
          amountBase: b.base,
        })),
        contingency: { type: 'percent', value: String(draft.reservePercent) },
        profile,
        partialDays: {
          includeArrival: true,
          includeDeparture: true,
          weight: draft.partialDays ? '0.5' : '1',
        },
      });
    } catch {
      return null;
    }
  };

  const budgets = useMemo(
    () => ({
      economy: budgetFor('economy'),
      balanced: budgetFor('balanced'),
      comfort: budgetFor('comfort'),
    }),
    [draft, rates],
  );
  const budget = budgets[draft.profile];

  const suggestion = useMemo(() => {
    if (legErrors.some(Boolean) || travelers.length === 0) return null;
    const range = suggestBudgetRange({
      minorUnits: 2,
      legs: draft.legs.map((leg) => {
        const legDays = Math.max(
          1,
          Math.round(
            (Date.parse(`${leg.departureDate}T00:00:00Z`) -
              Date.parse(`${leg.arrivalDate}T00:00:00Z`)) /
              86_400_000,
          ),
        );
        return {
          days: legDays,
          nights: legDays,
          costIndex: COST_INDEX_BY_LEVEL[leg.costLevel],
          needsLodging: leg.lodgingMode === 'undecided',
        };
      }),
      travelerWeights: travelers.map((tr) => DEFAULT_TRAVELER_WEIGHT[tr.travelerType]),
      profile: draft.profile,
    });
    // Commitments the family already has are part of the trip's cost; whole
    // units, because a suggestion with cents pretends to a precision it lacks.
    const committed = bookingsBase.reduce((sum, b) => sum + toMinor(b.base, 2), 0n);
    const plus = (value: string) =>
      fromMinor(divide(toMinor(value, 2) + committed, 100n) * 100n, 2);
    return { low: plus(range.low), high: plus(range.high) };
  }, [draft]);

  const stepValid = (step: number): boolean => {
    if (step === 0) return legErrors.every((e) => e === null);
    if (step === 1) return travelers.length > 0;
    if (step === 2)
      return (
        draft.nothingYet || draft.bookings.every((b) => b.amount === '' || AMOUNT.test(b.amount))
      );
    if (step === 3) return AMOUNT.test(draft.totalBudget) && AMOUNT.test(draft.alreadySaved || '0');
    return true;
  };

  const go = (step: number) => {
    if (step > draft.step && !stepValid(draft.step)) {
      setTouched(true);
      return;
    }
    setTouched(false);
    if (step === 5 && !draft.name.trim()) {
      const first = draft.legs[0]?.city.trim() ?? '';
      update({ step, name: t('plan.defaultName', { city: first, year: startDate.slice(0, 4) }) });
    } else update({ step });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createTrip(
        {
          name:
            draft.name.trim() ||
            t('plan.defaultName', { city: draft.legs[0]?.city ?? '', year: startDate.slice(0, 4) }),
          startDate,
          endDate,
          totalBudget: draft.totalBudget,
          alreadySaved: draft.alreadySaved || '0',
          contingencyType: 'percent',
          contingencyValue: String(draft.reservePercent),
          profile: draft.profile,
          includeArrivalDay: true,
          includeDepartureDay: true,
          partialDayWeight: draft.partialDays ? '0.5' : '1',
          legs: draft.legs.map((leg) => ({
            city: leg.city.trim(),
            countryCode: leg.countryCode || null,
            arrivalDate: leg.arrivalDate,
            departureDate: leg.departureDate,
            localCurrency: leg.localCurrency,
            costLevel: leg.costLevel,
            timezone: leg.timezone,
            lodgingMode: leg.lodgingMode,
          })),
          travelers: travelers.map((tr) => ({
            personId: tr.personId,
            displayName: tr.displayName.trim(),
            travelerType: tr.travelerType,
          })),
          createGoal: future && draft.createGoal,
        },
        locale === 'en' ? 'en' : 'es',
      );
      if (result.error || !result.created) {
        setError(result.error ?? 'saveFailed');
        return;
      }
      const tripId = result.created;
      for (const b of bookingsBase) {
        await saveTripBooking(
          tripId,
          {
            bookingType: b.bookingType,
            provider: b.provider.trim() || null,
            amount: b.amount,
            currency: b.currency,
            fxRate: b.currency === currency ? null : rateFor(b.currency),
            paymentStatus: b.paid ? 'paid' : 'pay_later',
          },
          locale === 'en' ? 'en' : 'es',
        );
      }
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* nothing to clear */
      }
      router.push(`/trips/${tripId}`);
    });
  };

  const money = (value: string, code = currency) => formatAmount(value, code, locale);
  const stepName = STEPS[draft.step] ?? 'where';
  const nextLabel =
    draft.step < 5 ? t(`next.${STEPS[draft.step + 1] ?? 'plan'}`) : t('plan.create');
  const showError = (cond: boolean) => touched && cond;

  return (
    <div className="@container flex flex-col gap-6">
      {/* Progress: the step, its name, and a bar that is never at zero. */}
      <div className="flex flex-col gap-2">
        <p className="text-sm text-[color:var(--color-ink-secondary)]">
          {t('progress', { step: draft.step + 1, total: STEPS.length })} ·{' '}
          {t(`steps.${stepName}.short`)}
        </p>
        <ol className="grid grid-cols-6 gap-1" aria-label={t('progressLabel')}>
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => {
                  if (i < draft.step) go(i);
                }}
                disabled={i >= draft.step}
                aria-current={i === draft.step ? 'step' : undefined}
                aria-label={t(`steps.${s}.short`)}
                className="flex h-11 w-full items-center disabled:cursor-default"
              >
                <span
                  className={`block h-1.5 w-full rounded-full ${i <= draft.step ? 'bg-[color:var(--color-brand)]' : 'bg-[color:var(--color-rule)]'}`}
                />
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-medium tracking-[-0.014em]">{t(`steps.${stepName}.title`)}</h2>
        <p className="text-[color:var(--color-ink-secondary)]">{t(`steps.${stepName}.body`)}</p>
      </div>

      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.step < 5) go(draft.step + 1);
          else submit();
        }}
        className="flex flex-col gap-6"
        noValidate
      >
        {draft.step === 0 && (
          <div className="flex flex-col gap-4">
            {quickCreate && <TripQuickDescribe onApply={applyQuick} />}
            <datalist id={`${formId}-cities`}>
              {CITIES.map((c) => (
                <option key={`${c.name}-${c.country}`} value={c.name} />
              ))}
            </datalist>
            {draft.legs.map((leg, i) => (
              <Card key={leg.key}>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{t('where.legTitle', { n: i + 1 })}</p>
                    {draft.legs.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-11"
                        onClick={() => {
                          update({ legs: draft.legs.filter((l) => l.key !== leg.key) });
                        }}
                      >
                        {t('where.remove')}
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-4 @lg:grid-cols-2">
                    <Field
                      label={t('where.city')}
                      required
                      {...(showError(legErrors[i] === 'city') ? { error: t('errors.city') } : {})}
                    >
                      {(f) => (
                        <Input
                          id={f.id}
                          aria-describedby={f.describedBy}
                          invalid={f.invalid}
                          list={`${formId}-cities`}
                          autoComplete="off"
                          className="h-12 text-base"
                          value={leg.city}
                          placeholder={t('where.cityPlaceholder')}
                          onChange={(e) => {
                            updateLeg(leg.key, { city: e.target.value });
                          }}
                          onBlur={(e) => {
                            const place = inferPlace(e.target.value, leg.countryCode || null);
                            if (place.countryCode) {
                              updateLeg(leg.key, {
                                countryCode: place.countryCode,
                                localCurrency: place.currency ?? leg.localCurrency,
                                timezone: place.timezone ?? leg.timezone,
                                costLevel: place.level,
                              });
                            }
                          }}
                        />
                      )}
                    </Field>
                    <Field label={t('where.country')}>
                      {(f) => (
                        <Select
                          id={f.id}
                          className="h-12 text-base"
                          value={leg.countryCode}
                          onChange={(e) => {
                            const country = countryByCode(e.target.value);
                            updateLeg(leg.key, {
                              countryCode: e.target.value,
                              ...(country
                                ? {
                                    localCurrency: country.currency,
                                    timezone: country.timezone,
                                    costLevel: country.level,
                                  }
                                : {}),
                            });
                          }}
                        >
                          <option value="">{t('where.countryAny')}</option>
                          {COUNTRIES.map((c) => (
                            <option key={c.code} value={c.code}>
                              {locale === 'en' ? c.en : c.es}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field
                      label={t('where.arrival')}
                      required
                      {...(showError(legErrors[i] === 'dates' || legErrors[i] === 'overlap')
                        ? { error: t(`errors.${legErrors[i] ?? 'dates'}`) }
                        : {})}
                    >
                      {(f) => (
                        <Input
                          id={f.id}
                          type="date"
                          className="h-12 text-base"
                          value={leg.arrivalDate}
                          min={i === 0 ? undefined : draft.legs[i - 1]?.departureDate}
                          onChange={(e) => {
                            updateLeg(leg.key, { arrivalDate: e.target.value });
                          }}
                        />
                      )}
                    </Field>
                    <Field label={t('where.departure')} required>
                      {(f) => (
                        <Input
                          id={f.id}
                          type="date"
                          className="h-12 text-base"
                          value={leg.departureDate}
                          min={leg.arrivalDate}
                          onChange={(e) => {
                            updateLeg(leg.key, { departureDate: e.target.value });
                          }}
                        />
                      )}
                    </Field>
                    <Field label={t('where.costLevel')} hint={t('where.costHint')}>
                      {(f) => (
                        <Select
                          id={f.id}
                          className="h-12 text-base"
                          value={leg.costLevel}
                          onChange={(e) => {
                            updateLeg(leg.key, { costLevel: e.target.value as CostLevel });
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
                    <Field
                      label={t('where.currency')}
                      {...(rateFor(leg.localCurrency) ? {} : { hint: t('where.noRate') })}
                    >
                      {(f) => (
                        <Select
                          id={f.id}
                          className="h-12 text-base"
                          value={leg.localCurrency}
                          onChange={(e) => {
                            updateLeg(leg.key, { localCurrency: e.target.value });
                          }}
                        >
                          {[...new Set([currency, ...COUNTRIES.map((c) => c.currency)])].map(
                            (code) => (
                              <option key={code} value={code}>
                                {code}
                              </option>
                            ),
                          )}
                        </Select>
                      )}
                    </Field>
                  </div>
                </div>
              </Card>
            ))}
            <Button
              variant="secondary"
              size="lg"
              className="self-start"
              onClick={() => {
                const last = draft.legs[draft.legs.length - 1];
                const start = last?.departureDate ?? addDays(today, 60);
                update({
                  legs: [
                    ...draft.legs,
                    {
                      key: key(),
                      city: '',
                      countryCode: last?.countryCode ?? '',
                      arrivalDate: start,
                      departureDate: addDays(start, 3),
                      localCurrency: last?.localCurrency ?? currency,
                      costLevel: last?.costLevel ?? 'medium',
                      timezone: last?.timezone ?? 'America/Panama',
                      lodgingMode: 'undecided',
                    },
                  ],
                });
              }}
            >
              {t('where.addLeg')}
            </Button>
          </div>
        )}

        {draft.step === 1 && (
          <div className="flex flex-col gap-4">
            {draft.travelers.length > 0 && (
              <ul className="flex flex-col gap-2">
                {draft.travelers.map((tr) => (
                  <li key={tr.key}>
                    <Card padding="none" className="flex flex-wrap items-center gap-3 p-3">
                      <label className="flex min-h-11 flex-1 items-center gap-3">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-[color:var(--color-panel)]"
                          checked={tr.selected}
                          onChange={(e) => {
                            update({
                              travelers: draft.travelers.map((x) =>
                                x.key === tr.key ? { ...x, selected: e.target.checked } : x,
                              ),
                            });
                          }}
                        />
                        {tr.personId ? (
                          <span className="min-w-0 break-words">{tr.displayName}</span>
                        ) : (
                          <Input
                            aria-label={t('who.name')}
                            className="h-11 text-base"
                            value={tr.displayName}
                            placeholder={t('who.namePlaceholder')}
                            onChange={(e) => {
                              update({
                                travelers: draft.travelers.map((x) =>
                                  x.key === tr.key ? { ...x, displayName: e.target.value } : x,
                                ),
                              });
                            }}
                          />
                        )}
                      </label>
                      <Select
                        aria-label={t('who.type')}
                        className="h-11 w-auto text-base"
                        value={tr.travelerType}
                        onChange={(e) => {
                          update({
                            travelers: draft.travelers.map((x) =>
                              x.key === tr.key
                                ? { ...x, travelerType: e.target.value as TravelerType }
                                : x,
                            ),
                          });
                        }}
                      >
                        {(['adult', 'child', 'infant'] as const).map((ty) => (
                          <option key={ty} value={ty}>
                            {tc(`travelerType.${ty}`)}
                          </option>
                        ))}
                      </Select>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            {showError(travelers.length === 0) && (
              <p role="alert" className="text-sm text-[color:var(--color-negative)]">
                {t('errors.travelers')}
              </p>
            )}
            <Button
              variant="secondary"
              size="lg"
              className="self-start"
              onClick={() => {
                update({
                  travelers: [
                    ...draft.travelers,
                    {
                      key: key(),
                      personId: null,
                      displayName: '',
                      travelerType: 'adult',
                      selected: true,
                    },
                  ],
                });
              }}
            >
              {t('who.add')}
            </Button>
            <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('who.weights')}</p>
          </div>
        )}

        {draft.step === 2 && (
          <div className="flex flex-col gap-6">
            <Card>
              <fieldset className="flex flex-col gap-4">
                <legend className="mb-2 font-medium">{t('have.lodgingTitle')}</legend>
                {draft.legs.map((leg) => (
                  <Field key={leg.key} label={leg.city || t('where.legTitle', { n: 1 })}>
                    {(f) => (
                      <Select
                        id={f.id}
                        className="h-12 text-base"
                        value={leg.lodgingMode}
                        onChange={(e) => {
                          updateLeg(leg.key, { lodgingMode: e.target.value as LodgingMode });
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
                ))}
              </fieldset>
            </Card>

            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[color:var(--color-panel)]"
                checked={draft.nothingYet}
                onChange={(e) => {
                  update({
                    nothingYet: e.target.checked,
                    bookings:
                      !e.target.checked && draft.bookings.length === 0
                        ? [
                            {
                              key: key(),
                              bookingType: 'flight',
                              provider: '',
                              amount: '',
                              currency,
                              paid: true,
                            },
                          ]
                        : draft.bookings,
                  });
                }}
              />
              <span>{t('have.nothingYet')}</span>
            </label>

            {!draft.nothingYet && (
              <div className="flex flex-col gap-3">
                {draft.bookings.map((b) => (
                  <Card key={b.key}>
                    <div className="grid gap-4 @lg:grid-cols-2">
                      <Field label={t('have.type')}>
                        {(f) => (
                          <Select
                            id={f.id}
                            className="h-12 text-base"
                            value={b.bookingType}
                            onChange={(e) => {
                              update({
                                bookings: draft.bookings.map((x) =>
                                  x.key === b.key
                                    ? { ...x, bookingType: e.target.value as BookingKind }
                                    : x,
                                ),
                              });
                            }}
                          >
                            {(
                              [
                                'flight',
                                'lodging',
                                'insurance',
                                'tour',
                                'transport',
                                'visa',
                                'other',
                              ] as const
                            ).map((ty) => (
                              <option key={ty} value={ty}>
                                {tc(`bookingType.${ty}`)}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <Field label={t('have.provider')}>
                        {(f) => (
                          <Input
                            id={f.id}
                            className="h-12 text-base"
                            value={b.provider}
                            placeholder={t('have.providerPlaceholder')}
                            onChange={(e) => {
                              update({
                                bookings: draft.bookings.map((x) =>
                                  x.key === b.key ? { ...x, provider: e.target.value } : x,
                                ),
                              });
                            }}
                          />
                        )}
                      </Field>
                      <Field
                        label={t('have.amount')}
                        {...(showError(b.amount !== '' && !AMOUNT.test(b.amount))
                          ? { error: t('errors.amount') }
                          : {})}
                      >
                        {(f) => (
                          <Input
                            id={f.id}
                            inputMode="decimal"
                            numeric
                            className="h-12 text-base"
                            value={b.amount}
                            onChange={(e) => {
                              update({
                                bookings: draft.bookings.map((x) =>
                                  x.key === b.key ? { ...x, amount: e.target.value } : x,
                                ),
                              });
                            }}
                            onBlur={(e) => {
                              const n = normalizeAmount(e.target.value);
                              update({
                                bookings: draft.bookings.map((x) =>
                                  x.key === b.key ? { ...x, amount: n } : x,
                                ),
                              });
                            }}
                          />
                        )}
                      </Field>
                      <Field label={t('have.currency')}>
                        {(f) => (
                          <Select
                            id={f.id}
                            className="h-12 text-base"
                            value={b.currency}
                            onChange={(e) => {
                              update({
                                bookings: draft.bookings.map((x) =>
                                  x.key === b.key ? { ...x, currency: e.target.value } : x,
                                ),
                              });
                            }}
                          >
                            {[
                              ...new Set([currency, ...draft.legs.map((l) => l.localCurrency)]),
                            ].map((code) => (
                              <option key={code} value={code}>
                                {code}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <label className="flex min-h-11 items-center gap-3 @lg:col-span-2">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-[color:var(--color-panel)]"
                          checked={b.paid}
                          onChange={(e) => {
                            update({
                              bookings: draft.bookings.map((x) =>
                                x.key === b.key ? { ...x, paid: e.target.checked } : x,
                              ),
                            });
                          }}
                        />
                        <span>{t('have.paid')}</span>
                      </label>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-4 h-11"
                      onClick={() => {
                        update({ bookings: draft.bookings.filter((x) => x.key !== b.key) });
                      }}
                    >
                      {t('have.remove')}
                    </Button>
                  </Card>
                ))}
                <Button
                  variant="secondary"
                  size="lg"
                  className="self-start"
                  onClick={() => {
                    update({
                      bookings: [
                        ...draft.bookings,
                        {
                          key: key(),
                          bookingType: 'lodging',
                          provider: '',
                          amount: '',
                          currency,
                          paid: true,
                        },
                      ],
                    });
                  }}
                >
                  {t('have.add')}
                </Button>
                <p className="text-sm text-[color:var(--color-ink-secondary)]">
                  {t('have.scanLater')}
                </p>
              </div>
            )}
          </div>
        )}

        {draft.step === 3 && (
          <div className="flex flex-col gap-4">
            <Field
              label={t('money.total', { currency })}
              required
              {...(showError(!AMOUNT.test(draft.totalBudget)) ? { error: t('errors.amount') } : {})}
              hint={t('money.totalHint')}
            >
              {(f) => (
                <Input
                  id={f.id}
                  aria-describedby={f.describedBy}
                  invalid={f.invalid}
                  inputMode="decimal"
                  numeric
                  className="h-14 text-xl"
                  value={draft.totalBudget}
                  onChange={(e) => {
                    update({ totalBudget: e.target.value });
                  }}
                  onBlur={(e) => {
                    update({ totalBudget: normalizeAmount(e.target.value) });
                  }}
                />
              )}
            </Field>
            {suggestion && (
              <Card tone="sunk">
                <div className="flex flex-col gap-3">
                  <p className="text-sm">
                    {t('money.suggestion', {
                      low: money(suggestion.low),
                      high: money(suggestion.high),
                      days,
                    })}
                  </p>
                  <p className="text-xs text-[color:var(--color-ink-secondary)]">
                    {t('money.estimate')}
                  </p>
                  <Button
                    variant="secondary"
                    size="lg"
                    className="self-start"
                    onClick={() => {
                      update({ totalBudget: suggestion.high });
                    }}
                  >
                    {t('money.useSuggestion', { amount: money(suggestion.high) })}
                  </Button>
                </div>
              </Card>
            )}
            {future && (
              <Field label={t('money.saved')} hint={t('money.savedHint')}>
                {(f) => (
                  <Input
                    id={f.id}
                    inputMode="decimal"
                    numeric
                    className="h-12 text-base"
                    value={draft.alreadySaved}
                    onChange={(e) => {
                      update({ alreadySaved: e.target.value });
                    }}
                    onBlur={(e) => {
                      update({ alreadySaved: normalizeAmount(e.target.value) || '0' });
                    }}
                  />
                )}
              </Field>
            )}
          </div>
        )}

        {draft.step === 4 && (
          <div className="flex flex-col gap-6">
            <fieldset className="grid gap-3 @2xl:grid-cols-3">
              <legend className="sr-only">{t('style.profile')}</legend>
              {(['economy', 'balanced', 'comfort'] as const).map((p) => {
                const b = budgets[p];
                const perDay = b?.legs[0]?.perDiemFull ?? null;
                const checked = draft.profile === p;
                return (
                  <label
                    key={p}
                    className={`flex min-h-11 cursor-pointer flex-col gap-2 rounded-(--radius-lg) border p-4 ${checked ? 'border-[color:var(--color-ink)] bg-[color:var(--color-brand-sunk)]' : 'border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)]'}`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="profile"
                        className="h-5 w-5 accent-[color:var(--color-panel)]"
                        checked={checked}
                        onChange={() => {
                          update({ profile: p });
                        }}
                      />
                      <span className="font-medium">{tc(`profile.${p}`)}</span>
                    </span>
                    <span className="text-sm text-[color:var(--color-ink-secondary)]">
                      {t(`style.${p}`)}
                    </span>
                    {perDay && (
                      <span className="readout text-lg tabular-nums">
                        {t('style.perDay', { amount: money(perDay) })}
                      </span>
                    )}
                    {b?.legs[0]?.fullDay && (
                      <span className="text-sm text-[color:var(--color-ink-secondary)] tabular-nums">
                        {t('style.split', {
                          food: money(b.legs[0].fullDay.food),
                          activities: money(b.legs[0].fullDay.activities),
                        })}
                      </span>
                    )}
                    {b?.legs[0]?.lodgingToBook && (
                      <span className="text-sm text-[color:var(--color-ink-secondary)] tabular-nums">
                        {t('style.lodging', { amount: money(b.legs[0].lodgingToBook.perNight) })}
                      </span>
                    )}
                  </label>
                );
              })}
            </fieldset>
            <Field
              label={t('style.reserve', { percent: draft.reservePercent })}
              hint={t('style.reserveHint')}
            >
              {(f) => (
                <input
                  id={f.id}
                  type="range"
                  min={0}
                  max={30}
                  step={1}
                  value={draft.reservePercent}
                  className="h-11 w-full accent-[color:var(--color-panel)]"
                  onChange={(e) => {
                    update({ reservePercent: Number(e.target.value) });
                  }}
                />
              )}
            </Field>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[color:var(--color-panel)]"
                checked={draft.partialDays}
                onChange={(e) => {
                  update({ partialDays: e.target.checked });
                }}
              />
              <span>{t('style.partialDays')}</span>
            </label>
          </div>
        )}

        {draft.step === 5 && (
          <div className="flex flex-col gap-6">
            {budget ? (
              <>
                <Card tone="panel" padding="lg">
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-[color:var(--color-panel-ink-secondary)]">
                      {t('plan.perDayLabel')}
                    </p>
                    <p className="readout text-4xl tracking-[-0.03em] tabular-nums">
                      {money(budget.legs[0]?.perDiemFull ?? '0')}
                    </p>
                    {budget.legs[0]?.perDiemFullLocal &&
                      draft.legs[0]?.localCurrency !== currency && (
                        <p className="text-[color:var(--color-panel-ink-secondary)] tabular-nums">
                          {money(budget.legs[0].perDiemFullLocal, draft.legs[0]?.localCurrency)}
                        </p>
                      )}
                    <p className="text-sm text-[color:var(--color-panel-ink-secondary)]">
                      {formatDateRange(startDate, endDate, locale)} ·{' '}
                      {t('plan.travelers', { count: travelers.length })}
                    </p>
                  </div>
                </Card>
                <PlanStatus budget={budget} money={money} />
                <Card>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 text-sm">
                    <dt>{t('plan.committed')}</dt>
                    <dd className="text-right tabular-nums">{money(budget.commitments.prepaid)}</dd>
                    {budget.commitments.pending !== '0.00' && (
                      <>
                        <dt>{t('plan.pending')}</dt>
                        <dd className="text-right tabular-nums">
                          {money(budget.commitments.pending)}
                        </dd>
                      </>
                    )}
                    <dt>{t('plan.reserve')}</dt>
                    <dd className="text-right tabular-nums">{money(budget.reserve.planned)}</dd>
                    <dt className="font-medium">{t('plan.forDays')}</dt>
                    <dd className="text-right font-medium tabular-nums">
                      {money(budget.fundForDays)}
                    </dd>
                  </dl>
                </Card>
                {budget.legs[0]?.fullDay && (
                  <Card>
                    <p className="mb-3 font-medium">{t('plan.byCategory')}</p>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
                      {DAILY_CATEGORIES.filter((c) => budget.legs[0]?.fullDay?.[c] !== '0.00').map(
                        (c) => (
                          <div key={c} className="contents">
                            <dt>{tc(`category.${c}`)}</dt>
                            <dd className="text-right tabular-nums">
                              {money(budget.legs[0]?.fullDay?.[c] ?? '0')}
                            </dd>
                          </div>
                        ),
                      )}
                    </dl>
                  </Card>
                )}
              </>
            ) : (
              <Status tone="caution">{t('plan.incomplete')}</Status>
            )}
            <Field label={t('plan.name')}>
              {(f) => (
                <Input
                  id={f.id}
                  className="h-12 text-base"
                  maxLength={120}
                  value={draft.name}
                  onChange={(e) => {
                    update({ name: e.target.value });
                  }}
                />
              )}
            </Field>
            {future && (
              <label className="flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 accent-[color:var(--color-panel)]"
                  checked={draft.createGoal}
                  onChange={(e) => {
                    update({ createGoal: e.target.checked });
                  }}
                />
                <span>
                  <span className="block">{t('plan.createGoal')}</span>
                  <span className="block text-sm text-[color:var(--color-ink-secondary)]">
                    {t('plan.createGoalHint')}
                  </span>
                </span>
              </label>
            )}
            {error && (
              <p role="alert" className="text-sm text-[color:var(--color-negative)]">
                {t.has(`errors.server.${error}`)
                  ? t(`errors.server.${error}`)
                  : t('errors.server.saveFailed')}
              </p>
            )}
          </div>
        )}
      </form>

      {/* The step's one action, always reachable. */}
      <div className="sticky bottom-0 z-10 -mx-5 border-t border-[color:var(--color-rule)] bg-[color:var(--color-ground-raised)] px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:-mx-10 sm:px-10 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          {draft.step > 0 ? (
            <Button
              variant="ghost"
              size="lg"
              onClick={() => {
                go(draft.step - 1);
              }}
            >
              {t('back')}
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="submit"
            form={formId}
            size="lg"
            loading={pending}
            className="min-w-0 flex-1 @lg:flex-none"
          >
            <span className="truncate">{nextLabel}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function PlanStatus({
  budget,
  money,
}: {
  readonly budget: TripBudget;
  readonly money: (v: string) => string;
}) {
  const td = useTranslations('trips.diagnostics');
  const { status, shortfall } = budget.diagnostics;
  if (status === 'healthy') return <Status tone="positive">{td('healthy')}</Status>;
  if (status === 'tight') return <Status tone="caution">{td('tight')}</Status>;
  return <Status tone="negative">{td('deficit', { amount: money(shortfall) })}</Status>;
}
