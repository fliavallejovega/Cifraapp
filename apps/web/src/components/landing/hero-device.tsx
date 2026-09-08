'use client';

import { Money, formatMoney, type MoneyLocale } from '@app/domain';
import { Amount } from '@app/ui';

import { CountUp, LiveGauge, Stagger, StaggerItem } from './motion';

/**
 * The product's own first screen, as the hero.
 *
 * Not a screenshot and not an illustration: the panel is the position card
 * every household sees on sign-in, on the demonstration household's figures.
 * The reading counts up and the level fills the first time the panel is seen,
 * so the argument — money is a level, not a number — is made by watching it
 * happen rather than by reading about it.
 */
export function HeroDevice({
  locale,
  liquid,
  available,
  buffer,
  committed,
  claims,
  labels,
}: {
  readonly locale: MoneyLocale;
  /** Decimal strings: a `Money` does not survive the trip from the server to
   *  a client component, so the figures cross as text and are rebuilt here. */
  readonly liquid: string;
  readonly available: string;
  readonly buffer: string;
  readonly committed: string;
  readonly claims: readonly { key: string; label: string; amount: string }[];
  readonly labels: {
    readonly readout: string;
    readonly basis: string;
    readonly gaugeLabel: string;
    readonly bufferMark: string;
    readonly surfaceMark: string;
    readonly claimsTitle: string;
    readonly demo: string;
  };
}) {
  const usd = (value: string) => Money.fromDecimalString(value, 'USD');
  const money = (value: Money) => formatMoney(value, { locale });
  const liquidMoney = usd(liquid);
  const availableMoney = usd(available);
  const bufferMoney = usd(buffer);
  const committedMoney = usd(committed);

  return (
    <div className="panel-scope relative overflow-hidden rounded-[1.75rem] border border-[color:var(--color-panel-rule)] bg-[color:var(--color-panel)] text-[color:var(--color-panel-ink)] shadow-(--shadow-sheet)">
      {/* One wash of brass behind the reading. Felt as depth, not seen as a gradient. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-40 h-96 w-96 rounded-full opacity-[0.16] blur-3xl"
        style={{ background: 'var(--color-brand)' }}
      />

      <div className="relative grid gap-10 p-6 sm:p-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-14">
        <div>
          <p className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-panel-ink-secondary)] uppercase">
            {labels.readout}
          </p>
          <p className="readout mt-3 text-5xl leading-none sm:text-7xl">
            <CountUp value={availableMoney} locale={locale} />
          </p>
          <p className="mt-4 max-w-[46ch] text-sm text-pretty text-[color:var(--color-panel-ink-secondary)]">
            {labels.basis
              .replace('{liquid}', money(liquidMoney))
              .replace('{committed}', money(committedMoney))}
          </p>

          <div className="mt-8">
            <LiveGauge
              value={availableMoney}
              max={liquidMoney}
              label={labels.gaugeLabel}
              locale={locale}
              thresholds={[
                { at: bufferMoney, label: labels.bufferMark, kind: 'buffer' },
                {
                  at: liquidMoney.subtract(committedMoney),
                  label: labels.surfaceMark,
                  kind: 'committed',
                },
              ]}
            />
          </div>
        </div>

        <div className="lg:border-l lg:border-[color:var(--color-panel-rule)] lg:pl-10">
          <p className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-panel-ink-secondary)] uppercase">
            {labels.claimsTitle}
          </p>
          <Stagger className="mt-3 divide-y divide-[color:var(--color-panel-rule)]" step={0.12}>
            {claims.map((claim) => (
              <StaggerItem key={claim.key} className="flex items-center justify-between gap-4 py-3">
                <span className="min-w-0 truncate text-sm">{claim.label}</span>
                <Amount value={usd(claim.amount).negate()} locale={locale} size="sm" tone="plain" />
              </StaggerItem>
            ))}
          </Stagger>
          <p className="mt-6 text-xs text-[color:var(--color-panel-ink-secondary)]">
            {labels.demo}
          </p>
        </div>
      </div>
    </div>
  );
}
