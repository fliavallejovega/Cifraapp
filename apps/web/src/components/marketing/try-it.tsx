'use client';

import { Money, formatMoney, type CurrencyCode, type MoneyLocale } from '@app/domain';
import { Amount, Button, Card, Field, Gauge, Input, Status } from '@app/ui';
import { useMemo, useState } from 'react';

import { Link } from '@/i18n/navigation';

/**
 * The product, before the account.
 *
 * Five figures a person already knows by heart and one answer they usually do
 * not: what is actually left once the month's claims and the buffer are taken
 * out. It runs the same arithmetic the product runs, in the browser, on
 * nothing but what was typed — no request leaves the page, nothing is stored
 * until the person chooses to keep it.
 *
 * The fields open prefilled with the demonstration household rather than
 * empty. An empty calculator asks for work before it gives anything back; a
 * filled one gives the answer first and invites a correction, which is the
 * order a person will actually engage in.
 *
 * Keeping the figures is the sign-up. They go to local storage under a key the
 * setup questionnaire reads on its first render, so the person who typed their
 * rent here does not type it again three screens later.
 */

export const LANDING_DRAFT_KEY = 'cifrapp-draft';

export interface LandingDraft {
  readonly balance: string;
  readonly rent: string;
  readonly minimums: string;
  readonly other: string;
  readonly buffer: string;
}

export interface TryItLabels {
  readonly balance: string;
  readonly rent: string;
  readonly minimums: string;
  readonly other: string;
  readonly otherHint: string;
  readonly buffer: string;
  readonly gaugeLabel: string;
  readonly bufferMark: string;
  readonly surfaceMark: string;
  readonly available: string;
  /** `{balance}`, `{committed}`, `{buffer}` are replaced with formatted money. */
  readonly availableDetail: string;
  /** `{amount}` is replaced with formatted money. */
  readonly short: string;
  readonly shortDetail: string;
  readonly orderTitle: string;
  readonly covered: string;
  /** `{amount}` is replaced with formatted money. */
  readonly partial: string;
  readonly pending: string;
  readonly free: string;
  readonly cta: string;
  readonly ctaHint: string;
}

const CURRENCY: CurrencyCode = 'USD';

