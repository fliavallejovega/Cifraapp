import { comparePlans, orderDebts, simulatePayoff, totalMinimums } from '@app/debt-engine';
import { formatMoney, isOk, Money } from '@app/domain';
import { Card, EmptyState, Page, PageHeader, Section, Stat, Status } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SimulatorForm } from '@/components/simulator-form';
import { formatPlainDate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadDebts, loadSettings } from '@/server/repositories/administration';
import { requireHousehold } from '@/server/session';

/**
 * Avalanche against snowball, on the household's own balances.
 *
 * The engine has computed this since Phase 9 and had nowhere to say it. The
 * comparison is the point: avalanche wins on arithmetic, snowball wins on the
 * arithmetic actually being followed through, and which is right depends on a
 * person the engine cannot see. So it shows the cost of the choice honestly and
 * does not make it.
 *
 * The monthly payment lives in the URL rather than in component state, so a
 * simulation is a link somebody can send to their partner.
 */
export default async function DebtSimulatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const query = await searchParams;
  const session = await requireHousehold(locale);
  const context = await loadHouseholdContext(session, session.activeHouseholdId, locale);

  const [debts, settings] = await Promise.all([
    loadDebts(session, session.activeHouseholdId, context.currency),
    loadSettings(session, session.activeHouseholdId, context.currency),
  ]);

  const t = await getTranslations('debtSimulator');

  const live = debts
    .filter((debt) => debt.currentBalance.isPositive())
    .map((debt) => ({
      id: debt.id,
      name: debt.name,
      currentBalance: debt.currentBalance,
      apr: debt.apr,
      minimumPayment: debt.minimumPayment,
      creditLimit: debt.creditLimit,
    }));

  if (live.length === 0) {
    return (
      <Page>
        <PageHeader title={t('title')} detail={t('detail')} />
        <Card>
          <EmptyState title={t('result.noDebts')} />
        </Card>
      </Page>
    );
  }

  const minimums = totalMinimums(live, context.currency);

  const typed = single(query['monthly']);
  const strategy = strategyOf(single(query['strategy']) || settings.debtStrategy);
  const monthly = /^\d+(\.\d{1,4})?$/.test(typed)
    ? Money.fromDecimalString(typed, context.currency)
    : minimums;

  const chosen = simulatePayoff({
    debts: live,
    strategy,
    monthlyPayment: monthly,
    from: context.today,
  });

  // Both strategies are always run: the comparison is the reason to open the
  // screen, and running only the selected one would leave the household with a
  // figure and no idea what it cost them.
  const avalanche = simulatePayoff({
    debts: live,
    strategy: 'avalanche',
    monthlyPayment: monthly,
    from: context.today,
  });
  const snowball = simulatePayoff({
    debts: live,
    strategy: 'snowball',
    monthlyPayment: monthly,
    from: context.today,
  });

  const comparison =
    isOk(avalanche) && isOk(snowball) ? comparePlans(avalanche.value, snowball.value) : null;

  const ordered = orderDebts(live, strategy, context.today);

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      <Card>
        <SimulatorForm
          currencySymbol={context.currencySymbol}
          current={{ monthly: typed || minimums.toDecimalString(), strategy }}
          labels={{
            monthly: t('form.monthly'),
            monthlyHint: t('form.monthlyHint', {
              minimums: formatMoney(minimums, { locale: context.moneyLocale }),
            }),
            strategy: t('form.strategy'),
            submit: t('form.submit'),
            strategies: {
              avalanche: t('strategies.avalanche'),
              snowball: t('strategies.snowball'),
              hybrid: t('strategies.hybrid'),
              custom: t('strategies.custom'),
            },
          }}
        />
      </Card>

      <Section title={t('result.title')} className="mt-12">
        {!chosen.ok ? (
          <Card>
            <Status tone="negative">
              {chosen.error.kind === 'below_minimums'
                ? t('result.belowMinimums', {
                    required: formatMoney(chosen.error.required, {
                      locale: context.moneyLocale,
                    }),
                  })
                : t('result.noDebts')}
            </Status>
          </Card>
        ) : chosen.value.debtFreeOn === null ? (
          <Card>
            <Status tone="negative">{t('result.never')}</Status>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <Stat label={t('result.title')}>
                {t('result.months', { count: chosen.value.monthsToDebtFree ?? 0 })}
              </Stat>
            </Card>
            <Card>
              <Stat label={t('result.freeOn', { date: '' }).replace(' ', ' ')}>
                {formatPlainDate(chosen.value.debtFreeOn, locale)}
              </Stat>
            </Card>
            <Card>
              <Stat label={t('result.interest')}>
                {formatMoney(chosen.value.totalInterest, { locale: context.moneyLocale })}
              </Stat>
            </Card>
          </div>
        )}
      </Section>

      {comparison && (
        <Section title={t('compare.title')} detail={t('compare.detail')} className="mt-12">
          <Card>
            {/* `monthsSaved` is null when one of the two plans never clears
                inside the horizon: «four months sooner» is unanswerable, and
                the interest figure carries the comparison on its own. */}
            {comparison.interestSaved.isZero() && (comparison.monthsSaved ?? 0) === 0 ? (
              <p className="text-[color:var(--color-ink)]">{t('compare.same')}</p>
            ) : (
              <p className="max-w-[62ch] text-pretty text-[color:var(--color-ink)]">
                {comparison.interestSaved.isPositive()
                  ? t('compare.saves', {
                      amount: formatMoney(comparison.interestSaved, {
                        locale: context.moneyLocale,
                      }),
                    })
                  : t('compare.snowballSooner', {
                      count: Math.abs(comparison.monthsSaved ?? 0),
                    })}
                {comparison.interestSaved.isPositive() &&
                  comparison.monthsSaved !== null &&
                  comparison.monthsSaved > 0 && (
                    <> {t('compare.sooner', { count: comparison.monthsSaved })}</>
                  )}
                .
              </p>
            )}
          </Card>
        </Section>
      )}

      <Section title={t('order.title')} detail={t('order.detail')} className="mt-12">
        <Card>
          <ol className="flex flex-col">
            {ordered.map((entry) => (
              <li
                key={entry.debt.id}
                className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[color:var(--color-rule)] py-4 last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="font-medium text-[color:var(--color-ink)]">
                    {entry.debt.name}
                  </span>
                  <span className="mt-0.5 block text-sm text-[color:var(--color-ink-secondary)]">
                    {entry.reason}
                  </span>
                </span>
                <span className="readout text-[color:var(--color-ink)] tabular-nums">
                  {formatMoney(entry.debt.currentBalance, { locale: context.moneyLocale })}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </Section>

      <p className="mt-8 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {t('note')}
      </p>
    </Page>
  );
}

function single(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function strategyOf(value: string): 'avalanche' | 'snowball' | 'custom' | 'hybrid' {
  if (value === 'snowball' || value === 'custom' || value === 'hybrid') return value;
  return 'avalanche';
}
