'use client';

import { Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition, type DragEvent } from 'react';

import { useRouter } from '@/i18n/navigation';
import { shrinkImage } from '@/lib/shrink-image';
import type { TripGap } from '@/lib/trip-gaps';
import { uploadTripDocuments } from '@/server/trip-document-actions';

/**
 * The trip's upload zones: one per kind of document.
 *
 * The family says what they are uploading by where they put it — flights,
 * lodging, tickets, ground transport, or «other» for the reader to sort out.
 * That tells the reader where to look; it never decides what the document is.
 * On a phone each zone is a tap that opens camera, photos and files; on a
 * computer it also takes a dropped file.
 */

type Zone = 'flight' | 'lodging' | 'ticket' | 'transport' | 'other';

const ZONES: readonly Zone[] = ['flight', 'lodging', 'ticket', 'transport', 'other'];

/** Under the platform's 4 MB request cap, with room for the form around it. */
const MAX_BYTES = 3_900_000;

export function TripUploadZones({
  tripId,
  locale,
  gaps,
}: {
  readonly tripId: string;
  readonly locale: string;
  /** Nights still without a city or lodging, recomputed on every refresh. */
  readonly gaps: readonly TripGap[];
}) {
  const t = useTranslations('trips.documents');
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const zone = useRef<Zone>('other');
  const [over, setOver] = useState<Zone | null>(null);
  const [busy, setBusy] = useState<Zone | null>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: 'positive' | 'negative'; text: string } | null>(
    null,
  );

  const send = (list: FileList | null, kind: Zone) => {
    if (!list || list.length === 0) return;
    setMessage(null);
    setBusy(kind);
    start(async () => {
      let done = 0;
      let lastError: string | null = null;
      // One file per request: the platform caps a request at a few megabytes.
      for (const file of Array.from(list).slice(0, 10)) {
        const ready = await shrinkImage(file);
        if (ready.size > MAX_BYTES) {
          lastError = 'tooLarge';
          continue;
        }
        const form = new FormData();
        form.set('tripId', tripId);
        form.set('locale', locale);
        if (kind !== 'other') form.set('hint', kind);
        form.append('files', ready);
        const result = await uploadTripDocuments(form);
        if (result.error) lastError = result.error;
        else done += 1;
      }
      setBusy(null);
      if (done === 0) {
        const key = lastError ?? 'uploadFailed';
        setMessage({
          tone: 'negative',
          text: t.has(`errors.${key}`) ? t(`errors.${key}`) : t('errors.uploadFailed'),
        });
        return;
      }
      setMessage({ tone: 'positive', text: t('uploaded', { count: done }) });
      router.refresh();
    });
  };

  const drop = (event: DragEvent<HTMLElement>, kind: Zone) => {
    event.preventDefault();
    setOver(null);
    send(event.dataTransfer.files, kind);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-medium">{t('zones.title')}</h3>
        <p className="max-w-[68ch] text-sm text-[color:var(--color-ink-secondary)]">
          {t('zones.detail')}
        </p>
      </div>

      <ul className="grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2 p-0">
        {ZONES.map((kind) => (
          <li key={kind} className="min-w-0">
            <button
              type="button"
              disabled={pending}
              aria-label={t('zones.uploadLabel', { kind: t(`zones.${kind}`) })}
              onClick={() => {
                zone.current = kind;
                picker.current?.click();
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(kind);
              }}
              onDragLeave={() => {
                setOver(null);
              }}
              onDrop={(event) => {
                drop(event, kind);
              }}
              className={`flex h-full min-h-16 w-full flex-col items-start justify-center gap-1 rounded-(--radius-md) border px-4 py-3 text-left transition-colors duration-(--duration-quick) disabled:opacity-60 ${
                over === kind
                  ? 'border-[color:var(--color-brand)] bg-[color:var(--color-brand-sunk)]'
                  : 'border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] hover:bg-[color:var(--color-ground-sunk)]'
              }`}
            >
              <span className="text-sm font-medium [overflow-wrap:anywhere]">
                {over === kind ? t('zones.drop', { kind: t(`zones.${kind}`) }) : t(`zones.${kind}`)}
              </span>
              <span className="text-xs [overflow-wrap:anywhere] text-[color:var(--color-ink-secondary)]">
                {busy === kind ? t('status.processing') : t(`zones.${kind}Hint`)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <input
        ref={picker}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          send(event.target.files, zone.current);
          event.target.value = '';
        }}
      />
      {message && <Status tone={message.tone}>{message.text}</Status>}

      <div className="flex flex-col gap-2 border-t border-[color:var(--color-rule)] pt-3">
        <h3 className="text-sm font-medium">{t('zones.gapsTitle')}</h3>
        {gaps.length === 0 ? (
          <Status tone="positive">{t('zones.gapsNone')}</Status>
        ) : (
          <ul className="flex list-none flex-col gap-1 p-0">
            {gaps.map((gap) => (
              <li key={`${gap.kind}-${gap.from}`} className="text-sm [overflow-wrap:anywhere]">
                <Status tone="caution">{gapText(t, gap, locale)}</Status>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function shortDate(date: string, locale: string): string {
  const [y = '', m = '', d = ''] = date.split('-');
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PA', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))));
}

function gapText(
  t: ReturnType<typeof useTranslations<'trips.documents'>>,
  gap: TripGap,
  locale: string,
): string {
  const from = shortDate(gap.from, locale);
  const to = shortDate(gap.to, locale);
  const single = gap.from === gap.to;
  if (gap.kind === 'no_city') {
    return single ? t('zones.gapNoCityOne', { date: from }) : t('zones.gapNoCity', { from, to });
  }
  return single
    ? t('zones.gapNoLodgingOne', { city: gap.city, date: from })
    : t('zones.gapNoLodging', { city: gap.city, from, to });
}
