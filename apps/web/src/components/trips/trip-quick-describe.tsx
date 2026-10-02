'use client';

import { Button, Card, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import type { QuickTrip } from '@/server/trip-quick';
import { readTripText } from '@/server/trip-quick-actions';

/**
 * «Describe the trip in a sentence»: the fastest way into the wizard. What
 * comes back fills the first answers and stays editable; what could not be
 * used is said, not silently dropped.
 */
export function TripQuickDescribe({ onApply }: { readonly onApply: (trip: QuickTrip) => void }) {
  const t = useTranslations('trips.wizard.quick');
  const id = useId();
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuickTrip | null>(null);

  // Not a form: it sits inside the wizard's form, and forms do not nest.
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <label htmlFor={id} className="font-medium">
          {t('label')}
        </label>
        <textarea
          id={id}
          rows={3}
          maxLength={600}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          placeholder={t('placeholder')}
          className="w-full resize-y rounded-(--radius-md) border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] px-3 py-2 text-base leading-relaxed"
        />
        <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('hint')}</p>
        {error && (
          <p role="alert" className="text-sm text-[color:var(--color-negative)]">
            {t(`error.${error === 'tooShort' || error === 'notConfigured' ? error : 'generic'}`)}
          </p>
        )}
        {result && !error && (
          <div className="flex flex-col gap-2" role="status">
            <Status tone="positive">
              {result.legs.length > 0
                ? t('filled', { count: result.legs.length })
                : t('filledNoPlaces')}
            </Status>
            {result.dropped.map((d) => (
              <Status key={d} tone="caution">
                {t(`dropped.${d}`)}
              </Status>
            ))}
          </div>
        )}
        <Button
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                const answer = await readTripText(text);
                if ('error' in answer) {
                  setError(answer.error);
                  return;
                }
                setResult(answer.trip);
                onApply(answer.trip);
              } catch {
                setError('network');
              }
            });
          }}
          variant="secondary"
          size="lg"
          loading={pending}
          disabled={text.trim().length < 4}
          className="self-start"
        >
          {t('submit')}
        </Button>
      </div>
    </Card>
  );
}
