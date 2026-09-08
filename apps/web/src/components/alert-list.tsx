'use client';

import { Button, Card, Problem, Status } from '@app/ui';
import { useActionState } from 'react';

import { Link } from '@/i18n/navigation';
import type { RecordActionResult } from '@/components/records/spec';
import { dismissAlert } from '@/server/alert-actions';

/**
 * The alerts, each with the two things a person can do about one: go and look,
 * or say they already know.
 *
 * Severity is a colour and a word, never a colour alone. A household reading
 * this on a phone in the sun, or with any colour-vision difference, gets the
 * same information as everybody else.
 */

export interface AlertRow {
  readonly key: string;
  readonly severity: 'critical' | 'warning' | 'notice';
  readonly message: string;
  readonly severityLabel: string;
  readonly href: string;
}

const TONES = {
  critical: 'negative',
  warning: 'caution',
  notice: 'neutral',
} as const;

export function AlertList({
  locale,
  alerts,
  labels,
}: {
  readonly locale: string;
  readonly alerts: readonly AlertRow[];
  readonly labels: {
    readonly dismiss: string;
    readonly go: string;
    readonly errorTitle: string;
    readonly generic: string;
  };
}) {
  return (
    <ul className="flex flex-col gap-4">
      {alerts.map((alert) => (
        <li key={alert.key}>
          <AlertItem locale={locale} alert={alert} labels={labels} />
        </li>
      ))}
    </ul>
  );
}

function AlertItem({
  locale,
  alert,
  labels,
}: {
  readonly locale: string;
  readonly alert: AlertRow;
  readonly labels: {
    readonly dismiss: string;
    readonly go: string;
    readonly errorTitle: string;
    readonly generic: string;
  };
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    dismissAlert,
    {},
  );

  return (
    <Card tone={state.ok ? 'sunk' : 'surface'}>
      <div className="flex flex-col gap-3">
        <Status tone={TONES[alert.severity]}>{alert.severityLabel}</Status>

        <p className="max-w-[62ch] text-pretty text-[color:var(--color-ink)]">{alert.message}</p>

        {state.error && <Problem title={labels.errorTitle} body={labels.generic} />}

        <div className="flex flex-wrap items-center gap-4">
          <Link
            href={alert.href}
            className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
          >
            {labels.go}
          </Link>
          <form action={formAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={alert.key} />
            <Button type="submit" size="sm" variant="ghost" loading={pending} disabled={state.ok}>
              {labels.dismiss}
            </Button>
          </form>
        </div>
      </div>
    </Card>
  );
}
