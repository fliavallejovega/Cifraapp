'use client';

import { Button, Card, Status, type StatusTone } from '@app/ui';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import type { ClientDay, ClientLeg, ClientNotice, ClientRumbo } from '@/lib/rumbo-types';
import { setManualDrive } from '@/server/rumbo-actions';

import { useTripAction } from '../trips/use-trip-action';

/**
 * The route: the map on top, the days as a strip under it, and the selected
 * day in full below — timeline, figures, stretches with their navigation
 * links, what to do, what to watch out for and where the night is.
 */

const RumboMap = dynamic(() => import('./rumbo-map').then((m) => m.RumboMap), {
  ssr: false,
  loading: () => (
    <div className="h-[clamp(16rem,55vh,32rem)] w-full animate-pulse rounded-(--radius-lg) bg-[color:var(--color-ground-sunk)]" />
  ),
});

const TONE: Readonly<Record<ClientNotice['severity'], StatusTone>> = {
  info: 'neutral',
  warning: 'caution',
  critical: 'signal',
};

function firstDayToShow(days: readonly ClientDay[]): number {
  const drive = days.findIndex((d) => d.kind === 'drive');
  return drive >= 0 ? drive : 0;
}

export function RouteExplorer({
  data,
  locale,
  readOnly = false,
}: {
  readonly data: ClientRumbo;
  readonly locale: string;
  /** A shared link: nothing on it can write. */
  readonly readOnly?: boolean;
}) {
  const t = useTranslations('rumbo');
  const [selected, setSelected] = useState(() => firstDayToShow(data.days));
  const strip = useRef<HTMLDivElement>(null);
  const day = data.days[selected];
  const maxMinutes = Math.max(...data.days.map((d) => d.drivingMinutes), 1);

  // Keep the selected day in view in the strip, without moving the page.
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-day="${String(selected)}"]`);
    const box = strip.current;
    if (!el || !box) return;
    box.scrollTo({
      left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2,
      behavior: 'smooth',
    });
  }, [selected]);

  const move = (delta: number) => {
    const next = Math.min(Math.max(selected + delta, 0), data.days.length - 1);
    setSelected(next);
    strip.current?.querySelector<HTMLButtonElement>(`[data-day="${String(next)}"]`)?.focus();
  };

  return (
    <div className="flex flex-col gap-6">
      <RumboMap
        places={data.places}
        geometry={data.geometry}
        days={data.days}
        selected={selected}
      />

      <nav aria-label={t('days.strip')}>
        <div
          ref={strip}
          className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-2"
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              move(1);
            }
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              move(-1);
            }
          }}
        >
          {data.days.map((d) => {
            const active = d.index === selected;
            return (
              <button
                key={d.date}
                type="button"
                data-day={d.index}
                aria-pressed={active}
                onClick={() => {
                  setSelected(d.index);
                }}
                className={`flex min-h-12 w-24 shrink-0 snap-start flex-col items-start gap-1 rounded-(--radius-md) border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-ink)] ${
                  active
                    ? 'border-[color:var(--color-ink)] bg-[color:var(--color-surface)] shadow-(--shadow-card)'
                    : 'border-[color:var(--color-surface-border)] bg-[color:var(--color-ground)] hover:border-[color:var(--color-rule-strong)]'
                }`}
              >
                <span className="text-xs font-medium text-[color:var(--color-ink)]">
                  {d.shortLabel}
                </span>
                <span
                  aria-hidden
                  className="h-1 rounded-full bg-[color:var(--color-brand)]"
                  style={{
                    width: `${String(Math.max((d.drivingMinutes / maxMinutes) * 100, d.drivingMinutes > 0 ? 8 : 0))}%`,
                  }}
                />
                <span className="text-xs text-[color:var(--color-ink-secondary)] tabular-nums">
                  {d.kind === 'flight'
                    ? t('days.flight')
                    : d.drivingMinutes > 0
                      ? d.driving
                      : t('days.noDrive')}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {day && <DayPanel day={day} locale={locale} tripId={data.tripId} readOnly={readOnly} />}
    </div>
  );
}

function DayPanel({
  day,
  tripId,
  readOnly,
}: {
  readonly day: ClientDay;
  readonly locale: string;
  readonly tripId: string;
  readonly readOnly: boolean;
}) {
  const t = useTranslations('rumbo');
  const legs = day.drives.flatMap((d) => d.legs);
  const dayMaps =
    day.drives.find((d) => d.purpose === 'move')?.dayMapsUrl ?? day.drives[0]?.dayMapsUrl ?? null;

  return (
    <Card padding="lg">
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <p className="text-sm text-[color:var(--color-ink-secondary)] first-letter:uppercase">
            {day.label}
          </p>
          <h2
            className="text-2xl font-medium text-balance"
            style={{ letterSpacing: 'var(--tracking-title)' }}
          >
            {day.title}
          </h2>
          {day.offMap && (
            <p className="text-sm text-[color:var(--color-ink-secondary)]">{day.offMap}</p>
          )}
        </header>

        {day.flights.length > 0 && (
          <section className="flex flex-col gap-4" aria-labelledby={`timeline-${day.date}`}>
            <h3 id={`timeline-${day.date}`} className="text-base font-medium">
              {t('day.timeline')}
            </h3>
            {day.flights.map((f) => (
              <ol key={f.segmentId} className="flex flex-col">
                {f.entries.map((e, i) => (
                  <li
                    key={`${e.step}-${String(i)}`}
                    className="grid grid-cols-[4rem_1fr] gap-4 border-t border-[color:var(--color-rule)] py-3 first:border-t-0"
                  >
                    <span className="text-lg tabular-nums">
                      {e.certainty === 'confirmed' ? '' : '~'}
                      {e.time}
                    </span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{e.label}</span>
                        {(e.step === 'departs' || e.step === 'arrives') && (
                          <Status tone={e.certainty === 'confirmed' ? 'positive' : 'neutral'}>
                            {e.certaintyLabel}
                          </Status>
                        )}
                      </span>
                      <span className="text-sm text-[color:var(--color-ink-secondary)]">
                        {e.place}
                        {e.detail ? ` · ${e.detail}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            ))}
          </section>
        )}

        {day.drivingMinutes > 0 && (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Figure label={t('day.stats.km')} value={day.km} />
            <Figure label={t('day.stats.wheel')} value={day.driving} />
            <Figure label={t('day.stats.departure')} value={day.departure} />
            <Figure label={t('day.stats.arrival')} value={day.arrival ? `~${day.arrival}` : null} />
            <Figure label={t('day.stats.sunset')} value={day.sunset} />
          </dl>
        )}
        {day.routerNote && (
          <p className="-mt-4 text-sm text-[color:var(--color-ink-secondary)]">{day.routerNote}</p>
        )}

        {legs.length > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby={`legs-${day.date}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={`legs-${day.date}`} className="text-base font-medium">
                {t('day.legs')}
              </h3>
              {dayMaps && (
                <a href={dayMaps} target="_blank" rel="noreferrer" className={LINK}>
                  {t('day.wholeDay')}
                </a>
              )}
            </div>
            <ul className="flex flex-col">
              {legs.map((l, i) => (
                <LegRow key={`${l.from}-${l.to}-${String(i)}`} leg={l} />
              ))}
            </ul>
          </section>
        )}
        {!readOnly && day.drives.some((d) => d.incomplete) && (
          <ManualDrive tripId={tripId} day={day} />
        )}

        {day.notices.length > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby={`watch-${day.date}`}>
            <h3 id={`watch-${day.date}`} className="text-base font-medium">
              {t('day.watch')}
            </h3>
            <ul className="flex flex-col gap-2">
              {day.notices.map((n, i) => (
                <li key={String(i)} className="flex items-start gap-3 text-sm">
                  <Status tone={TONE[n.severity]}>{t(`severity.${n.severity}`)}</Status>
                  <span className="min-w-0 text-pretty">{n.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-3" aria-labelledby={`todo-${day.date}`}>
          <h3 id={`todo-${day.date}`} className="text-base font-medium">
            {t('day.todo')}
          </h3>
          {day.activities.length === 0 ? (
            <p className="text-sm text-[color:var(--color-ink-secondary)]">
              {t('day.noActivities')}
            </p>
          ) : (
            <ul className="flex flex-col">
              {day.activities.map((a) => (
                <li
                  key={`${a.place}-${a.name}`}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--color-rule)] py-3 first:border-t-0"
                >
                  <span className="flex min-w-0 flex-col">
                    <span
                      className={
                        a.closed
                          ? 'text-[color:var(--color-ink-secondary)] line-through'
                          : 'font-medium'
                      }
                    >
                      {a.name}
                    </span>
                    <span className="text-sm text-[color:var(--color-ink-secondary)]">
                      {a.place}
                      {a.closed
                        ? ` · ${t('day.closed')}`
                        : a.needsBooking
                          ? ` · ${t('day.needsBooking')}`
                          : ''}
                    </span>
                  </span>
                  <span className="flex gap-4">
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noreferrer" className={LINK}>
                        {t('day.officialSite')}
                      </a>
                    )}
                    <a href={a.mapUrl} target="_blank" rel="noreferrer" className={LINK}>
                      {t('day.maps')}
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="flex flex-col gap-2 border-t border-[color:var(--color-rule)] pt-6"
          aria-labelledby={`sleep-${day.date}`}
        >
          <h3 id={`sleep-${day.date}`} className="text-base font-medium">
            {t('day.sleep')}
          </h3>
          {day.sleep ? (
            <p className="flex flex-wrap items-center gap-2">
              <span>{day.sleep.name}</span>
              <Status tone={day.sleep.status === 'open' ? 'caution' : 'positive'}>
                {day.sleep.statusLabel}
              </Status>
            </p>
          ) : (
            <p className="text-[color:var(--color-ink-secondary)]">{day.sleepNote}</p>
          )}
        </section>
      </div>
    </Card>
  );
}

function Figure({ label, value }: { readonly label: string; readonly value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-[color:var(--color-ink-secondary)]">{label}</dt>
      <dd className="text-lg tabular-nums">{value ?? '—'}</dd>
    </div>
  );
}

function LegRow({ leg }: { readonly leg: ClientLeg }) {
  const t = useTranslations('rumbo');
  return (
    <li className="flex flex-col gap-2 border-t border-[color:var(--color-rule)] py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-medium text-pretty">
          {leg.fromName} → {leg.toName}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-sm text-[color:var(--color-ink-secondary)] tabular-nums">
          {leg.km} km · ~{leg.duration}
          {leg.mode === 'ferry' && <Status tone="neutral">{t('day.ferry')}</Status>}
          {leg.mountain && leg.maxElevation !== null && (
            <Status tone="neutral">
              {t('day.mountain')} · {leg.maxElevation} m
            </Status>
          )}
        </span>
      </span>
      {leg.mode !== 'ferry' && (
        <span className="flex shrink-0 gap-4">
          <a href={leg.wazeUrl} target="_blank" rel="noreferrer" className={LINK}>
            {t('day.waze')}
          </a>
          <a href={leg.mapsUrl} target="_blank" rel="noreferrer" className={LINK}>
            {t('day.maps')}
          </a>
        </span>
      )}
    </li>
  );
}

function ManualDrive({ tripId, day }: { readonly tripId: string; readonly day: ClientDay }) {
  const t = useTranslations('rumbo');
  const te = useTranslations('rumbo.errors');
  const { run, pending, error } = useTripAction();
  const [km, setKm] = useState('');
  const [minutes, setMinutes] = useState('');
  const driveId = day.drives.find((d) => d.pendingDriveId)?.pendingDriveId ?? null;
  if (!driveId) return null;
  return (
    <form
      className="flex flex-col gap-3 rounded-(--radius-md) bg-[color:var(--color-ground-sunk)] p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          setManualDrive({ tripId, driveId, distanceKm: Number(km), minutes: Number(minutes) }),
        );
      }}
    >
      <p className="text-sm font-medium">{t('day.manual.title')}</p>
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm">
          {t('day.manual.km')}
          <input
            inputMode="decimal"
            value={km}
            onChange={(e) => {
              setKm(e.target.value);
            }}
            className="min-h-11 w-32 rounded-(--radius-sm) border border-[color:var(--color-rule-strong)] bg-[color:var(--color-surface)] px-3 text-base tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('day.manual.minutes')}
          <input
            inputMode="numeric"
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value);
            }}
            className="min-h-11 w-32 rounded-(--radius-sm) border border-[color:var(--color-rule-strong)] bg-[color:var(--color-surface)] px-3 text-base tabular-nums"
          />
        </label>
      </div>
      {error && <p className="text-sm text-[color:var(--color-negative)]">{te(error)}</p>}
      <div>
        <Button type="submit" variant="secondary" loading={pending}>
          {t('day.manual.save')}
        </Button>
      </div>
    </form>
  );
}

const LINK =
  'inline-flex min-h-11 items-center text-sm font-medium underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-ink)]';
