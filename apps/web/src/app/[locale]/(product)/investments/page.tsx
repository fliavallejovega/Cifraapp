import { formatMoney } from '@app/domain';
import { RISK_LEVELS } from '@app/investment-engine';
import {
  Amount,
  Card,
  EmptyState,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Page,
  PageHeader,
  Problem,
  Section,
  Status,
} from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { InvestmentProfileForm } from '@/components/investment-profile-form';
import { RiskDisclosure } from '@/components/risk-disclosure';
import { Watchlist } from '@/components/watchlist';
import { Link } from '@/i18n/navigation';
import { loadHouseholdContext } from '@/server/household-context';
import { explainInvestmentPlan } from '@/server/repositories/investment-narrative';
import { loadGoalOptions, loadInvestments } from '@/server/repositories/investments';
import { loadPortfolio } from '@/server/repositories/portfolio';
import { trimAmount } from '@/lib/format';
import { requireHousehold } from '@/server/session';

/**
 * Investing, as modelling rather than advice.
 *
 * The screen answers one question — «how much would I have to put aside every
 * month to reach this, and what does more risk actually buy me» — and refuses
 * the one it is most often asked, which is what to buy. That refusal is not
 * timidity: naming an instrument is regulated advice, and it would break the
 * rule the rest of the product rests on, that no figure a household acts on
 * comes from a model rather than from arithmetic they can check.
 *
 * Everything in the table is computed by `@app/investment-engine` from the
 * household's own goals and an assumption band they can edit. The assistant
 * gets the finished table and explains the trade; it is given no market data,
 * so it has none to invent, and the guardrail rejects any figure in its answer
 * that is not already on the screen.
 *
 * The disclosure gates the table rather than sitting under it. A household that
 * has not read «these are assumptions, not forecasts» should not be reading a
 * column of monthly contributions.
 */
