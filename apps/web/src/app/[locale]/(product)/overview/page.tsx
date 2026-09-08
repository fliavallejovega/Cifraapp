import {
  Amount,
  Button,
  Card,
  EmptyState,
  Gauge,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Page,
  PageHeader,
  Section,
  Stat,
  Status,
  type GaugeThreshold,
} from '@app/ui';
import { formatMoney } from '@app/domain';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { loadPosition } from '@/server/repositories/position';
import { requireHousehold } from '@/server/session';

/**
 * The first viewport, on real data.
 *
 * The reading leads: the available level on the ink panel, in brass, against
 * its marked scale — the one inverse surface this screen gets. Everything else
 * sits on paper below it: the two figures the reading is made of, then the
 * claims against it, itemized. Nothing here is synthetic — an empty household
 * gets an empty state that teaches, not a demonstration implying money it does
 * not have.
 */
export default async function OverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const position = await loadPosition(session, session.activeHouseholdId);

  const t = await getTranslations('overview');
  const format = await getFormatter();
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';

  const thresholds: GaugeThreshold[] = position.bufferMinimum.isZero()
    ? []
    : [{ at: position.bufferMinimum, label: t('gauge.buffer'), kind: 'buffer' }];

  // A gauge needs a real ceiling. With no liquid balance there is nothing to
  // measure against, and drawing an empty instrument would be theatre.
  const showGauge = !position.isEmpty && position.liquid.isPositive();

  return (
    <Page>
      <PageHeader
        title={t('title')}
        detail={format.dateTime(new Date(), {
          dateStyle: 'full',
          timeZone: 'America/Panama',
        })}
      />

      {position.isEmpty ? (
        <EmptyState
          title={t('empty.title')}
          body={t('empty.body')}
          action={
            <Link href="/accounts">
              <Button size="lg">{t('empty.action')}</Button>
            </Link>
          }
        />
      ) : (
        <>
          {/* The reading. One panel per screen, and this is the screen's. */}
          <Card tone="panel" padding="lg">
            <p className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-panel-ink-secondary)] uppercase">
              {t('readout.label')}
            </p>
            <p className="mt-2" style={{ color: 'var(--color-brand)' }}>
              <Amount value={position.available} locale={moneyLocale} tone="plain" size="readout" />
            </p>
            <p className="mt-3 text-sm text-[color:var(--color-panel-ink-secondary)]">
              {t('readout.detail', {
                liquid: formatMoney(position.liquid, { locale: moneyLocale }),
                committed: formatMoney(position.committed, { locale: moneyLocale }),
              })}
            </p>

            {showGauge && (
              <div className="mt-8">
                <Gauge
                  value={position.available}
                  max={position.liquid}
                  label={t('gauge.label')}
                  thresholds={thresholds}
                  locale={moneyLocale}
                  tone={position.available.isNegative() ? 'negative' : 'neutral'}
                />
              </div>
            )}

            <p className="mt-6 max-w-[62ch] text-xs text-pretty text-[color:var(--color-panel-ink-secondary)]">
              {t('gauge.explanation')}
            </p>
          </Card>

          {/* The two figures the reading is made of. */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Card>
              <Stat label={t('stats.liquid')} detail={t('stats.liquidDetail')}>
                <Amount value={position.liquid} locale={moneyLocale} tone="plain" size="lg" />
              </Stat>
            </Card>
            <Card>
              <Stat label={t('stats.committed')} detail={t('stats.committedDetail')}>
                <Amount value={position.committed} locale={moneyLocale} tone="plain" size="lg" />
              </Stat>
            </Card>
          </div>

          <Section title={t('claims.title')} detail={t('claims.detail')} className="mt-12">
            {position.claims.length === 0 ? (
              <EmptyState title={t('claims.emptyTitle')} body={t('claims.emptyBody')} />
            ) : (
              <Card padding="none" className="overflow-hidden">
                <div className="px-5 sm:px-6">
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
                          <LedgerCell className="font-medium">{claim.name}</LedgerCell>
                          <LedgerCell secondary className="tabular">
                            {format.dateTime(new Date(`${claim.due}T12:00:00Z`), {
                              day: 'numeric',
                              month: 'short',
                              timeZone: 'America/Panama',
                            })}
                          </LedgerCell>
                          <LedgerCell>
                            <Status tone={claim.isEssential ? 'neutral' : 'caution'}>
                              {claim.isEssential
                                ? t('claims.kinds.essential')
                                : t('claims.kinds.other')}
                            </Status>
                          </LedgerCell>
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
                </div>

                <div className="flex items-baseline justify-between border-t border-[color:var(--color-rule)] bg-[color:var(--color-ground-sunk)] px-5 py-3.5 sm:px-6">
                  <span className="text-sm font-medium text-[color:var(--color-ink-secondary)]">
                    {t('claims.total')}
                  </span>
                  <Amount
                    value={position.obligationsTotal.negate()}
                    locale={moneyLocale}
                    tone="plain"
                  />
                </div>
              </Card>
            )}
          </Section>

          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2">
            <Link
              href="/plan"
              className="text-sm font-medium text-[color:var(--color-ink)] underline decoration-[color:var(--color-brand)] underline-offset-4 hover:decoration-2"
            >
              {t('planLink')}
            </Link>
            <Link
              href="/documents"
              className="text-sm font-medium text-[color:var(--color-ink)] underline decoration-[color:var(--color-brand)] underline-offset-4 hover:decoration-2"
            >
              {t('importLink')}
            </Link>
          </div>
        </>
      )}

      <footer className="mt-12 border-t border-[color:var(--color-rule)] pt-5">
        {/* This screen answers "how much is there" and "what is spoken for".
            The full safe-to-spend ladder lives on the plan, and the note says so
            rather than implying this figure already accounts for it. */}
        <p className="max-w-[62ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
          {t('scopeNote')}
        </p>
      </footer>
    </Page>
  );
}
