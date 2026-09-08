'use client';

import { Button, Field, Input, Problem, Select, Status } from '@app/ui';
import { useActionState, useState } from 'react';

import type { RecordActionResult } from '@/components/records/spec';
import { saveInvestmentProfile } from '@/server/investment-actions';

export interface InvestmentProfileLabels {
  readonly risk: string;
  readonly riskHint: string;
  readonly capacity: string;
  readonly capacityHint: string;
  readonly interests: string;
  readonly interestsHint: string;
  readonly emergency: string;
  readonly emergencyHint: string;
  readonly band: string;
  readonly bandHint: string;
  readonly low: string;
  readonly expected: string;
  readonly high: string;
  readonly submit: string;
  readonly saved: string;
  readonly usingDefault: string;
  readonly usingOwn: string;
  readonly errorTitle: string;
  readonly errors: Readonly<Record<string, string>>;
}

/**
 * What the household says about itself.
 *
 * Two things here are unusual and both are deliberate. Capacity is asked
 * separately from what the plan says is available, because what is left over
 * and what somebody is willing to lock away for five years are different
 * numbers and only they know the second. And the assumption band is editable,
 * because a rate the product refuses to let anybody argue with is being passed
 * off as knowledge rather than as an assumption.
 */
export function InvestmentProfileForm({
  locale,
  currencySymbol,
  values,
  levels,
  usingDefault,
  labels,
}: {
  readonly locale: string;
  readonly currencySymbol: string;
  readonly values: Readonly<Record<string, string>>;
  readonly levels: readonly {
    readonly value: string;
    readonly label: string;
    readonly detail: string;
  }[];
  readonly usingDefault: boolean;
  readonly labels: InvestmentProfileLabels;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    saveInvestmentProfile,
    {},
  );

  const [level, setLevel] = useState(values['riskLevel'] ?? 'balanced');
  const chosen = levels.find((entry) => entry.value === level);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="locale" value={locale} />

      {state.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label={labels.risk} hint={labels.riskHint}>
          {({ id, describedBy }) => (
            <Select
              id={id}
              name="riskLevel"
              value={level}
              aria-describedby={describedBy}
              onChange={(event) => {
                setLevel(event.target.value);
              }}
            >
              {levels.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={labels.capacity} hint={labels.capacityHint}>
          {({ id, describedBy }) => (
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[color:var(--color-ink-tertiary)]"
              >
                {currencySymbol}
              </span>
              <Input
                id={id}
                name="monthlyCapacity"
                numeric
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={values['monthlyCapacity'] ?? ''}
                aria-describedby={describedBy}
                className="pl-8"
              />
            </div>
          )}
        </Field>
      </div>

      {/* What the chosen level actually is, in a sentence, next to the choice. */}
      {chosen && (
        <p className="max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {chosen.detail}
        </p>
      )}

      <Field label={labels.interests} hint={labels.interestsHint}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="interests"
            maxLength={400}
            defaultValue={values['interests'] ?? ''}
            aria-describedby={describedBy}
          />
        )}
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-[color:var(--color-ink)]">
          {labels.emergency}
        </legend>
        <label className="flex items-start gap-2.5 text-sm text-[color:var(--color-ink-secondary)]">
          <input
            type="checkbox"
            name="hasEmergencyFund"
            value="true"
            defaultChecked={values['hasEmergencyFund'] === 'true'}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--color-brand)]"
          />
          <span>{labels.emergencyHint}</span>
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-[color:var(--color-ink)]">{labels.band}</legend>
        <p className="max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {labels.bandHint}
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          {(
            [
              ['assumedLow', labels.low],
              ['assumedExpected', labels.expected],
              ['assumedHigh', labels.high],
            ] as const
          ).map(([name, label]) => (
            <Field key={name} label={label}>
              {({ id }) => (
                <div className="relative">
                  <Input
                    id={id}
                    name={name}
                    numeric
                    inputMode="decimal"
                    placeholder="—"
                    defaultValue={values[name] ?? ''}
                    className="pr-9"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-[color:var(--color-ink-tertiary)]"
                  >
                    %
                  </span>
                </div>
              )}
            </Field>
          ))}
        </div>

        <Status tone="neutral">{usingDefault ? labels.usingDefault : labels.usingOwn}</Status>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" loading={pending}>
          {labels.submit}
        </Button>
        {state.ok && <Status tone="positive">{labels.saved}</Status>}
      </div>
    </form>
  );
}
