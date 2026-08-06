import {
  Amount,
  Gauge,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Page,
  Readout,
  Rule,
  Section,
  Status,
  type GaugeThreshold,
} from '@app/ui';
import { formatMoney } from '@app/domain';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { DEMO_POSITION } from '@/demo/household';

/**
 * The first viewport.
 *
 * Per DESIGN.md: the available level against a marked scale with named
 * thresholds, the figure as a read-out beneath it, then the claims against it
 * itemized. Not a hero metric card — knowing the number matters far less than
 * knowing where it sits relative to what is already spoken for.
 *
 * The figures are synthetic and labeled as such. Phase 3 replaces them with
 * real queries against the household.
 */

export default async function OverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Pending the next/root-params migration; see the note in layout.tsx.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const t = await getTranslations('overview');
  const common = await getTranslations('common');
  const format = await getFormatter();

  const position = DEMO_POSITION;
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';

  // One mark, and it earns its place: the floor this household refuses to go
  // below. A mark at the current level would restate the surface, which is
  // already the boundary between the solid region and the hatched one.
  const thresholds: GaugeThreshold[] = [
    { at: position.bufferMinimum, label: t('gauge.buffer'), kind: 'buffer' },
  ];

  const otherLocale = routing.locales.find((candidate) => candidate !== locale) ?? 'en';

  return (
    <Page>
      <header className="mb-14 flex items-baseline justify-between gap-6">
        <span className="gradation-label uppercase">{common('appName')}</span>
        <Link
          href="/"
          locale={otherLocale}
          className="text-xs text-[color:var(--color-ink-secondary)] underline underline-offset-4 transition-opacity duration-(--duration-quick) hover:opacity-60"
        >
          {t('switchLanguage')}
        </Link>
      </header>

      {/* The instrument. The level is read against its scale; the figure below
          is the read-out, not the headline. */}
      <section aria-labelledby="level-heading">
        <h1 id="level-heading" className="sr-only">
          {t('title')}
        </h1>

        <Gauge
          value={position.available}
          max={position.liquid}
          label={t('gauge.label')}
          thresholds={thresholds}
          locale={moneyLocale}
        />

        <div className="mt-8 flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
          <Readout
            value={position.available}
            label={t('readout.label')}
            detail={t('readout.detail', {
              liquid: formatMoney(position.liquid, { locale: moneyLocale }),
              committed: formatMoney(position.committed, { locale: moneyLocale }),
            })}
            locale={moneyLocale}
          />

          <dl className="flex gap-10">
            <div>
              <dt className="gradation-label uppercase">{t('stats.netWorth')}</dt>
              <dd className="mt-1">
                <Amount value={position.netWorth} locale={moneyLocale} size="lg" tone="plain" />
              </dd>
            </div>
            <div>
              <dt className="gradation-label uppercase">{t('stats.committed')}</dt>
              <dd className="mt-1">
                <Amount value={position.committed} locale={moneyLocale} size="lg" tone="plain" />
              </dd>
            </div>
          </dl>
        </div>

        <p className="mt-6 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {t('gauge.explanation')}
        </p>
      </section>

      <Section title={t('claims.title')} detail={t('claims.detail')} className="mt-16">
        <Ledger caption={t('claims.title')}>
          <LedgerHead>
            <LedgerColumn>{t('claims.columns.item')}</LedgerColumn>
            <LedgerColumn>{t('claims.columns.due')}</LedgerColumn>
            <LedgerColumn>{t('claims.columns.kind')}</LedgerColumn>
            <LedgerColumn align="end">{t('claims.columns.amount')}</LedgerColumn>
          </LedgerHead>
          <LedgerBody>
            {position.claims.map((claim) => (
              <LedgerRow key={claim.id}>
                <LedgerCell>{t(`claims.items.${claim.labelKey}`)}</LedgerCell>
                <LedgerCell secondary className="tabular">
                  {format.dateTime(new Date(`${claim.due}T12:00:00Z`), {
                    day: 'numeric',
                    month: 'short',
                    timeZone: 'America/Panama',
                  })}
                </LedgerCell>
                <LedgerCell>
                  <Status
                    tone={
                      claim.kind === 'debt'
                        ? 'caution'
                        : claim.kind === 'reserve'
                          ? 'signal'
                          : 'neutral'
                    }
                  >
                    {t(`claims.kinds.${claim.kind}`)}
                  </Status>
                </LedgerCell>
                {/* Plain, not colored. In a column where every row is an
                    outflow, red on all of them carries no information — it just
                    makes the page shout. */}
                <LedgerCell align="end">
                  <Amount
                    value={claim.amount.negate()}
                    locale={moneyLocale}
                    size="sm"
                    tone="plain"
                  />
                </LedgerCell>
              </LedgerRow>
            ))}
          </LedgerBody>
        </Ledger>

        <div className="mt-4 flex items-baseline justify-between">
          <span className="text-sm text-[color:var(--color-ink-secondary)]">
            {t('claims.total')}
          </span>
          <Amount value={position.committed.negate()} locale={moneyLocale} tone="plain" />
        </div>
      </Section>

      <Rule className="mt-16" />
      <footer className="mt-6">
        <p className="max-w-[62ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
          {t('synthetic')}
        </p>
      </footer>
    </Page>
  );
}
