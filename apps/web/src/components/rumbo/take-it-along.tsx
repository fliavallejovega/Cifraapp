'use client';

import { Button, Card } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { createTripShare, revokeTripShare } from '@/server/rumbo-actions';

import { useTripAction } from '../trips/use-trip-action';

/**
 * The trip outside the app: the file, the calendar, and a read-only link for
 * the other travellers. The link's secret is shown once, right after it is
 * made; only its first characters are kept to recognise it later.
 */
export function TakeItAlong({
  tripId,
  locale,
  shares,
  origin,
}: {
  readonly tripId: string;
  readonly locale: string;
  readonly shares: readonly { id: string; hint: string; createdAt: string }[];
  readonly origin: string;
}) {
  const t = useTranslations('rumbo.export');
  const { run, pending } = useTripAction();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <Card padding="lg">
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">{t('title')}</h2>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <a href={`/api/trips/${tripId}/route/html?locale=${locale}`} className={LINK}>
              {t('html')}
            </a>
            <a href={`/api/trips/${tripId}/route/ics?locale=${locale}`} className={LINK}>
              {t('ics')}
            </a>
          </div>
        </section>

        <section className="flex flex-col gap-3 border-t border-[color:var(--color-rule)] pt-6">
          <h3 className="font-medium">{t('share.title')}</h3>
          <p className="max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {t('share.detail')}
          </p>
          {link && (
            <div className="flex flex-col gap-2 rounded-(--radius-md) bg-[color:var(--color-ground-sunk)] p-4">
              <p className="text-sm">{t('share.once')}</p>
              <p className="text-sm break-all tabular-nums select-all">{link}</p>
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(link).then(() => {
                      setCopied(true);
                    });
                  }}
                >
                  {copied ? t('share.copied') : t('share.copy')}
                </Button>
              </div>
            </div>
          )}
          {shares.length === 0 ? (
            <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('share.none')}</p>
          ) : (
            <ul className="flex flex-col">
              {shares.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--color-rule)] py-2 first:border-t-0"
                >
                  <span className="text-sm">
                    {t('share.active', { hint: s.hint, date: s.createdAt })}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={pending}
                    onClick={() => {
                      run(() => revokeTripShare(tripId, s.id));
                    }}
                  >
                    {t('share.revoke')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button
              variant="secondary"
              loading={pending}
              onClick={() => {
                setCopied(false);
                run(
                  () => createTripShare(tripId),
                  (result) => {
                    if (result.secret) setLink(`${origin}/${locale}/v/${result.secret}`);
                  },
                );
              }}
            >
              {t('share.create')}
            </Button>
          </div>
        </section>
      </div>
    </Card>
  );
}

const LINK =
  'inline-flex min-h-11 items-center text-sm font-medium underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-ink)]';
