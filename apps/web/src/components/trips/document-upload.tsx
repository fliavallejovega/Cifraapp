'use client';

import { Button, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';

import { Link, useRouter } from '@/i18n/navigation';
import { shrinkImage } from '@/lib/shrink-image';
import { formatAmount } from '@/lib/trip-format';
import { undoAutoAppliedTripDocument, uploadTripDocuments } from '@/server/trip-document-actions';

/**
 * Scanning or uploading travel documents: a photo from the camera, or several
 * files at once. Photos are shrunk on the device before they travel — a
 * twelve-megapixel receipt is three megabytes of paper texture — and every
 * file is read in the background while the person keeps going.
 */

export function DocumentUpload({
  tripId,
  locale,
  primary = false,
}: {
  readonly tripId: string | null;
  readonly locale: string;
  readonly primary?: boolean;
}) {
  const t = useTranslations('trips.documents');
  const router = useRouter();
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: 'positive' | 'negative'; text: string } | null>(
    null,
  );

  const send = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setMessage(null);
    start(async () => {
      let done = 0;
      let lastError: string | null = null;
      // One file per request: the platform caps a request at a few megabytes.
      for (const file of Array.from(list).slice(0, 10)) {
        const form = new FormData();
        if (tripId) form.set('tripId', tripId);
        form.set('locale', locale);
        const ready = await shrinkImage(file);
        if (ready.size > 4_000_000) {
          lastError = 'tooLarge';
          continue;
        }
        form.append('files', ready);
        const result = await uploadTripDocuments(form);
        if (result.error) lastError = result.error;
        else done += 1;
      }
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 @lg:flex-row">
        <Button
          size="lg"
          variant={primary ? 'primary' : 'secondary'}
          loading={pending}
          onClick={() => camera.current?.click()}
        >
          {t('scan')}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          disabled={pending}
          onClick={() => files.current?.click()}
        >
          {t('upload')}
        </Button>
      </div>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          send(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={files}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          send(e.target.files);
          e.target.value = '';
        }}
      />
      <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('hint')}</p>
      {message && <Status tone={message.tone}>{message.text}</Status>}
    </div>
  );
}

export interface DocumentRowView {
  readonly id: string;
  readonly fileName: string;
  readonly kind: string;
  readonly status: string | null;
  readonly failure: string | null;
  readonly summary: {
    provider: string | null;
    amount: string | null;
    currency: string | null;
    city?: string | null;
    checkIn?: string | null;
    checkOut?: string | null;
  } | null;
  /** Added to the trip by the reader on its own; it can be undone. */
  readonly autoApplied?: { readonly unplaced: readonly string[] } | null;
  /** Why it waits: what it clashes with. */
  readonly conflict?: {
    readonly reason: string;
    readonly from?: string;
    readonly to?: string;
    readonly plannedCity?: string;
    readonly incomingCity?: string;
  } | null;
}

/** The documents and their state. Refreshes itself while something is still being read. */
export function DocumentList({
  documents,
  locale,
}: {
  readonly documents: readonly DocumentRowView[];
  readonly locale: string;
}) {
  const t = useTranslations('trips.documents');
  const router = useRouter();
  const reading = documents.some((d) => d.status === 'pending' || d.status === 'processing');

  useEffect(() => {
    if (!reading) return;
    let rounds = 0;
    const timer = window.setInterval(() => {
      rounds += 1;
      router.refresh();
      if (rounds > 40) window.clearInterval(timer);
    }, 4000);
    return () => {
      window.clearInterval(timer);
    };
  }, [reading, router]);

  if (documents.length === 0)
    return <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('empty')}</p>;

  return (
    <ul className="flex flex-col divide-y divide-[color:var(--color-rule)]">
      {documents.map((d) => {
        const tone =
          d.status === 'needs_review'
            ? 'caution'
            : d.status === 'confirmed'
              ? 'positive'
              : d.status === 'failed'
                ? 'negative'
                : 'neutral';
        return (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate">
                {d.summary?.provider ?? d.fileName}
                {d.summary?.amount && d.summary.currency
                  ? ` · ${formatAmount(d.summary.amount, d.summary.currency, locale)}`
                  : ''}
              </p>
              <Status tone={tone} className="mt-1">
                {d.autoApplied ? t('applied.status') : t(`status.${d.status ?? 'pending'}`)}
                {d.kind !== 'other' && d.status !== 'pending' ? ` · ${t(`kind.${d.kind}`)}` : ''}
              </Status>
              {d.summary?.city && d.summary.checkIn && d.summary.checkOut && (
                <p className="mt-1 text-sm [overflow-wrap:anywhere] text-[color:var(--color-ink-secondary)]">
                  {t('applied.stay', {
                    city: d.summary.city,
                    from: shortDate(d.summary.checkIn, locale),
                    to: shortDate(d.summary.checkOut, locale),
                  })}
                </p>
              )}
              {d.conflict && (
                <p className="mt-1 max-w-[68ch] text-sm [overflow-wrap:anywhere] text-[color:var(--color-caution)]">
                  {conflictText(t, d.conflict, locale)}
                </p>
              )}
              {d.autoApplied && d.autoApplied.unplaced.length > 0 && (
                <p className="mt-1 text-sm [overflow-wrap:anywhere] text-[color:var(--color-ink-secondary)]">
                  {t('applied.unplaced', { cities: d.autoApplied.unplaced.join(', ') })}
                </p>
              )}
            </div>
            {d.autoApplied && (
              <UndoButton id={d.id} name={d.summary?.provider ?? d.fileName} locale={locale} />
            )}
            {(d.status === 'needs_review' || d.status === 'failed') && (
              <Link
                href={`/trips/documents/${d.id}`}
                className="inline-flex h-11 items-center rounded-(--radius-md) border border-[color:var(--color-rule)] px-4 text-sm font-medium hover:bg-[color:var(--color-ground-sunk)]"
              >
                {d.status === 'failed' ? t('open') : t('reviewAction')}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function shortDate(date: string, locale: string): string {
  const [y = '', m = '', day = ''] = date.split('-');
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PA', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(y), Number(m) - 1, Number(day))));
}

export function conflictText(
  t: ReturnType<typeof useTranslations<'trips.documents'>>,
  conflict: NonNullable<DocumentRowView['conflict']>,
  locale: string,
): string {
  const values = {
    from: conflict.from ? shortDate(conflict.from, locale) : '',
    to: conflict.to ? shortDate(conflict.to, locale) : '',
    planned: conflict.plannedCity ?? '',
    incoming: conflict.incomingCity ?? '',
  };
  switch (conflict.reason) {
    case 'conflict':
      return t('conflict.conflict', values);
    case 'already_planned':
      return t('conflict.already_planned', values);
    case 'outside_trip':
      return t('conflict.outside_trip');
    case 'no_rate':
      return t('conflict.no_rate');
    default:
      return '';
  }
}

function UndoButton({
  id,
  name,
  locale,
}: {
  readonly id: string;
  readonly name: string;
  readonly locale: string;
}) {
  const t = useTranslations('trips.documents');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        size="md"
        className="min-h-11"
        loading={pending}
        aria-label={t('applied.undoLabel', { name })}
        onClick={() => {
          setFailed(false);
          start(async () => {
            const result = await undoAutoAppliedTripDocument(id, locale === 'en' ? 'en' : 'es');
            if (result.error) setFailed(true);
            else router.refresh();
          });
        }}
      >
        {t('applied.undo')}
      </Button>
      {failed && <Status tone="negative">{t('applied.undoFailed')}</Status>}
    </div>
  );
}