export default async function InvestmentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const householdId = session.activeHouseholdId;
  const context = loadHouseholdContext(session, householdId, locale);

  const [view, goalOptions, portfolio] = await Promise.all([
    loadInvestments(session, householdId, context.currency, context.today),
    loadGoalOptions(session, householdId, context.currency),
    loadPortfolio(session, householdId, context.currency),
  ]);

  const t = await getTranslations('investments');
  const shared = await getTranslations('records');
  const errors: unknown = shared.raw('errors');

  const money = (value: Parameters<typeof formatMoney>[0]) =>
    formatMoney(value, { locale: context.moneyLocale });

  /**
   * What the household owns, rendered on both sides of the disclosure.
   *
   * The disclosure gates the *modelling* — what to set aside, what more risk
   * buys — because that is the part that reasons about a future. A record of
   * what is already held is not a projection about anything; it is the
   * household's own property, valued at a quote from a named source. Hiding it
   * behind a warning about investment risk would be like putting a disclaimer
   * in front of somebody's bank balance.
   */
  const portfolioSection = (
    <Section title={t('portfolio.title')} detail={t('portfolio.detail')}>
      {portfolio.positions.length === 0 ? (
        <EmptyState
          title={t('portfolio.empty.title')}
          body={t('portfolio.empty.body')}
          action={
            <Link
              href="/welcome"
              className="text-sm font-medium underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
            >
              {t('portfolio.empty.action')}
            </Link>
          }
        />
      ) : (
        <>
          <Card tone="panel" padding="lg">
            <p className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-panel-ink-secondary)] uppercase">
              {t('portfolio.total')}
            </p>
            <div className="mt-3">
              <Amount
                value={portfolio.total}
                locale={context.moneyLocale}
                tone="plain"
                size="readout"
              />
            </div>
            <p className="mt-3 text-sm text-[color:var(--color-panel-ink-secondary)]">
              {portfolio.change
                ? t('portfolio.since', {
                    amount: formatMoney(portfolio.change, { locale: context.moneyLocale }),
                  })
                : t('portfolio.noChange')}
            </p>
            {portfolio.unpriced.length > 0 && (
              <p className="mt-4 text-xs text-[color:var(--color-panel-ink-secondary)]">
                {t('portfolio.unpriced', { symbols: portfolio.unpriced.join(', ') })}
              </p>
            )}
          </Card>

          <Ledger caption={t('portfolio.title')} className="mt-8">
            <LedgerHead>
              <LedgerColumn>{t('portfolio.what')}</LedgerColumn>
              <LedgerColumn align="end">{t('portfolio.quantity')}</LedgerColumn>
              <LedgerColumn align="end">{t('portfolio.price')}</LedgerColumn>
              <LedgerColumn align="end">{t('portfolio.value')}</LedgerColumn>
              <LedgerColumn align="end">{t('portfolio.move')}</LedgerColumn>
            </LedgerHead>
            <LedgerBody>
              {portfolio.positions.map((position) => (
                <LedgerRow key={position.id}>
                  <LedgerCell>
                    {position.label}
                    <span className="mt-1 block text-xs text-[color:var(--color-ink-tertiary)]">
                      {position.symbol}
                      {position.holder ? ` · ${position.holder}` : ''}
                      {position.stale ? ` · ${t('portfolio.stale')}` : ''}
                    </span>
                  </LedgerCell>
                  <LedgerCell align="end">
                    <span className="tabular">{trimAmount(position.quantity)}</span>
                  </LedgerCell>
                  <LedgerCell align="end">
                    <span className="tabular">
                      {position.valuation
                        ? `${position.valuation.quote.currency} ${trimAmount(position.valuation.quote.price)}`
                        : '—'}
                    </span>
                  </LedgerCell>
                  <LedgerCell align="end">
                    {position.valuation ? (
                      <Amount
                        value={position.valuation.value}
                        locale={context.moneyLocale}
                        size="sm"
                        tone="plain"
                      />
                    ) : (
                      <span className="text-[color:var(--color-ink-tertiary)]">
                        {t('portfolio.noPrice')}
                      </span>
                    )}
                  </LedgerCell>
                  <LedgerCell align="end">
                    {position.valuation?.change ? (
                      <Amount
                        value={position.valuation.change}
                        locale={context.moneyLocale}
                        size="sm"
                        tone="directional"
                      />
                    ) : (
                      <span className="text-[color:var(--color-ink-tertiary)]">—</span>
                    )}
                  </LedgerCell>
                </LedgerRow>
              ))}
            </LedgerBody>
          </Ledger>

          <p className="mt-4 max-w-[72ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
            {t('portfolio.provenance', {
              source:
                portfolio.positions.find((entry) => entry.valuation)?.valuation?.quote.source ??
                '—',
            })}
          </p>
        </>
      )}
    </Section>
  );

  // Before the disclosure is read, the modelling is not rendered at all.
  if (view.profile.acknowledgedAt === null) {
    return (
      <Page>
        <PageHeader title={t('title')} detail={t('detail')} />
        {portfolioSection}
        <RiskDisclosure
          locale={locale}
          labels={{
            title: t('disclosure.title'),
            body: t('disclosure.body'),
            accept: t('disclosure.accept'),
            errorTitle: t('errorTitle'),
            generic: shared('errors.generic'),
          }}
        />
      </Page>
    );
  }

  const narrative = await explainInvestmentPlan(
    session,
    householdId,
    view.profile,
    view.plans,
    locale === 'en' ? 'en' : 'es',
    context.moneyLocale,
  );

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {portfolioSection}

      {/* Stated before any modelled figure, every time — not once at sign-up.
          It sits below the portfolio because the portfolio is a record and
          everything under this line is a projection. */}
      <div className="my-8">
        <Problem title={t('disclosure.title')} body={t('disclosure.body')} />
      </div>

      {!view.profile.hasEmergencyFund && (
        <div className="mb-8">
          <Card tone="sunk">
            <p className="font-medium text-[color:var(--color-ink)]">{t('emergencyFirst.title')}</p>
            <p className="mt-2 max-w-[62ch] text-pretty text-[color:var(--color-ink-secondary)]">
              {t('emergencyFirst.body')}
            </p>
            <p className="mt-3">
              <Link
                href="/goals"
                className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
              >
                {t('emergencyFirst.action')}
              </Link>
            </p>
          </Card>
        </div>
      )}

      <Section title={t('profile.title')} detail={t('profile.detail')} className="mt-12">
        <Card>
          <InvestmentProfileForm
            locale={locale}
            currencySymbol={context.currencySymbol}
            values={{
              riskLevel: view.profile.riskLevel,
              monthlyCapacity: view.profile.monthlyCapacity.toDecimalString(),
              interests: view.profile.interests.join(', '),
              hasEmergencyFund: String(view.profile.hasEmergencyFund),
              assumedLow: view.profile.usingDefaultBand
                ? ''
                : (view.profile.bands[view.profile.riskLevel].low ?? ''),
              assumedExpected: view.profile.usingDefaultBand
                ? ''
                : (view.profile.bands[view.profile.riskLevel].expected ?? ''),
              assumedHigh: view.profile.usingDefaultBand
                ? ''
                : (view.profile.bands[view.profile.riskLevel].high ?? ''),
            }}
            levels={RISK_LEVELS.map((level) => ({
              value: level,
              label: t(`risks.${level}`),
              detail: t(`risks.${level}Detail`),
            }))}
            usingDefault={view.profile.usingDefaultBand}
            labels={{
              risk: t('profile.risk'),
              riskHint: t('profile.riskHint'),
              capacity: t('profile.capacity'),
              capacityHint: t('profile.capacityHint'),
              interests: t('profile.interests'),
              interestsHint: t('profile.interestsHint'),
              emergency: t('profile.emergency'),
              emergencyHint: t('profile.emergencyHint'),
              band: t('profile.band'),
              bandHint: t('profile.bandHint'),
              low: t('profile.low'),
              expected: t('profile.expected'),
              high: t('profile.high'),
              submit: t('profile.submit'),
              saved: t('profile.saved'),
              usingDefault: t('profile.usingDefault'),
              usingOwn: t('profile.usingOwn'),
              errorTitle: t('errorTitle'),
              errors: isStringRecord(errors) ? errors : {},
            }}
          />
        </Card>
      </Section>

      <Section title={t('goals.title')} detail={t('goals.detail')} className="mt-12">
        {view.plans.length === 0 ? (
          <Card>
            <EmptyState
              title={t('goals.empty.title')}
              body={t('goals.empty.body')}
              action={
                <Link
                  href="/goals"
                  className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
                >
                  {t('goals.empty.action')}
                </Link>
              }
            />
          </Card>
        ) : (
          <ul className="flex flex-col gap-6">
            {view.plans.map((plan) => (
              <li key={plan.goal.id}>
                <Card padding="none">
                  <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 pt-5 pb-4 sm:px-6">
                    <div className="min-w-0">
                      <p className="font-medium text-[color:var(--color-ink)]">{plan.goal.name}</p>
                      <p className="mt-1 text-sm text-[color:var(--color-ink-secondary)]">
                        {money(plan.goal.current)} / {money(plan.goal.target)} ·{' '}
                        {t('goals.months', { count: plan.goal.months })}
                      </p>
                    </div>
                    <p className="readout text-sm text-[color:var(--color-ink-tertiary)]">
                      {t('goals.noGrowth', { amount: money(plan.withoutGrowth) })}
                    </p>
                  </div>

                  <ul className="flex flex-col border-t border-[color:var(--color-rule)]">
                    {plan.outcomes.map((outcome) => {
                      const fits =
                        !outcome.unreachable &&
                        outcome.monthly.lessThanOrEqual(view.profile.monthlyCapacity);

                      return (
                        <li
                          key={outcome.level}
                          className={[
                            'flex flex-col gap-2 border-b border-[color:var(--color-rule)] px-5 py-4 last:border-b-0 sm:px-6',
                            outcome.level === view.profile.riskLevel
                              ? 'bg-[color:var(--color-ground-sunk)]'
                              : '',
                          ].join(' ')}
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-3">
                            <span className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-medium text-[color:var(--color-ink)]">
                                {t(`risks.${outcome.level}`)}
                              </span>
                              <span className="text-sm text-[color:var(--color-ink-tertiary)]">
                                {outcome.band.low}% – {outcome.band.high}%
                              </span>
                            </span>

                            <span className="readout text-base text-[color:var(--color-ink)] tabular-nums">
                              {outcome.unreachable ? '—' : money(outcome.monthly)}
                            </span>
                          </div>

                          <p className="text-sm text-[color:var(--color-ink-secondary)]">
                            {outcome.unreachable
                              ? t('goals.unreachable')
                              : t('goals.rangeDetail', {
                                  low: money(outcome.ifPoor),
                                  high: money(outcome.ifGood),
                                })}
                          </p>

                          <p className="flex flex-wrap gap-2">
                            {outcome.tooShort && (
                              <Status tone="negative">{t('goals.tooShort')}</Status>
                            )}
                            {!outcome.unreachable && outcome.drawdownAtWorst.isPositive() && (
                              <Status tone="caution">
                                {t('goals.drawdown', { amount: money(outcome.drawdownAtWorst) })}
                              </Status>
                            )}
                            {!outcome.unreachable && (
                              <Status tone={fits ? 'positive' : 'neutral'}>
                                {fits
                                  ? t('goals.affordable', {
                                      capacity: money(view.profile.monthlyCapacity),
                                    })
                                  : t('goals.notAffordable', {
                                      capacity: money(view.profile.monthlyCapacity),
                                    })}
                              </Status>
                            )}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
        )}

        {view.undatedGoals.length > 0 && (
          <p className="mt-6 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {t('goals.undated', {
              names: view.undatedGoals.map((goal) => goal.name).join(', '),
            })}
          </p>
        )}
      </Section>

      {view.plans.length > 0 && (
        <Section title={t('narrative.title')} detail={t('narrative.detail')} className="mt-12">
          <Card tone="sunk">
            {narrative.state === 'answered' ? (
              <p className="max-w-[62ch] text-pretty text-[color:var(--color-ink)]">
                {narrative.body}
              </p>
            ) : narrative.state === 'unavailable' ? (
              <p className="max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
                {t('narrative.unavailable')}
              </p>
            ) : (
              <Status tone="caution">{t(`narrative.${narrative.reason}`)}</Status>
            )}
          </Card>
        </Section>
      )}

      <Section title={t('watchlist.title')} detail={t('watchlist.detail')} className="mt-12">
        <Watchlist
          locale={locale}
          rows={view.watchlist}
          goals={goalOptions}
          labels={{
            symbol: t('watchlist.symbol'),
            symbolHint: t('watchlist.symbolHint'),
            label: t('watchlist.label'),
            note: t('watchlist.note'),
            goal: t('watchlist.goal'),
            noGoal: t('watchlist.noGoal'),
            add: t('watchlist.add'),
            remove: t('watchlist.remove'),
            removeConfirm: t('watchlist.removeConfirm'),
            cancel: shared('cancel'),
            emptyTitle: t('watchlist.empty.title'),
            emptyBody: t('watchlist.empty.body'),
            chartLabel: rawOf(t)('watchlist.chartLabel'),
            chartNote: t('watchlist.chartNote'),
            chartLoading: t('watchlist.chartLoading'),
            chartFailedTitle: t('watchlist.chartFailedTitle'),
            chartFailedBody: t('watchlist.chartFailedBody'),
            errorTitle: t('errorTitle'),
            errors: isStringRecord(errors) ? errors : {},
          }}
        />
      </Section>
    </Page>
  );
}

function rawOf(t: { raw: (key: string) => unknown }): (key: string) => string {
  return (key) => {
    const value = t.raw(key);
    return typeof value === 'string' ? value : '';
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}
