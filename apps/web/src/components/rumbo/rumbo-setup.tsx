'use client';

import { Button, Card, Field, Input, Select, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useRouter } from '@/i18n/navigation';
import {
  addAnchor,
  addFlightSegment,
  addRumboTraveler,
  addWish,
  composeRumbo,
  confirmFlightTime,
  importTicketText,
  removeAnchor,
  removeFlightSegment,
  removeWish,
  saveRumboSettings,
  saveTravelerPassports,
  searchRumboPlaces,
  type PlaceSuggestion,
} from '@/server/rumbo-actions';

import { useTripAction } from '../trips/use-trip-action';

/**
 * «Armar el viaje»: five short steps, each saved the moment it changes, so
 * the draft lives in the database and the person can leave and come back.
 * The last step's button composes the trip and opens it.
 */

export interface SetupData {
  readonly tripId: string;
  readonly start: string;
  readonly end: string;
  readonly currency: string;
  readonly composed: boolean;
  readonly travelers: readonly {
    id: string;
    name: string;
    nationalities: readonly string[];
    residence: string | null;
  }[];
  readonly anchors: readonly {
    id: string;
    kind: string;
    placeName: string;
    from: string;
    to: string;
    label: string | null;
  }[];
  readonly flights: readonly {
    id: string;
    route: string;
    departsDate: string;
    departsTime: string;
    departsCertainty: string;
    arrivesDate: string;
    arrivesTime: string;
    arrivesCertainty: string;
  }[];
  readonly wishes: readonly {
    id: string;
    text: string;
    tags: readonly string[];
    matched: boolean | null;
  }[];
  readonly countries: readonly { code: string; name: string }[];
  readonly settings: {
    readonly drivingBudget: number;
    readonly departureTime: string;
    readonly lodgingCap: string | null;
    readonly breakfast: boolean;
    readonly parking: boolean;
  };
}

const STEPS = ['travelers', 'anchors', 'flights', 'wishes', 'settings'] as const;
type Step = (typeof STEPS)[number];

