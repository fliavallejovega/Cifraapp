'use client';

import { Button, Field, Input, Select } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import {
  addExtraStop,
  removeExtraStop,
  searchRumboPlaces,
  type PlaceSuggestion,
} from '@/server/rumbo-actions';

import { useTripAction } from '../trips/use-trip-action';

import { loadGoogleMaps, type PickedPlace } from './rumbo-map';

/**
 * «Agregar una parada a este día»: a café, a viewpoint, a museum found on the
 * map or by name. Rumbo slots it into the day where it costs the least detour
 * and recomputes the hours and the daylight. With a Google Maps key the
 * search is Google's own, biased to the day's route; without one, it is
 * Rumbo's catalogue and OpenStreetMap.
 */

type Candidate =
  | { readonly source: 'google'; readonly place: PickedPlace }
  | { readonly source: 'rumbo'; readonly place: PlaceSuggestion };

const MINUTES = [15, 30, 60, 90, 120, 180] as const;

export function AddStop({
  tripId,
  date,
  dayLabel,
  stops,
  apiKey,
  locale,
  bias,
  picked,
  onPickedUsed,
}: {
  readonly tripId: string;
  readonly date: string;
  readonly dayLabel: string;
  readonly stops: readonly {
    readonly id: string;
    readonly name: string;
    readonly minutes: number | null;
  }[];
  readonly apiKey: string | null;
  readonly locale: string;
  /** Centre of the day's route, to rank nearby results first. */
  readonly bias: { readonly lat: number; readonly lon: number } | null;
  /** A place tapped on the map, waiting to be added. */
  readonly picked: PickedPlace | null;
  readonly onPickedUsed: () => void;
}) {
  const t = useTranslations('rumbo');
  const te = useTranslations('rumbo.errors');
  const { run, pending, error } = useTripAction();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [choice, setChoice] = useState<Candidate | null>(null);
  const [minutes, setMinutes] = useState('60');
  const [searching, setSearching] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (picked) {
      setChoice({ source: 'google', place: picked });
      setQuery(picked.name);
      setResults(null);
    }
  }, [picked]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const search = async (text: string): Promise<Candidate[]> => {
    if (apiKey) {
      try {
        const g = await loadGoogleMaps(apiKey, locale);
        const { AutocompleteSuggestion } = (await g.maps.importLibrary(
          'places',
        ));
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: text,
          language: locale,
          ...(bias
            ? { locationBias: { center: { lat: bias.lat, lng: bias.lon }, radius: 50_000 } }
            : {}),
        });
        const out: Candidate[] = [];
        for (const s of suggestions.slice(0, 5)) {
          const prediction = s.placePrediction;
          if (!prediction) continue;
          const place = prediction.toPlace();
          await place.fetchFields({
            fields: ['displayName', 'location', 'addressComponents', 'formattedAddress'],
          });
          if (!place.location) continue;
          out.push({
            source: 'google',
            place: {
              googlePlaceId: place.id,
              name: place.displayName ?? prediction.mainText?.text ?? text,
              country:
                place.addressComponents?.find((c) => c.types.includes('country'))?.shortText ??
                null,
              lat: place.location.lat(),
              lon: place.location.lng(),
              address: place.formattedAddress ?? null,
            },
          });
        }
        return out;
      } catch {
        // Fall through to Rumbo's own search.
      }
    }
    const r = await searchRumboPlaces(text);
    return (r.places ?? []).map((p) => ({ source: 'rumbo' as const, place: p }));
  };

  const label = (c: Candidate) =>
    c.source === 'google'
      ? c.place.address
        ? `${c.place.name} · ${c.place.address}`
        : c.place.name
      : c.place.label;

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`add-${date}`}>
      <h3 id={`add-${date}`} className="text-base font-medium">
        {t('addStop.title')}
      </h3>
      {stops.length > 0 && (
        <ul className="flex flex-col">
          {stops.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--color-rule)] py-2 first:border-t-0"
            >
              <span className="text-sm">
                {s.name}
                {s.minutes !== null
                  ? ` · ${t('addStop.minutesShort', { minutes: s.minutes })}`
                  : ''}
              </span>
              <Button
                className="min-h-11"
                size="sm"
                variant="ghost"
                loading={pending}
                onClick={() => {
                  run(() => removeExtraStop(tripId, s.id));
                }}
              >
                {t('addStop.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-3 rounded-(--radius-md) bg-[color:var(--color-ground-sunk)] p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!choice) return;
          const place =
            choice.source === 'google'
              ? {
                  googlePlaceId: choice.place.googlePlaceId,
                  name: choice.place.name,
                  country: choice.place.country,
                  lat: choice.place.lat,
                  lon: choice.place.lon,
                }
              : choice.place.catalogId
                ? { catalogId: choice.place.catalogId }
                : {
                    name: choice.place.name,
                    country: choice.place.country,
                    lat: choice.place.lat,
                    lon: choice.place.lon,
                    timeZone: choice.place.timeZone ?? 'UTC',
                    kind: 'poi' as const,
                  };
          run(
            () => addExtraStop({ tripId, date, place, minutes: Number(minutes) }),
            () => {
              setChoice(null);
              setQuery('');
              onPickedUsed();
            },
          );
        }}
      >
        <Field label={t('addStop.search')} hint={apiKey ? t('addStop.hintMap') : t('addStop.hint')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              autoComplete="off"
              className="min-h-11"
              value={query}
              onChange={(e) => {
                const q = e.target.value;
                setQuery(q);
                setChoice(null);
                if (timer.current) window.clearTimeout(timer.current);
                if (q.trim().length < 2) {
                  setResults(null);
                  return;
                }
                timer.current = window.setTimeout(() => {
                  setSearching(true);
                  void search(q).then((r) => {
                    setResults(r);
                    setSearching(false);
                  });
                }, 300);
              }}
            />
          )}
        </Field>
        {searching && (
          <p className="text-sm text-[color:var(--color-ink-secondary)]">
            {t('setup.anchors.searching')}
          </p>
        )}
        {results && !choice && (
          <ul className="flex flex-col rounded-(--radius-md) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)]">
            {results.length === 0 && (
              <li className="p-3 text-sm text-[color:var(--color-ink-secondary)]">
                {t('setup.anchors.noResults')}
              </li>
            )}
            {results.map((r, i) => (
              <li key={String(i)}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center px-3 text-left text-sm hover:bg-[color:var(--color-ground-sunk)]"
                  onClick={() => {
                    setChoice(r);
                    setQuery(r.place.name);
                    setResults(null);
                  }}
                >
                  {label(r)}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-4">
          <Field label={t('addStop.minutes')}>
            {({ id }) => (
              <Select
                id={id}
                className="min-h-11"
                value={minutes}
                onChange={(e) => {
                  setMinutes(e.target.value);
                }}
              >
                {MINUTES.map((m) => (
                  <option key={m} value={String(m)}>
                    {t('addStop.minutesShort', { minutes: m })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit" className="min-h-11" loading={pending} disabled={!choice}>
            {choice
              ? t('addStop.add', { place: choice.place.name, day: dayLabel })
              : t('addStop.addEmpty')}
          </Button>
        </div>
        {error && <p className="text-sm text-[color:var(--color-negative)]">{te(error)}</p>}
      </form>
    </section>
  );
}
