'use client';

import { Button, Card, Status } from '@app/ui';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { Link, useRouter } from '@/i18n/navigation';
import { confirmCaptureContinuity } from '@/server/import-actions';

import { Captures } from './repeat-questions';

/**
 * «Something may be missing between these two captures.»
 *
 * Shown with the end of one capture and the start of the next, side by side,
 * so the seam is checked right here: if a movement is cut in both, upload a
 * capture of that stretch; if nothing is missing, say so and it is not asked
 * again.
 */

export interface GapItem {
  readonly key: string;
  readonly accountId: string;
  readonly account: string;
  readonly from: string;
  readonly to: string;
  readonly olderImportId: string;
  readonly evidence: 'cut_line' | 'days_apart' | 'no_overlap';
  readonly cutText: string | null;
  readonly newer: {
    readonly documentId: string;
    readonly fileName: string;
    readonly isImage: boolean;
  };
  readonly older: {
    readonly documentId: string;
    readonly fileName: string;
    readonly isImage: boolean;
  };
}

export function CaptureGaps({
  gaps,
  locale,
}: {
  readonly gaps: readonly GapItem[];
  readonly locale: string;
}) {
  const t = useTranslations('captureGaps');
  const [showMinor, setShowMinor] = useState(false);
  // Doubts with evidence are asked; seams that only fail to overlap are kept
  // behind a tap — they are worth a look, not an interruption.
  const likely = gaps.filter((gap) => gap.evidence !== 'no_overlap');
  const minor = gaps.filter((gap) => gap.evidence === 'no_overlap');
  if (gaps.length === 0) return null;
  return (
    <Card tone="sunk">
      {likely.length > 0 ? (
        <>
          <h2 className="text-base font-medium text-balance">
            {t('title', { count: likely.length })}
          </h2>
          <p className="mt-1 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {t('detail')}
          </p>
          <ul className="mt-4 flex list-none flex-col gap-4 p-0">
            {likely.map((gap) => (
              <Gap key={gap.key} gap={gap} locale={locale} />
            ))}
          </ul>
        </>
      ) : (
        <h2 className="text-base font-medium text-balance">{t('minorTitle')}</h2>
      )}
      {minor.length > 0 && (
        <div
          className={
            likely.length > 0 ? 'mt-4 border-t border-[color:var(--color-rule)] pt-4' : 'mt-1'
          }
        >
          <p className="max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {t('minorDetail', { count: minor.length })}
          </p>
          <button
            type="button"
            aria-expanded={showMinor}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
            onClick={() => {
              setShowMinor((value) => !value);
            }}
          >
            {showMinor ? t('minorHide') : t('minorShow')}
          </button>
          {showMinor && (
            <ul className="mt-2 flex list-none flex-col gap-4 p-0">
              {minor.map((gap) => (
                <Gap key={gap.key} gap={gap} locale={locale} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function Gap({ gap, locale }: { readonly gap: GapItem; readonly locale: string }) {
  const t = useTranslations('captureGaps');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <li className="flex flex-col gap-3 border-t border-[color:var(--color-rule)] pt-4">
      <p className="text-sm font-medium [overflow-wrap:anywhere]">{gap.account}</p>
      <p className="max-w-[68ch] text-sm text-pretty">
        {t(`why.${gap.evidence}`, { from: gap.from, to: gap.to })}
      </p>
      {gap.cutText && (
        <p className="text-xs [overflow-wrap:anywhere] text-[color:var(--color-ink-secondary)]">
          {t('cut', { text: gap.cutText })}
        </p>
      )}
      <Captures
        files={[
          { ...gap.newer, top: 0.86 },
          { ...gap.older, top: 0.2 },
        ]}
        lookFor={t('lookFor')}
      />
      {done ? (
        <Status tone="positive">{t('confirmed')}</Status>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href={`/documents?account=${gap.accountId}#subir`}
            className="inline-flex min-h-11 items-center rounded-(--radius-sm) bg-[color:var(--color-ink)] px-4 text-sm font-medium text-[color:var(--color-ground)]"
          >
            {t('upload')}
          </Link>
          <Button
            size="md"
            variant="secondary"
            className="min-h-11"
            loading={pending}
            onClick={() => {
              setFailed(false);
              start(async () => {
                const result = await confirmCaptureContinuity({
                  importId: gap.olderImportId,
                  locale,
                });
                if (result.ok) {
                  setDone(true);
                  router.refresh();
                } else {
                  setFailed(true);
                }
              });
            }}
          >
            {t('nothingMissing')}
          </Button>
        </div>
      )}
      {failed && <Status tone="negative">{t('failed')}</Status>}
    </li>
  );
}
