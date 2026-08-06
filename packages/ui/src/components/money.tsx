import { describeMoney, formatMoney, type Money, type MoneyLocale } from '@app/domain';

import { cn } from '../utils/cn';

/**
 * Money on screen.
 *
 * The only component allowed to render an amount. Formatting itself lives in
 * `@app/domain`; this adds what a screen needs on top of a string — tabular
 * figures so columns hold, semantic color that is never the sole signal, and a
 * spoken form, because a screen reader saying "dollar sign one two three four"
 * is not a number anyone can act on.
 */

export interface AmountProps {
  readonly value: Money;
  readonly locale?: MoneyLocale;
  /**
   * `auto` colors negatives. `directional` also marks positives, for deltas and
   * inflows. `plain` never colors — correct for a balance, where being negative
   * is a fact rather than a warning.
   */
  readonly tone?: 'auto' | 'directional' | 'plain';
  readonly size?: 'readout' | 'lg' | 'md' | 'sm';
  readonly showCode?: boolean;
  readonly compactCents?: boolean;
  readonly className?: string;
}

export function Amount({
  value,
  locale = 'es-PA',
  tone = 'auto',
  size = 'md',
  showCode = false,
  compactCents = false,
  className,
}: AmountProps) {
  const text = formatMoney(value, {
    locale,
    showCode,
    compactCents,
    signDisplay: tone === 'directional' ? 'always' : 'auto',
  });

  const colored =
    tone === 'plain'
      ? undefined
      : value.isNegative()
        ? 'var(--color-negative)'
        : tone === 'directional' && value.isPositive()
          ? 'var(--color-positive)'
          : undefined;

  return (
    <span
      className={cn(
        size === 'readout' && 'readout text-5xl leading-none sm:text-6xl',
        size === 'lg' && 'tabular text-2xl',
        size === 'md' && 'tabular',
        size === 'sm' && 'tabular text-sm',
        className,
      )}
      style={colored ? { color: colored } : undefined}
    >
      {/* The visible string carries the symbol and a true minus, which aligns
          with digits. The spoken string names the currency instead. */}
      <span aria-hidden>{text}</span>
      <span className="sr-only">{describeMoney(value, locale)}</span>
    </span>
  );
}

/**
 * The instrument read-out: the primary figure beneath a gauge's scale.
 * Deliberately not a "hero metric" — it is the numeric reading of something the
 * scale above it has already shown in relation to its thresholds.
 */
export interface ReadoutProps {
  readonly value: Money;
  readonly label: string;
  readonly detail?: string;
  readonly locale?: MoneyLocale;
  readonly className?: string;
}

export function Readout({ value, label, detail, locale = 'es-PA', className }: ReadoutProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="gradation-label uppercase">{label}</span>
      <Amount value={value} locale={locale} size="readout" tone="plain" />
      {detail && (
        <span className="mt-1 text-sm text-[color:var(--color-ink-secondary)]">{detail}</span>
      )}
    </div>
  );
}
