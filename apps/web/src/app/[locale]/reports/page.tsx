import { formatMoney } from '@app/domain';
import {
  Amount,
  EmptyState,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Page,
  PageHeader,
  Readout,
  Rule,
  Section,
  Status,
} from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SignOutButton } from '@/components/sign-out-button';
import { loadReport } from '@/server/repositories/reports';
import { requireHousehold } from '@/server/session';

/**
 * The statements.
 *
 * Every figure on this page came out of a SQL query and an arithmetic function.
 * Nothing was summarized, nothing was estimated, and the export link hands over
 * the same rows the page is showing rather than a second computation that could
 * disagree with the first.
 */
export default async function ReportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const view = await loadReport(session, session.activeHouseholdId);

  const t = await getTranslations('reports');
  const common = await getTranslations('common');
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';
  const money = (value: Parameters<typeof formatMoney>[0]) =>
    formatMoney(value, { locale: moneyLocale });

  const householdName =
    session.households.find((household) => household.id === session.activeHouseholdId)?.name ?? '';

  return (
    <Page>
      <header className="mb-14 flex items-baseline justify-between gap-6">
        <div className="flex items-baseline gap-3">
          <span className="gradation-label uppercase">{common('appName')}</span>
          <span className="text-sm text-[color:var(--color-ink-secondary)]">{householdName}</span>
        </div>
        <SignOutButton locale={locale} label={t('signOut')} />
      </header>

      <PageHeader
        title={t('title')}
        detail={t('detail', { start: view.period.start, end: view.period.end })}
      />

      {view.isEmpty ? (
        <EmptyState title={t('empty.title')} body={t('empty.body')} />
      ) : (
        <>
          <section aria-labelledby="net-worth-heading">
            <h2 id="net-worth-heading" className="sr-only">
              {t('netWorth.title')}
            </h2>

            <Readout
              value={view.netWorth.netWorth}
              label={t('netWorth.label')}
              detail={t('netWorth.detail', {
                assets: money(view.netWorth.assets),
                liabilities: money(view.netWorth.liabilities),
              })}
              locale={moneyLocale}
            />
          </section>

          <Section title={t('income.title')} detail={t('income.detail')} className="mt-16">
            <Ledger caption={t('income.title')}>
              <LedgerHead>
                <LedgerColumn>{t('income.columns.category')}</LedgerColumn>
                <LedgerColumn align="end">{t('income.columns.transactions')}</LedgerColumn>
                <LedgerColumn align="end">{t('income.columns.amount')}</LedgerColumn>
              </LedgerHead>
              <LedgerBody>
                {view.income.incomeLines.map((line) => (
                  <LedgerRow key={`income-${line.key}`}>
                    <LedgerCell>{line.label}</LedgerCell>
                    <LedgerCell align="end">{line.count}</LedgerCell>
                    <LedgerCell align="end">
                      <Amount value={line.amount} locale={moneyLocale} size="sm" tone="plain" />
                    </LedgerCell>
                  </LedgerRow>
                ))}
                {view.income.expenseLines.map((line) => (
                  <LedgerRow key={`expense-${line.key}`}>
                    <LedgerCell>{line.label}</LedgerCell>
                    <LedgerCell align="end">{line.count}</LedgerCell>
                    <LedgerCell align="end">
                      <Amount
                        value={line.amount.negate()}
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
                {t('income.net')}
              </span>
              <Amount value={view.income.net} locale={moneyLocale} tone="plain" />
            </div>

            {view.income.transfersExcluded > 0 && (
              <p className="mt-4 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-tertiary)]">
                {t('income.transfersExcluded', { count: view.income.transfersExcluded })}
              </p>
            )}
          </Section>

          <Section title={t('cashFlow.title')} detail={t('cashFlow.detail')} className="mt-16">
            <Ledger caption={t('cashFlow.title')}>
              <LedgerHead>
                <LedgerColumn>{t('cashFlow.columns.line')}</LedgerColumn>
                <LedgerColumn align="end">{t('cashFlow.columns.amount')}</LedgerColumn>
              </LedgerHead>
              <LedgerBody>
                <LedgerRow>
                  <LedgerCell>{t('cashFlow.opening')}</LedgerCell>
                  <LedgerCell align="end">
                    <Amount
                      value={view.cashFlow.opening}
                      locale={moneyLocale}
                      size="sm"
                      tone="plain"
                    />
                  </LedgerCell>
                </LedgerRow>
                <LedgerRow>
                  <LedgerCell>{t('cashFlow.inflows')}</LedgerCell>
                  <LedgerCell align="end">
                    <Amount
                      value={view.cashFlow.inflows}
                      locale={moneyLocale}
                      size="sm"
                      tone="plain"
                    />
                  </LedgerCell>
                </LedgerRow>
                <LedgerRow>
                  <LedgerCell>{t('cashFlow.outflows')}</LedgerCell>
                  <LedgerCell align="end">
                    <Amount
                      value={view.cashFlow.outflows.negate()}
                      locale={moneyLocale}
                      size="sm"
                      tone="plain"
                    />
                  </LedgerCell>
                </LedgerRow>
                <LedgerRow>
                  <LedgerCell>{t('cashFlow.closing')}</LedgerCell>
                  <LedgerCell align="end">
                    <Amount
                      value={view.cashFlow.closing}
                      locale={moneyLocale}
                      size="sm"
                      tone="plain"
                    />
                  </LedgerCell>
                </LedgerRow>
              </LedgerBody>
            </Ledger>
          </Section>

          <Section title={t('health.title')} detail={t('health.detail')} className="mt-16">
            <div className="flex items-baseline gap-4">
              <span className="tabular text-5xl">{view.health.score}</span>
              {view.health.isPartial && <Status tone="caution">{t('health.partial')}</Status>}
            </div>

            {view.health.components.length > 0 && (
              <Ledger caption={t('health.title')} className="mt-6">
                <LedgerHead>
                  <LedgerColumn>{t('health.columns.component')}</LedgerColumn>
                  <LedgerColumn align="end">{t('health.columns.figure')}</LedgerColumn>
                  <LedgerColumn align="end">{t('health.columns.score')}</LedgerColumn>
                </LedgerHead>
                <LedgerBody>
                  {view.health.components.map((component) => (
                    <LedgerRow key={component.key}>
                      <LedgerCell>{t(`health.components.${component.key}`)}</LedgerCell>
                      <LedgerCell align="end" secondary>
                        {t(`health.units.${component.key}`, { value: component.detail })}
                      </LedgerCell>
                      <LedgerCell align="end">{Math.round(component.score)}</LedgerCell>
                    </LedgerRow>
                  ))}
                </LedgerBody>
              </Ledger>
            )}

            <p className="mt-6 max-w-[62ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
              {t('health.notACreditScore')}
            </p>
          </Section>

          <Section title={t('export.title')} detail={t('export.detail')} className="mt-16">
            <ul className="space-y-2 text-sm">
              <li>
                <a className="underline" href={`/api/reports/export?format=csv&kind=transactions`}>
                  {t('export.transactionsCsv')}
                </a>
              </li>
              <li>
                <a className="underline" href={`/api/reports/export?format=csv&kind=income`}>
                  {t('export.incomeCsv')}
                </a>
              </li>
              <li>
                <a className="underline" href={`/api/reports/export?format=json&kind=income`}>
                  {t('export.incomeJson')}
                </a>
              </li>
            </ul>
          </Section>
        </>
      )}

      <Rule className="mt-16" />
      <footer className="mt-6">
        <p className="max-w-[62ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
          {t('scopeNote')}
        </p>
      </footer>
    </Page>
  );
}
