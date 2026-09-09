import { formatMoney, type MoneyLocale } from '@app/domain';
import { Amount, Card, Status } from '@app/ui';

import { formatPlainDate } from '@/lib/format';

import type { PayPeriod } from '@app/budget-engine';

/**
 * The fortnights, side by side, with what each one can spare.
 *
 * The one thing this screen could never say before is the thing every household
 * on a twice-monthly salary already knows: the quincena of the 15th and the one
 * of the 30th are not the same size. Showing them next to each other is the
 * whole point — the number that matters is not «available», it is the
 * difference between two adjacent «available»s, and a single figure cannot
 * carry a difference.
 *
 * Only ever a handful of periods: two months of fortnights is four, and a daily
 * wage would produce sixty, which is a calendar rather than a plan. The first
 * few are the ones anybody can act on.
 */
export function PeriodStrip({
  periods,
  locale,
  moneyLocale,
  t,
}: {
  readonly periods: readonly PayPeriod[];
  readonly locale: string;
  readonly moneyLocale: MoneyLocale;
  readonly t: (key: string, values?: Record<string, string>) => string;
}) {
  const shown = periods.slice(0, 4);
  const day = (date: string) => formatPlainDate(date, locale);

  return (
    <section aria-labelledby="periods-heading" className="mt-8">
      <h2 id="periods-heading" className="text-base font-medium">
        {t('periods.title')}
      </h2>
      <p className="mt-1 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {t('periods.detail')}
      </p>

      <ul className="mt-4 grid gap-4 sm:grid-cols-2">
        {shown.map((period, at) => (
          <li key={period.start}>
            <Card>
              {/* One eyebrow, always the dates, so the cards read as one row of
                  the same thing. The current period is marked rather than
                  described differently: it is not a different kind of period. */}
              <p className="flex flex-wrap items-center gap-2 text-xs tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
                {t('periods.range', { from: day(period.start), to: day(period.end) })}
                {at === 0 && <Status tone="positive">{t('periods.now')}</Status>}
              </p>

              <p className="mt-3">
                <Amount value={period.available} locale={moneyLocale} tone="plain" size="readout" />
              </p>
              <p className="mt-1 text-sm text-[color:var(--color-ink-secondary)]">
                {t('periods.available')}
              </p>

              <dl className="mt-4 flex flex-col gap-1 text-sm text-[color:var(--color-ink-secondary)]">
                <div className="flex items-baseline justify-between gap-4">
                  <dt>{t('periods.income')}</dt>
                  <dd className="tabular">{formatMoney(period.income, { locale: moneyLocale })}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt>{t('periods.committed', { count: String(period.claims.length) })}</dt>
                  <dd className="tabular">
                    {formatMoney(period.committed, { locale: moneyLocale })}
                  </dd>
                </div>
                {period.reservedForLater.isPositive() && (
                  <div className="flex items-baseline justify-between gap-4">
                    {/* The whole reason the loose fortnight is not as loose as
                        it looks. Said out loud, because a figure quietly
                        reduced is a figure nobody trusts. */}
                    <dt>{t('periods.reserved')}</dt>
                    <dd className="tabular">
                      {formatMoney(period.reservedForLater, { locale: moneyLocale })}
                    </dd>
                  </div>
                )}
              </dl>

              {period.shortfall.isPositive() && (
                <p className="mt-3 text-sm text-[color:var(--color-negative)]">
                  {t('periods.shortfall', {
                    amount: formatMoney(period.shortfall, { locale: moneyLocale }),
                  })}
                </p>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
