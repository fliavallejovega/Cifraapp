'use client';

import { Button, Problem, Select, Status } from '@app/ui';
import { useActionState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { savePreferences } from '@/server/notification-actions';

/**
 * Choosing what to be told.
 *
 * One form and one save, because that is how it is read: a person scans the
 * list, changes two rows, and presses save. Committing each dropdown separately
 * would be six writes for one decision, and six chances for half of it to land.
 *
 * «Do not tell me» is a channel rather than a separate switch. Two controls for
 * one decision is how a settings screen starts to disagree with itself.
 */
export function NotificationPreferences({
  locale,
  preferences,
  channels,
  frequencies,
  labels,
}: {
  readonly locale: string;
  readonly preferences: readonly {
    readonly kind: string;
    readonly title: string;
    readonly detail: string;
    readonly channel: string;
    readonly throttleHours: number;
    readonly isDefault: boolean;
  }[];
  readonly channels: readonly { readonly value: string; readonly label: string }[];
  readonly frequencies: readonly { readonly value: string; readonly label: string }[];
  readonly labels: {
    readonly channel: string;
    readonly frequency: string;
    readonly submit: string;
    readonly saved: string;
    readonly isDefault: string;
    readonly errorTitle: string;
    readonly generic: string;
  };
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    savePreferences,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="locale" value={locale} />

      {state.error && <Problem title={labels.errorTitle} body={labels.generic} />}

      <ul className="flex flex-col">
        {preferences.map((preference) => (
          <li
            key={preference.kind}
            className="flex flex-col gap-3 border-b border-[color:var(--color-rule)] py-5 last:border-b-0 lg:flex-row lg:items-center lg:justify-between lg:gap-6"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-[color:var(--color-ink)]">
                  {preference.title}
                </span>
                {preference.isDefault && <Status tone="neutral">{labels.isDefault}</Status>}
              </p>
              <p className="mt-1 text-sm text-[color:var(--color-ink-secondary)]">
                {preference.detail}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-xs text-[color:var(--color-ink-tertiary)]">
                {labels.channel}
                <Select name={`channel:${preference.kind}`} defaultValue={preference.channel}>
                  {channels.map((channel) => (
                    <option key={channel.value} value={channel.value}>
                      {channel.label}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-[color:var(--color-ink-tertiary)]">
                {labels.frequency}
                <Select
                  name={`throttle:${preference.kind}`}
                  defaultValue={String(preference.throttleHours)}
                >
                  {frequencies.map((frequency) => (
                    <option key={frequency.value} value={frequency.value}>
                      {frequency.label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" loading={pending}>
          {labels.submit}
        </Button>
        {state.ok && <Status tone="positive">{labels.saved}</Status>}
      </div>
    </form>
  );
}
