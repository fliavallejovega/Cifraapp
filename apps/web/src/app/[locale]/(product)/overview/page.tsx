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
import { UnderstoodCard } from '@/components/understood-card';
import { loadMonthGlance } from '@/server/repositories/month-glance';
import { loadUnderstood } from '@/server/repositories/understood';
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
  const [position, glance, understood] = await Promise.all([
    loadPosition(session, session.activeHouseholdId),
    loadMonthGlance(session, session.activeHouseholdId),
    loadUnderstood(session, session.activeHouseholdId),
  ]);

  const t = await getTranslations('overview');
  const setupComplete =
    session.households.find((entry) => entry.id === session.activeHouseholdId)?.setupComplete ??
    true;
  const format = await getFormatter();
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';

  const thresholds: GaugeThreshold[] = position.bufferMinimum.isZero()
    ? []
    : [{ at: position.bufferMinimum, label: t('gauge.buffer'), kind: 'buffer' }];

  // A gauge needs a real ceiling. With no liquid balance there is nothing to
  // measure against, and drawing an empty instrument would be theatre.
  const showGauge = !position.isEmpty && position.liquid.isPositive();

  const monthName = format.dateTime(new Date(`${glance.month}T12:00:00Z`), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const typical = glance.typicalExpenses;
  const versus =
    typical === null
      ? null
      : glance.expenses.greaterThan(typical)
        ? t('month.above', {
            typical: formatMoney(typical, { locale: moneyLocale }),
            gap: formatMoney(glance.expenses.subtract(typical), { locale: moneyLocale }),
          })
        : t('month.below', {
            typical: formatMoney(typical, { locale: moneyLocale }),
            gap: formatMoney(typical.subtract(glance.expenses), { locale: moneyLocale }),
          });
  const linkClass =
    'inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--color-ink)] underline decoration-[color:var(--color-brand)] underline-offset-4 hover:decoration-2';

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
            <Link href="/documents" className="inline-block">
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

          {/* What the movements already say, confirmed in one tap. */}
          {understood.length > 0 && (
            <UnderstoodCard
              locale={locale}
              rows={understood.map((series) => ({
                id: series.id,
                name: series.name,
                detail: t(
                  series.direction === 'inflow' ? 'understood.inflow' : 'understood.outflow',
                  {
                    frequency: t(`understood.frequency.${series.frequency}`),
                  },
                ),
                amount: (
                  <Amount
                    value={series.direction === 'inflow' ? series.amount : series.amount.negate()}
                    locale={moneyLocale}
                    size="sm"
                  />
                ),
              }))}
              labels={{
                title: t('understood.title'),
                body: t('understood.body'),
                confirm: t('understood.confirm', { count: understood.length }),
                review: t('understood.review'),
                done: t('understood.done'),
                error: t('understood.error'),
              }}
            />
          )}

          {/* The questionnaire is offered here, never required. */}
          {!setupComplete && (
            <Card tone="sunk" className="mt-6">
              <p className="text-sm text-pretty">{t('setup.body')}</p>
              <Link href="/welcome" className={`${linkClass} mt-2`}>
                {t('setup.action')}
              </Link>
            </Card>
          )}

          {/* What the balances rest on, when the bank has not confirmed them or disagreed. */}
          {(glance.mismatches.length > 0 || glance.unconfirmedAccounts > 0) && (
            <Card className="mt-6">
              <div className="grid gap-3">
                {glance.mismatches.map((note) => (
                  <p key={note.accountName} className="text-sm text-pretty">
                    {t(note.gap.isPositive() ? 'balance.mismatchAbove' : 'balance.mismatchBelow', {
                      account: note.accountName,
                      gap: formatMoney(note.gap.abs(), { locale: moneyLocale }),
                      date: format.dateTime(new Date(`${note.asOf}T12:00:00Z`), {
                        day: 'numeric',
                        month: 'long',
                        timeZone: 'UTC',
                      }),
                    })}
                  </p>
                ))}
                {glance.unconfirmedAccounts > 0 && (
                  <p className="text-sm text-pretty">
                    {t('balance.unconfirmed', { count: glance.unconfirmedAccounts })}
                  </p>
                )}
                <Link href="/documents" className={linkClass}>
                  {t('balance.action')}
                </Link>
              </div>
            </Card>
          )}

          <Section
            title={
              glance.isCurrentMonth
                ? t('month.title')
                : t('month.titleEarlier', { month: monthName })
            }
            detail={glance.isCurrentMonth ? t('month.detail') : t('month.detailEarlier')}
            className="mt-12"
          >
            {glance.hasMovements ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Card>
                    <Stat label={t('month.income')}>
                      <Amount value={glance.income} locale={moneyLocale} tone="plain" size="lg" />
                    </Stat>
                  </Card>
                  <Card>
                    <Stat label={t('month.expenses')} {...(versus ? { detail: versus } : {})}>
                      <Amount value={glance.expenses} locale={moneyLocale} tone="plain" size="lg" />
                    </Stat>
                  </Card>
                </div>

                <Card padding="none" className="mt-4 overflow-hidden">
                  <div className="px-5 sm:px-6">
                    <Ledger caption={t('recent.title')}>
                      <LedgerHead>
                        <LedgerColumn>{t('recent.columns.description')}</LedgerColumn>
                        <LedgerColumn className="hidden sm:table-cell">
                          {t('recent.columns.account')}
                        </LedgerColumn>
                        <LedgerColumn align="end">{t('recent.columns.amount')}</LedgerColumn>
                      </LedgerHead>
                      <LedgerBody>
                        {glance.recent.map((row) => (
                          <LedgerRow key={row.id}>
                            <LedgerCell className="min-w-0">
                              <span className="line-clamp-2 block font-medium break-words">
                                {row.description}
                              </span>
                              <span className="tabular block text-xs text-[color:var(--color-ink-secondary)]">
                                {format.dateTime(new Date(`${row.date}T12:00:00Z`), {
                                  day: 'numeric',
                                  month: 'short',
                                  timeZone: 'UTC',
                                })}
                              </span>
                            </LedgerCell>
                            <LedgerCell secondary className="hidden sm:table-cell">
                              {row.accountName}
                            </LedgerCell>
                            <LedgerCell align="end">
                              <Amount value={row.amount} locale={moneyLocale} size="sm" />
                            </LedgerCell>
                          </LedgerRow>
                        ))}
                      </LedgerBody>
                    </Ledger>
                  </div>
                </Card>
                <Link href="/movements" className={`${linkClass} mt-2`}>
                  {t('recent.all')}
                </Link>
              </>
            ) : (
              <EmptyState
                title={t('month.emptyTitle')}
                body={t('month.emptyBody')}
                action={
                  <Link href="/documents" className="inline-block">
                    <Button>{t('month.emptyAction')}</Button>
                  </Link>
                }
              />
            )}
          </Section>

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
                      {/* The kind steps aside on a phone so the amount stays in view. */}
                      <LedgerColumn className="hidden sm:table-cell">
                        {t('claims.columns.kind')}
                      </LedgerColumn>
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
                          <LedgerCell className="hidden sm:table-cell">
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

          <div className="mt-8 flex flex-wrap gap-x-8">
            <Link
              href="/plan"
              className="inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--color-ink)] underline decoration-[color:var(--color-brand)] underline-offset-4 hover:decoration-2"
            >
              {t('planLink')}
            </Link>
            <Link
              href="/documents"
              className="inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--color-ink)] underline decoration-[color:var(--color-brand)] underline-offset-4 hover:decoration-2"
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