/** Whatever a person types, as money, or zero. A calculator does not throw. */
function parse(value: string): Money {
  const cleaned = value.replace(/[^\d.]/g, '');
  const [whole = '', fraction = ''] = cleaned.split('.');
  const normalized = `${whole || '0'}.${fraction.slice(0, 2).padEnd(2, '0')}`;
  try {
    return Money.fromDecimalString(normalized, CURRENCY);
  } catch {
    return Money.zero(CURRENCY);
  }
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

export function TryIt({
  locale,
  labels,
  defaults,
}: {
  readonly locale: MoneyLocale;
  readonly labels: TryItLabels;
  readonly defaults: LandingDraft;
}) {
  const [draft, setDraft] = useState<LandingDraft>(defaults);
  const update = (key: keyof LandingDraft) => (value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const figures = useMemo(() => {
    const balance = parse(draft.balance);
    const claims = [
      { key: 'rent' as const, amount: parse(draft.rent) },
      { key: 'minimums' as const, amount: parse(draft.minimums) },
      { key: 'other' as const, amount: parse(draft.other) },
      { key: 'buffer' as const, amount: parse(draft.buffer) },
    ];
    const committed = Money.sum(
      claims.slice(0, 3).map((claim) => claim.amount),
      CURRENCY,
    );
    const buffer = claims[3]?.amount ?? Money.zero(CURRENCY);
    const available = balance.subtract(committed).subtract(buffer);

    // Walk the claims in the order the product would pay them, and say for
    // each whether the balance reaches it. This is the allocation engine's
    // question asked of five numbers.
    let remaining = balance;
    const order = claims.map((claim) => {
      let state: 'covered' | 'partial' | 'pending';
      let reached = claim.amount;
      if (claim.amount.isZero() || remaining.greaterThanOrEqual(claim.amount)) {
        state = 'covered';
      } else if (remaining.isPositive()) {
        state = 'partial';
        reached = remaining;
      } else {
        state = 'pending';
        reached = Money.zero(CURRENCY);
      }
      remaining = remaining.subtract(claim.amount);
      if (remaining.isNegative()) remaining = Money.zero(CURRENCY);
      return { ...claim, state, reached };
    });

    return { balance, committed, buffer, available, order, free: remaining };
  }, [draft]);

  const money = (value: Money) => formatMoney(value, { locale });
  const isShort = figures.available.isNegative();
  const surface = figures.balance.subtract(figures.committed);

  const keep = () => {
    try {
      window.localStorage.setItem(LANDING_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Private mode, or storage blocked. The sign-up still works; the
      // questionnaire simply opens empty.
    }
  };

  const fields: readonly { key: keyof LandingDraft; label: string; hint?: string }[] = [
    { key: 'balance', label: labels.balance },
    { key: 'rent', label: labels.rent },
    { key: 'minimums', label: labels.minimums },
    { key: 'other', label: labels.other, hint: labels.otherHint },
    { key: 'buffer', label: labels.buffer },
  ];

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-12">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
        {fields.map((field) => (
          <Field key={field.key} label={field.label} {...(field.hint ? { hint: field.hint } : {})}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                numeric
                inputMode="decimal"
                autoComplete="off"
                value={draft[field.key]}
                onChange={(event) => {
                  update(field.key)(event.target.value);
                }}
              />
            )}
          </Field>
        ))}
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <Card tone="panel" padding="lg">
          <p className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-panel-ink-secondary)] uppercase">
            {isShort
              ? fill(labels.short, { amount: money(figures.available.abs()) })
              : labels.available}
          </p>
          <div className="mt-3" aria-live="polite">
            <Amount value={figures.available} locale={locale} tone="plain" size="readout" />
          </div>
          <p className="mt-3 text-sm text-[color:var(--color-panel-ink-secondary)]">
            {isShort
              ? labels.shortDetail
              : fill(labels.availableDetail, {
                  balance: money(figures.balance),
                  committed: money(figures.committed),
                  buffer: money(figures.buffer),
                })}
          </p>

          {figures.balance.isPositive() && (
            <div className="mt-6">
              <Gauge
                value={isShort ? Money.zero(CURRENCY) : figures.available}
                max={figures.balance}
                label={labels.gaugeLabel}
                locale={locale}
                tone={isShort ? 'negative' : 'neutral'}
                thresholds={[
                  ...(figures.buffer.isPositive()
                    ? [{ at: figures.buffer, label: labels.bufferMark, kind: 'buffer' as const }]
                    : []),
                  ...(surface.isPositive() && surface.lessThan(figures.balance)
                    ? [{ at: surface, label: labels.surfaceMark, kind: 'committed' as const }]
                    : []),
                ]}
              />
            </div>
          )}
        </Card>

        <Card padding="none" className="overflow-hidden">
          <p className="px-6 pt-5 text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
            {labels.orderTitle}
          </p>
          <ol className="mt-3 divide-y divide-[color:var(--color-rule)]">
            {figures.order.map((row, index) => (
              <li
                key={row.key}
                className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-6 py-3 sm:grid-cols-[1rem_minmax(0,1fr)_auto_8rem]"
              >
                <span className="gradation-label">{index + 1}</span>
                <span className="min-w-0 truncate text-sm">{labels[row.key]}</span>
                <Amount value={row.amount} locale={locale} size="sm" tone="plain" />
                <span className="col-span-full pl-8 sm:col-span-1 sm:pl-0 sm:text-right">
                  <Status
                    tone={
                      row.state === 'covered'
                        ? 'positive'
                        : row.state === 'partial'
                          ? 'caution'
                          : 'negative'
                    }
                  >
                    {row.state === 'covered'
                      ? labels.covered
                      : row.state === 'partial'
                        ? fill(labels.partial, { amount: money(row.reached) })
                        : labels.pending}
                  </Status>
                </span>
              </li>
            ))}
            <li className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-4 px-6 py-3 sm:grid-cols-[1rem_minmax(0,1fr)_auto_8rem]">
              <span className="gradation-label">{figures.order.length + 1}</span>
              <span className="min-w-0 truncate text-sm font-medium">{labels.free}</span>
              <Amount value={figures.free} locale={locale} size="sm" tone="plain" />
            </li>
          </ol>
        </Card>

        <div>
          <Link href="/sign-up" onClick={keep}>
            <Button size="lg">{labels.cta}</Button>
          </Link>
          <p className="mt-3 max-w-[52ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
            {labels.ctaHint}
          </p>
        </div>
      </div>
    </div>
  );
}
