'use client';

import { Button, Card, Problem, Status } from '@app/ui';
import { useActionState, useState, useTransition } from 'react';

import { OtpInput } from './otp-input';
import {
  beginEnrollment,
  confirmEnrollment,
  disableTwoFactor,
  type EnrollmentStart,
  type MfaResult,
} from '@/server/mfa-actions';

/**
 * Two-step verification, as a setting.
 *
 * Three states and the screen looks different in each: off, with the one
 * action that matters; enrolling, with the code to scan and six boxes under
 * it; and on, with the date it was verified implied by the session and a way
 * back that also asks for a code. Every transition happens in place — no
 * page change between «activate» and «scan this».
 */

export interface TwoFactorLabels {
  readonly enabled: string;
  readonly disabled: string;
  readonly enabledDetail: string;
  readonly disabledDetail: string;
  readonly enable: string;
  readonly scanTitle: string;
  readonly scanDetail: string;
  readonly secretLabel: string;
  readonly code: string;
  readonly confirm: string;
  readonly confirmed: string;
  readonly cancel: string;
  readonly disable: string;
  readonly disableTitle: string;
  readonly disableDetail: string;
  readonly disabledDone: string;
  readonly errorTitle: string;
  readonly errors: Record<string, string>;
}

export function TwoFactorSettings({
  enabled: initiallyEnabled,
  labels,
}: {
  readonly enabled: boolean;
  readonly labels: TwoFactorLabels;
}) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [mode, setMode] = useState<'idle' | 'enrolling' | 'disabling'>('idle');
  const [start, setStart] = useState<EnrollmentStart | null>(null);
  const [starting, startTransition] = useTransition();
  const [startError, setStartError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [confirmState, confirmAction, confirming] = useActionState<MfaResult, FormData>(
    async (previous, formData) => {
      const result = await confirmEnrollment(previous, formData);
      if (result.done) {
        setEnabled(true);
        setMode('idle');
        setStart(null);
        setNotice(labels.confirmed);
      }
      return result;
    },
    {},
  );

  const [disableState, disableAction, disabling] = useActionState<MfaResult, FormData>(
    async (previous, formData) => {
      const result = await disableTwoFactor(previous, formData);
      if (result.done) {
        setEnabled(false);
        setMode('idle');
        setNotice(labels.disabledDone);
      }
      return result;
    },
    {},
  );

  const begin = () => {
    setNotice(null);
    setStartError(null);
    startTransition(async () => {
      const result = await beginEnrollment();
      if (result.error) {
        setStartError(labels.errors[result.error] ?? labels.errors['generic'] ?? '');
        return;
      }
      setStart(result);
      setMode('enrolling');
    });
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Status tone={enabled ? 'positive' : 'neutral'}>
            {enabled ? labels.enabled : labels.disabled}
          </Status>
          <p className="mt-3 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {enabled ? labels.enabledDetail : labels.disabledDetail}
          </p>
        </div>

        {mode === 'idle' && (
          <Button
            variant={enabled ? 'secondary' : 'primary'}
            loading={starting}
            onClick={() => {
              if (enabled) {
                setNotice(null);
                setMode('disabling');
              } else {
                begin();
              }
            }}
          >
            {enabled ? labels.disable : labels.enable}
          </Button>
        )}
      </div>

      {notice && (
        <p role="status" className="mt-4 text-sm text-[color:var(--color-positive)]">
          {notice}
        </p>
      )}
      {startError && <Problem className="mt-4" title={labels.errorTitle} body={startError} />}

      {mode === 'enrolling' && start && (
        <form action={confirmAction} className="mt-8 grid gap-6 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <input type="hidden" name="factorId" value={start.factorId} />

          {/* The QR is an SVG the auth server produced from the secret shown
              beside it; nothing here is drawn from anywhere else. */}
          <img
            src={start.qrCode}
            alt=""
            width={192}
            height={192}
            className="rounded-(--radius-md) border border-[color:var(--color-surface-border)] bg-white p-2"
          />

          <div className="min-w-0">
            <p className="font-medium">{labels.scanTitle}</p>
            <p className="mt-1 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              {labels.scanDetail}
            </p>
            <p className="mt-3 text-xs text-[color:var(--color-ink-tertiary)]">
              {labels.secretLabel}
            </p>
            <code className="readout mt-1 block text-sm break-all select-all">
              {start.secret.replace(/(.{4})/g, '$1 ').trim()}
            </code>

            {confirmState.error && (
              <Problem
                className="mt-4"
                title={labels.errorTitle}
                body={labels.errors[confirmState.error] ?? labels.errors['generic'] ?? ''}
              />
            )}

            <div className="mt-6">
              <OtpInput
                label={labels.code}
                disabled={confirming}
                invalid={Boolean(confirmState.error)}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="submit" loading={confirming} variant="secondary" size="sm">
                {labels.confirm}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMode('idle');
                  setStart(null);
                }}
              >
                {labels.cancel}
              </Button>
            </div>
          </div>
        </form>
      )}

      {mode === 'disabling' && (
        <form action={disableAction} className="mt-8 max-w-md">
          <p className="font-medium">{labels.disableTitle}</p>
          <p className="mt-1 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {labels.disableDetail}
          </p>

          {disableState.error && (
            <Problem
              className="mt-4"
              title={labels.errorTitle}
              body={labels.errors[disableState.error] ?? labels.errors['generic'] ?? ''}
            />
          )}

          <div className="mt-6">
            <OtpInput
              label={labels.code}
              disabled={disabling}
              invalid={Boolean(disableState.error)}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="submit" loading={disabling} variant="destructive" size="sm">
              {labels.disable}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setMode('idle');
              }}
            >
              {labels.cancel}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