export function RumboSetup({
  data,
  documents,
}: {
  readonly data: SetupData;
  /** The trip's document upload and list, rendered by the page. */
  readonly documents: ReactNode;
}) {
  const t = useTranslations('rumbo');
  const te = useTranslations('rumbo.errors');
  const router = useRouter();
  const [step, setStep] = useState<Step>('travelers');
  const index = STEPS.indexOf(step);
  const { run, pending, error, setError } = useTripAction();
  const [confirmReplace, setConfirmReplace] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  const go = (next: Step) => {
    setStep(next);
    top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const compose = (replaceManualLegs: boolean) => {
    setConfirmReplace(false);
    run(
      () => composeRumbo(data.tripId, { replaceManualLegs }),
      () => {
        router.push(`/trips/${data.tripId}/route`);
      },
    );
  };

  useEffect(() => {
    if (error === 'manualLegsExist') {
      setConfirmReplace(true);
      setError(null);
    }
  }, [error, setError]);

  return (
    <div ref={top} className="flex scroll-mt-24 flex-col gap-8">
      <nav aria-label={t('setup.progress', { step: index + 1, total: STEPS.length })}>
        <p className="mb-3 text-sm text-[color:var(--color-ink-secondary)]">
          {t('setup.progress', { step: index + 1, total: STEPS.length })}
        </p>
        <ol className="grid grid-cols-5 gap-2">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                aria-current={s === step ? 'step' : undefined}
                onClick={() => {
                  go(s);
                }}
                className="flex min-h-11 w-full flex-col items-start gap-2 text-left text-xs"
              >
                <span
                  aria-hidden
                  className={`h-1 w-full rounded-full ${i <= index ? 'bg-[color:var(--color-ink)]' : 'bg-[color:var(--color-rule)]'}`}
                />
                <span
                  className={s === step ? 'font-medium' : 'text-[color:var(--color-ink-secondary)]'}
                >
                  {t(`setup.steps.${s}`)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {step === 'travelers' && <TravelersStep data={data} />}
      {step === 'anchors' && <AnchorsStep data={data} />}
      {step === 'flights' && <FlightsStep data={data} documents={documents} />}
      {step === 'wishes' && <WishesStep data={data} />}
      {step === 'settings' && <SettingsStep data={data} />}

      {confirmReplace && (
        <Card padding="lg">
          <div className="flex flex-col gap-4">
            <p className="font-medium">{t('setup.replaceLegs.title')}</p>
            <p className="text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              {t('setup.replaceLegs.body')}
            </p>
            <div className="flex flex-wrap gap-4">
              <Button
                className="min-h-11"
                variant="destructive"
                loading={pending}
                onClick={() => {
                  compose(true);
                }}
              >
                {t('setup.replaceLegs.confirm')}
              </Button>
              <Button
                className="min-h-11"
                variant="ghost"
                onClick={() => {
                  setConfirmReplace(false);
                }}
              >
                {t('setup.replaceLegs.cancel')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {error && error !== 'manualLegsExist' && (
        <p role="alert" className="text-sm text-[color:var(--color-negative)]">
          {te(error)}
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-4 border-t border-[color:var(--color-rule)] bg-[color:var(--color-ground)] px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button
          className="min-h-11"
          variant="ghost"
          disabled={index === 0}
          onClick={() => {
            const prev = STEPS[index - 1];
            if (prev) go(prev);
          }}
        >
          {t('setup.back')}
        </Button>
        {index < STEPS.length - 1 ? (
          <Button
            className="min-h-11"
            variant="secondary"
            onClick={() => {
              const next = STEPS[index + 1];
              if (next) go(next);
            }}
          >
            {t('setup.next')}
          </Button>
        ) : (
          <Button
            className="min-h-11"
            size="lg"
            loading={pending}
            onClick={() => {
              compose(false);
            }}
          >
            {pending
              ? t('setup.composing')
              : data.composed
                ? t('setup.recompose')
                : t('setup.compose')}
          </Button>
        )}
      </div>
    </div>
  );
}

function StepHeader({ title, detail }: { readonly title: string; readonly detail?: string }) {
  return (
    <header className="flex flex-col gap-2">
      <h2 className="text-2xl font-medium text-balance">{title}</h2>
      {detail && (
        <p className="max-w-[68ch] text-pretty text-[color:var(--color-ink-secondary)]">{detail}</p>
      )}
    </header>
  );
}

function ErrorLine({ error }: { readonly error: string | null }) {
  const te = useTranslations('rumbo.errors');
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-[color:var(--color-negative)]">
      {te(error)}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Travellers
// ---------------------------------------------------------------------------

function TravelersStep({ data }: { readonly data: SetupData }) {
  const t = useTranslations('rumbo');
  // Names come from the server: the browser's own region names can differ and break hydration.
  const countries = data.countries;
  const { run, pending, error } = useTripAction();
  const [name, setName] = useState('');
  const [nat, setNat] = useState('PA');
  const [residence, setResidence] = useState(data.travelers[0]?.residence ?? 'PA');

  return (
    <section className="flex flex-col gap-6">
      <StepHeader title={t('setup.travelers.title')} detail={t('setup.travelers.detail')} />
      {data.travelers.length === 0 && (
        <p className="text-[color:var(--color-ink-secondary)]">{t('setup.travelers.empty')}</p>
      )}
      {data.travelers.map((tr) => (
        <TravelerCard key={tr.id} tripId={data.tripId} traveler={tr} countries={countries} />
      ))}
      <Card>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                addRumboTraveler({ tripId: data.tripId, name, nationalities: [nat], residence }),
              () => {
                setName('');
              },
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('setup.travelers.name')} required>
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
            <Field label={t('setup.travelers.nationalities')}>
              {({ id }) => (
                <Select
                  className="min-h-11"
                  id={id}
                  value={nat}
                  onChange={(e) => {
                    setNat(e.target.value);
                  }}
                >
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('setup.travelers.residence')}>
              {({ id }) => (
                <Select
                  className="min-h-11"
                  id={id}
                  value={residence}
                  onChange={(e) => {
                    setResidence(e.target.value);
                  }}
                >
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <ErrorLine error={error} />
          <div>
            <Button
              className="min-h-11"
              type="submit"
              variant="secondary"
              loading={pending}
              disabled={name.trim() === ''}
            >
              {t('setup.travelers.add')}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}

function TravelerCard({
  tripId,
  traveler,
  countries,
}: {
  readonly tripId: string;
  readonly traveler: SetupData['travelers'][number];
  readonly countries: readonly { code: string; name: string }[];
}) {
  const t = useTranslations('rumbo');
  const { run, pending, error } = useTripAction();
  const [nats, setNats] = useState<string[]>(
    traveler.nationalities.length > 0 ? [...traveler.nationalities] : [''],
  );
  const [residence, setResidence] = useState(traveler.residence ?? '');
  const name = (code: string) => countries.find((c) => c.code === code)?.name ?? code;

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() =>
            saveTravelerPassports({
              tripId,
              travelerId: traveler.id,
              nationalities: nats.filter(Boolean),
              residence: residence || null,
            }),
          );
        }}
      >
        <p className="font-medium">{traveler.name}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {nats.map((n, i) => (
            <Field
              key={String(i)}
              label={`${t('setup.travelers.nationalities')} ${nats.length > 1 ? String(i + 1) : ''}`.trim()}
            >
              {({ id }) => (
                <Select
                  className="min-h-11"
                  id={id}
                  value={n}
                  onChange={(e) => {
                    const next = [...nats];
                    next[i] = e.target.value;
                    setNats(next);
                  }}
                >
                  <option value="">—</option>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ))}
          <Field label={t('setup.travelers.residence')}>
            {({ id }) => (
              <Select
                className="min-h-11"
                id={id}
                value={residence}
                onChange={(e) => {
                  setResidence(e.target.value);
                }}
              >
                <option value="">—</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <ErrorLine error={error} />
        <div className="flex flex-wrap items-center gap-4">
          <Button
            className="min-h-11"
            type="submit"
            variant="secondary"
            loading={pending}
            disabled={nats.filter(Boolean).length === 0}
          >
            {t('setup.travelers.save')}
          </Button>
          {nats.length < 3 && (
            <Button
              className="min-h-11"
              type="button"
              variant="ghost"
              onClick={() => {
                setNats([...nats, '']);
              }}
            >
              {t('setup.travelers.addNationality')}
            </Button>
          )}
          <span className="text-sm text-[color:var(--color-ink-secondary)]">
            {traveler.nationalities.map(name).join(' · ')}
          </span>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Fixed points
// ---------------------------------------------------------------------------

const ANCHOR_KINDS = ['car_pickup', 'car_return', 'friends', 'event', 'stay'] as const;
type AnchorKind = (typeof ANCHOR_KINDS)[number];

function PlacePicker({
  value,
  onChange,
}: {
  readonly value: PlaceSuggestion | null;
  readonly onChange: (p: PlaceSuggestion | null) => void;
}) {
  const t = useTranslations('rumbo');
  const [query, setQuery] = useState(value?.name ?? '');
  const [results, setResults] = useState<PlaceSuggestion[] | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <Field label={t('setup.anchors.place')} hint={t('setup.anchors.placeHint')} required>
      {({ id, describedBy }) => (
        <div className="relative flex flex-col gap-2">
          <Input
            className="min-h-11"
            id={id}
            aria-describedby={describedBy}
            autoComplete="off"
            value={query}
            onChange={(e) => {
              const q = e.target.value;
              setQuery(q);
              onChange(null);
              if (timer.current) window.clearTimeout(timer.current);
              if (q.trim().length < 2) {
                setResults(null);
                return;
              }
              timer.current = window.setTimeout(() => {
                setSearching(true);
                void searchRumboPlaces(q).then((r) => {
                  setResults(r.places ?? []);
                  setSearching(false);
                });
              }, 250);
            }}
          />
          {searching && (
            <p className="text-sm text-[color:var(--color-ink-secondary)]">
              {t('setup.anchors.searching')}
            </p>
          )}
          {results && !value && (
            <ul className="flex flex-col rounded-(--radius-md) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)]">
              {results.length === 0 && (
                <li className="p-3 text-sm text-[color:var(--color-ink-secondary)]">
                  {t('setup.anchors.noResults')}
                </li>
              )}
              {results.map((r) => (
                <li key={`${r.catalogId ?? ''}-${String(r.lat)}-${String(r.lon)}`}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center px-3 text-left text-sm hover:bg-[color:var(--color-ground-sunk)]"
                    onClick={() => {
                      onChange(r);
                      setQuery(r.name);
                      setResults(null);
                    }}
                  >
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}

function AnchorsStep({ data }: { readonly data: SetupData }) {
  const t = useTranslations('rumbo');
  const { run, pending, error } = useTripAction();
  const hasPickup = data.anchors.some((a) => a.kind === 'car_pickup');
  const hasReturn = data.anchors.some((a) => a.kind === 'car_return');
  const [kind, setKind] = useState<AnchorKind>(
    hasPickup ? (hasReturn ? 'friends' : 'car_return') : 'car_pickup',
  );
  const [place, setPlace] = useState<PlaceSuggestion | null>(null);
  const [from, setFrom] = useState(data.start);
  const [to, setTo] = useState(data.start);
  const [maxNights, setMaxNights] = useState('');
  const oneDay = kind === 'car_pickup' || kind === 'car_return' || kind === 'event';

  return (
    <section className="flex flex-col gap-6">
      <StepHeader title={t('setup.anchors.title')} detail={t('setup.anchors.detail')} />
      {(!hasPickup || !hasReturn) && (
        <p className="text-sm">
          <Status tone="caution">{t('setup.anchors.needsCar')}</Status>
        </p>
      )}
      <Card>
        {data.anchors.length === 0 ? (
          <p className="text-[color:var(--color-ink-secondary)]">{t('setup.anchors.empty')}</p>
        ) : (
          <ul className="flex flex-col">
            {data.anchors.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--color-rule)] py-3 first:border-t-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {t(`setup.anchors.kinds.${a.kind}`)} · {a.placeName}
                  </span>
                  <span className="text-sm text-[color:var(--color-ink-secondary)] tabular-nums">
                    {a.from === a.to ? a.from : `${a.from} → ${a.to}`}
                    {a.label ? ` · ${a.label}` : ''}
                  </span>
                </span>
                <Button
                  className="min-h-11"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    run(() => removeAnchor(data.tripId, a.id));
                  }}
                >
                  {t('setup.anchors.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!place) return;
            const placeInput = place.catalogId
              ? { catalogId: place.catalogId }
              : {
                  name: place.name,
                  country: place.country,
                  lat: place.lat,
                  lon: place.lon,
                  timeZone: place.timeZone ?? 'UTC',
                  kind: kind === 'event' ? ('poi' as const) : ('town' as const),
                };
            run(
              () =>
                addAnchor({
                  tripId: data.tripId,
                  kind,
                  place: placeInput,
                  from,
                  to: oneDay ? from : to,
                  maxNights: kind === 'friends' && maxNights ? Number(maxNights) : null,
                  hosted: kind === 'friends',
                  paid: kind === 'stay',
                }),
              () => {
                setPlace(null);
              },
            );
          }}
        >
          <Field label={t('setup.anchors.kind')}>
            {({ id }) => (
              <Select
                className="min-h-11"
                id={id}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as AnchorKind);
                }}
              >
                {ANCHOR_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`setup.anchors.kinds.${k}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <PlacePicker value={place} onChange={setPlace} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={oneDay ? t('setup.anchors.date') : t('setup.anchors.firstNight')}>
              {({ id }) => (
                <Input
                  className="min-h-11"
                  id={id}
                  type="date"
                  min={data.start}
                  max={data.end}
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    if (to < e.target.value) setTo(e.target.value);
                  }}
                />
              )}
            </Field>
            {!oneDay && (
              <Field label={t('setup.anchors.lastNight')}>
                {({ id }) => (
                  <Input
                    className="min-h-11"
                    id={id}
                    type="date"
                    min={from}
                    max={data.end}
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                    }}
                  />
                )}
              </Field>
            )}
            {kind === 'friends' && (
              <Field label={t('setup.anchors.maxNights')}>
                {({ id }) => (
                  <Input
                    className="min-h-11"
                    id={id}
                    inputMode="numeric"
                    value={maxNights}
                    onChange={(e) => {
                      setMaxNights(e.target.value);
                    }}
                  />
                )}
              </Field>
            )}
          </div>
          <ErrorLine error={error} />
          <div>
            <Button
              className="min-h-11"
              type="submit"
              variant="secondary"
              loading={pending}
              disabled={!place}
            >
              {t('setup.anchors.add')}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

function FlightsStep({
  data,
  documents,
}: {
  readonly data: SetupData;
  readonly documents: ReactNode;
}) {
  const t = useTranslations('rumbo');
  const tc = useTranslations('rumbo.certainty');
  const { run, pending, error } = useTripAction();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dDate, setDDate] = useState(data.start);
  const [dTime, setDTime] = useState('');
  const [aDate, setADate] = useState(data.start);
  const [aTime, setATime] = useState('');
  const [fromTicket, setFromTicket] = useState(true);

  return (
    <section className="flex flex-col gap-6">
      <StepHeader title={t('setup.flights.title')} detail={t('setup.flights.detail')} />
      <Card>{documents}</Card>

      <PasteTicket tripId={data.tripId} />

      <Card>
        <h3 className="mb-2 text-base font-medium">{t('setup.flights.list')}</h3>
        {data.flights.length === 0 ? (
          <p className="text-[color:var(--color-ink-secondary)]">{t('setup.flights.empty')}</p>
        ) : (
          <ul className="flex flex-col">
            {data.flights.map((f) => (
              <li
                key={f.id}
                className="flex flex-col gap-3 border-t border-[color:var(--color-rule)] py-3 first:border-t-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{f.route}</span>
                  <Button
                    className="min-h-11"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      run(() => removeFlightSegment(data.tripId, f.id));
                    }}
                  >
                    {t('setup.flights.remove')}
                  </Button>
                </div>
                <FlightTime
                  tripId={data.tripId}
                  segmentId={f.id}
                  which="departs"
                  label={t('setup.flights.departs')}
                  date={f.departsDate}
                  time={f.departsTime}
                  certainty={f.departsCertainty}
                  certaintyLabel={
                    f.departsCertainty === 'confirmed' ? tc('ticket') : tc('estimated')
                  }
                />
                <FlightTime
                  tripId={data.tripId}
                  segmentId={f.id}
                  which="arrives"
                  label={t('setup.flights.arrives')}
                  date={f.arrivesDate}
                  time={f.arrivesTime}
                  certainty={f.arrivesCertainty}
                  certaintyLabel={
                    f.arrivesCertainty === 'confirmed' ? tc('ticket') : tc('estimated')
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                addFlightSegment({
                  tripId: data.tripId,
                  from: from.toUpperCase(),
                  to: to.toUpperCase(),
                  departsDate: dDate,
                  departsTime: dTime,
                  arrivesDate: aDate,
                  arrivesTime: aTime,
                  fromTicket,
                }),
              () => {
                setFrom('');
                setTo('');
                setDTime('');
                setATime('');
              },
            );
          }}
        >
          <h3 className="text-base font-medium">{t('setup.flights.orManual')}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('setup.flights.from')}>
              {({ id }) => (
                <Input
                  className="min-h-11"
                  id={id}
                  maxLength={3}
                  autoCapitalize="characters"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                  }}
                />
              )}
            </Field>
            <Field label={t('setup.flights.to')}>
              {({ id }) => (
                <Input
                  className="min-h-11"
                  id={id}
                  maxLength={3}
                  autoCapitalize="characters"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                  }}
                />
              )}
            </Field>
            <Field label={t('setup.flights.departs')}>
              {({ id }) => (
                <div className="flex gap-2">
                  <Input
                    className="min-h-11"
                    id={id}
                    type="date"
                    value={dDate}
                    onChange={(e) => {
                      setDDate(e.target.value);
                    }}
                  />
                  <Input
                    className="min-h-11"
                    type="time"
                    aria-label={t('setup.flights.departs')}
                    value={dTime}
                    onChange={(e) => {
                      setDTime(e.target.value);
                    }}
                  />
                </div>
              )}
            </Field>
            <Field label={t('setup.flights.arrives')}>
              {({ id }) => (
                <div className="flex gap-2">
                  <Input
                    className="min-h-11"
                    id={id}
                    type="date"
                    value={aDate}
                    onChange={(e) => {
                      setADate(e.target.value);
                    }}
                  />
                  <Input
                    className="min-h-11"
                    type="time"
                    aria-label={t('setup.flights.arrives')}
                    value={aTime}
                    onChange={(e) => {
                      setATime(e.target.value);
                    }}
                  />
                </div>
              )}
            </Field>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={fromTicket}
              onChange={(e) => {
                setFromTicket(e.target.checked);
              }}
            />
            {t('setup.flights.fromTicket')}
          </label>
          <ErrorLine error={error} />
          <div>
            <Button
              className="min-h-11"
              type="submit"
              variant="secondary"
              loading={pending}
              disabled={from.length !== 3 || to.length !== 3 || !dTime || !aTime}
            >
              {t('setup.flights.add')}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}

function PasteTicket({ tripId }: { readonly tripId: string }) {
  const t = useTranslations('rumbo');
  const { run, pending, error } = useTripAction();
  const [text, setText] = useState('');
  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => importTicketText({ tripId, text }),
            () => {
              setText('');
            },
          );
        }}
      >
        <Field label={t('setup.flights.paste')} hint={t('setup.flights.pasteHint')}>
          {({ id, describedBy }) => (
            <textarea
              id={id}
              aria-describedby={describedBy}
              rows={5}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
              className="w-full rounded-(--radius-sm) border border-[color:var(--color-rule-strong)] bg-[color:var(--color-surface)] p-3 text-base"
            />
          )}
        </Field>
        <ErrorLine error={error} />
        <div>
          <Button
            className="min-h-11"
            type="submit"
            variant="secondary"
            loading={pending}
            disabled={text.trim().length < 10}
          >
            {t('setup.flights.pasteRead')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function FlightTime({
  tripId,
  segmentId,
  which,
  label,
  date,
  time,
  certainty,
  certaintyLabel,
}: {
  readonly tripId: string;
  readonly segmentId: string;
  readonly which: 'departs' | 'arrives';
  readonly label: string;
  readonly date: string;
  readonly time: string;
  readonly certainty: string;
  readonly certaintyLabel: string;
}) {
  const t = useTranslations('rumbo');
  const { run, pending, error } = useTripAction();
  const [d, setD] = useState(date);
  const [h, setH] = useState(time);
  const estimated = certainty !== 'confirmed';
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-[color:var(--color-ink-secondary)]">{label}</span>
        <span className="tabular-nums">
          {estimated ? '~' : ''}
          {date} {time}
        </span>
        <Status tone={estimated ? 'neutral' : 'positive'}>{certaintyLabel}</Status>
      </p>
      {estimated && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => confirmFlightTime({ tripId, segmentId, which, date: d, time: h }));
          }}
        >
          <p className="w-full text-xs text-[color:var(--color-ink-secondary)]">
            {t('setup.flights.estimated')}
          </p>
          <Input
            type="date"
            aria-label={label}
            value={d}
            onChange={(e) => {
              setD(e.target.value);
            }}
            className="min-h-11 w-40"
          />
          <Input
            type="time"
            aria-label={label}
            value={h}
            onChange={(e) => {
              setH(e.target.value);
            }}
            className="min-h-11 w-28"
          />
          <Button
            className="min-h-11"
            type="submit"
            size="sm"
            variant="secondary"
            loading={pending}
          >
            {t('setup.flights.confirm')}
          </Button>
          <ErrorLine error={error} />
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wishes
// ---------------------------------------------------------------------------

function WishesStep({ data }: { readonly data: SetupData }) {
  const t = useTranslations('rumbo');
  const { run, pending, error } = useTripAction();
  const [text, setText] = useState('');
  return (
    <section className="flex flex-col gap-6">
      <StepHeader title={t('setup.wishes.title')} detail={t('setup.wishes.detail')} />
      <Card>
        {data.wishes.length === 0 ? (
          <p className="text-[color:var(--color-ink-secondary)]">{t('setup.wishes.empty')}</p>
        ) : (
          <ul className="flex flex-col">
            {data.wishes.map((w) => (
              <li
                key={w.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--color-rule)] py-3 first:border-t-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-pretty">«{w.text}»</span>
                  <span className="text-sm text-[color:var(--color-ink-secondary)]">
                    {w.tags.length > 0
                      ? t('setup.wishes.matched', { tags: w.tags.join(', ') })
                      : t('setup.wishes.unmatched')}
                  </span>
                </span>
                <Button
                  className="min-h-11"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    run(() => removeWish(data.tripId, w.id));
                  }}
                >
                  {t('setup.wishes.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => addWish({ tripId: data.tripId, text }),
              () => {
                setText('');
              },
            );
          }}
        >
          <Field label={t('setup.wishes.title')}>
            {({ id }) => (
              <Input
                className="min-h-11"
                id={id}
                placeholder={t('setup.wishes.placeholder')}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                }}
              />
            )}
          </Field>
          <ErrorLine error={error} />
          <div>
            <Button
              className="min-h-11"
              type="submit"
              variant="secondary"
              loading={pending}
              disabled={text.trim().length < 2}
            >
              {t('setup.wishes.add')}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Driving and lodging
// ---------------------------------------------------------------------------

function SettingsStep({ data }: { readonly data: SetupData }) {
  const t = useTranslations('rumbo');
  const { run, pending, error } = useTripAction();
  const [hours, setHours] = useState(String(data.settings.drivingBudget / 60));
  const [departure, setDeparture] = useState(data.settings.departureTime);
  const [cap, setCap] = useState(
    data.settings.lodgingCap ? data.settings.lodgingCap.replace(/\.?0+$/, '') : '',
  );
  const [breakfast, setBreakfast] = useState(data.settings.breakfast);
  const [parking, setParking] = useState(data.settings.parking);
  return (
    <section className="flex flex-col gap-6">
      <StepHeader title={t('setup.settings.title')} />
      <Card>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() =>
              saveRumboSettings({
                tripId: data.tripId,
                drivingBudget: Math.round(Number(hours) * 60),
                departureTime: departure,
                lodgingCap: cap ? cap.replace(',', '.') : null,
                breakfast,
                parking,
                groundMode: 'car',
              }),
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('setup.settings.budget')}>
              {({ id }) => (
                <Select
                  className="min-h-11"
                  id={id}
                  value={hours}
                  onChange={(e) => {
                    setHours(e.target.value);
                  }}
                >
                  {['3', '4', '5', '6', '7', '8'].map((h) => (
                    <option key={h} value={h}>
                      {t('setup.settings.budgetHours', { hours: h })}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('setup.settings.departure')}>
              {({ id }) => (
                <Input
                  className="min-h-11"
                  id={id}
                  type="time"
                  value={departure}
                  onChange={(e) => {
                    setDeparture(e.target.value);
                  }}
                />
              )}
            </Field>
            <Field
              label={t('setup.settings.cap')}
              hint={t('setup.settings.capHint', { currency: data.currency })}
            >
              {({ id, describedBy }) => (
                <Input
                  className="min-h-11"
                  id={id}
                  aria-describedby={describedBy}
                  numeric
                  inputMode="decimal"
                  value={cap}
                  onChange={(e) => {
                    setCap(e.target.value);
                  }}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={breakfast}
                onChange={(e) => {
                  setBreakfast(e.target.checked);
                }}
              />
              {t('setup.settings.breakfast')}
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={parking}
                onChange={(e) => {
                  setParking(e.target.checked);
                }}
              />
              {t('setup.settings.parking')}
            </label>
          </div>
          <ErrorLine error={error} />
          <div>
            <Button className="min-h-11" type="submit" variant="secondary" loading={pending}>
              {t('setup.settings.save')}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}
