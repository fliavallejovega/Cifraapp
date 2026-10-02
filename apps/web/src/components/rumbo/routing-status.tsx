'use client';

import { Button } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { useRouter } from '@/i18n/navigation';
import { retryRumboRouting } from '@/server/rumbo-actions';

import { useTripAction } from '../trips/use-trip-action';

/**
 * While the router works in the background, the page refreshes itself a few
 * times and the days fill in. A failure says how many stretches and offers
 * the retry; with no router configured, it says so plainly.
 */
export function RoutingStatus({
  tripId,
  routing,
}: {
  readonly tripId: string;
  readonly routing: {
    readonly configured: boolean;
    readonly pending: number;
    readonly failed: number;
  };
}) {
  const t = useTranslations('rumbo.routing');
  const router = useRouter();
  const { run, pending } = useTripAction();
  const waiting = routing.pending > 0 && routing.configured;

  useEffect(() => {
    if (!waiting) return;
    let rounds = 0;
    const timer = window.setInterval(() => {
      rounds += 1;
      router.refresh();
      if (rounds >= 12) window.clearInterval(timer);
    }, 8000);
    return () => {
      window.clearInterval(timer);
    };
  }, [waiting, router]);

  if (routing.pending === 0 && routing.failed === 0) return null;

  return (
    <div
      className="flex flex-col gap-3 rounded-(--radius-md) bg-[color:var(--color-ground-sunk)] p-4"
      role="status"
    >
      {!routing.configured ? (
        <p className="text-sm">{t('notConfigured')}</p>
      ) : routing.pending > 0 ? (
        <p className="text-sm">{t('pending', { count: routing.pending })}</p>
      ) : null}
      {routing.failed > 0 && (
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-sm">{t('failed', { count: routing.failed })}</p>
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() => {
              run(() => retryRumboRouting(tripId));
            }}
          >
            {t('retry')}
          </Button>
        </div>
      )}
      {waiting && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              router.refresh();
            }}
          >
            {t('refresh')}
          </Button>
        </div>
      )}
    </div>
  );
}
