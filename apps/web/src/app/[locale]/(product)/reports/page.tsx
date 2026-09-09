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
  Card,
  Page,
  PageHeader,
  Rule,
  Section,
  Status,
} from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

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
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';

  const lineLabel = (line: { key: string; label: string }): string =>
    line.key === 'uncategorized' ? t('income.uncategorized') : line.label;

  // Column headings over nothing are not an empty state.
  const hasIncomeLines = view.income.incomeLines.length > 0 || view.income.expenseLines.length > 0;
  const money = (value: Parameters<typeof formatMoney>[0]) =>
    formatMoney(value, { locale: moneyLocale });

  return (
    <Page>
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

            <Card tone="panel" padding="lg">
              <p className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-panel-ink-secondary)] uppercase">
                {t('netWorth.label')}
              </p>
              <p className="mt-2" style={{ color: 'var(--color-brand)' }}>
                <Amount
                  value={view.netWorth.netWorth}
                  locale={moneyLocale}
                  tone="plain"
                  size="readout"
                />
              </p>
              <p className="mt-3 text-sm text-[color:var(--color-panel-ink-secondary)]">
                {t('netWorth.detail', {
                  assets: money(view.netWorth.assets),
                  liabilities: money(view.netWorth.liabilities),
                })}
              </p>
            </Card>
          </section>

          {/*
            En qué se gastó más y en qué menos que el mes pasado.

            Va antes del estado de resultados porque responde antes: «$340 en
            restaurantes» no significa nada suelto, y «ciento veinte más que el
            mes pasado» es una conversación. Y lo que bajó se dice aparte porque
            es la única mitad que se puede convertir en decisión — ese dinero
            existe y la casa elige a dónde va.
          */}
          <Section title={t('shift.title')} detail={t('shift.detail')} className="mt-16">
            {!view.shift.comparable ? (
              <EmptyState title={t('shift.noneTitle')} body={t('shift.noneBody')} />
            ) : view.shift.spentMore.length === 0 && view.shift.spentLess.length === 0 ? (
              <EmptyState title={t('shift.sameTitle')} body={t('shift.sameBody')} />
            ) : (
              <div className="grid gap-6 sm:grid-cols-2">
                {(
                  [
                    ['more', view.shift.spentMore, view.shift.added],
                    ['less', view.shift.spentLess, view.shift.freed],
                  ] as const
                ).map(([side, lines, total]) =>
                  lines.length === 0 ? null : (
                    <Card key={side}>
                      <h3 className="text-sm font-medium text-[color:var(--color-ink)]">
                        {t(`shift.${side}Title`)}
                      </h3>
                      <div className="mt-3 flex flex-col gap-1.5 text-sm">
                        {lines.map((line) => (
                          <div key={line.key} className="flex items-baseline justify-between gap-4">
                            <span className="min-w-0 truncate text-[color:var(--color-ink-secondary)]">
                              {line.label}
                              {line.isNew && ` · ${t('shift.isNew')}`}
                            </span>
                            <span className="tabular shrink-0 text-[color:var(--color-ink)]">
                              {side === 'more' ? '+' : '−'}
                              {money(line.change.abs())}
                              {line.changeRate !== null && (
                                <span className="ml-2 text-[color:var(--color-ink-tertiary)]">
                                  {Math.abs(line.changeRate).toFixed(0)}%
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 border-t border-[color:var(--color-rule)] pt-3 text-sm">
                        <span className="text-[color:var(--color-ink-secondary)]">
                          {t(`shift.${side}Total`)}
                        </span>{' '}
                        <span className="tabular font-medium text-[color:var(--color-ink)]">
                          {money(total)}
                        </span>
                      </p>
                      {side === 'less' && (
                        <p className="mt-2 text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
                          {t('shift.freedNote')}
                        </p>
                      )}
                    </Card>
                  ),
                )}
              </div>
            )}
          </Section>

          <Section title={t('income.title')} detail={t('income.detail')} className="mt-16">
            {hasIncomeLines ? (
              <Card padding="none" className="overflow-hidden">
                <div className="px-5 sm:px-6">
                  <Ledger caption={t('income.title')}>
                    <LedgerHead>
                      <LedgerColumn>{t('income.columns.category')}</LedgerColumn>
                      <LedgerColumn align="end">{t('income.columns.transactions')}</LedgerColumn>
                      <LedgerColumn align="end">{t('income.columns.amount')}</LedgerColumn>
                    </LedgerHead>
                    <LedgerBody>
                      {view.income.incomeLines.map((line) => (
                        <LedgerRow key={`income-${line.key}`}>
                          <LedgerCell>{lineLabel(line)}</LedgerCell>
                          <LedgerCell align="end">{line.count}</LedgerCell>
                          <LedgerCell align="end">
                            <Amount
                              value={line.amount}
                              locale={moneyLocale}
                              size="sm"
                              tone="plain"
                            />
                          </LedgerCell>
                        </LedgerRow>
                      ))}
                      {view.income.expenseLines.map((line) => (
                        <LedgerRow key={`expense-${line.key}`}>
                          <LedgerCell>{lineLabel(line)}</LedgerCell>
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
                </div>

                <div className="flex items-baseline justify-between border-t border-[color:var(--color-rule)] bg-[color:var(--color-ground-sunk)] px-5 py-3.5 sm:px-6">
                  <span className="text-sm font-medium text-[color:var(--color-ink-secondary)]">
                    {t('income.net')}
                  </span>
                  <Amount value={view.income.net} locale={moneyLocale} tone="plain" />
                </div>
              </Card>
            ) : (
              <EmptyState title={t('income.emptyTitle')} body={t('income.emptyBody')} />
            )}

            {view.income.transfersExcluded > 0 && (
              <p className="mt-4 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-tertiary)]">
                {t('income.transfersExcluded', { count: view.income.transfersExcluded })}
              </p>
            )}
          </Section>

          <Section title={t('cashFlow.title')} detail={t('cashFlow.detail')} className="mt-16">
            <Card padding="none" className="overflow-hidden px-5 sm:px-6">
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
            </Card>
          </Section>

          <Section title={t('health.title')} detail={t('health.detail')} className="mt-16">
            <Card>
              <div className="flex items-baseline gap-4">
                <span className="readout text-5xl text-[color:var(--color-ink)]">
                  {view.health.score}
                </span>
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
            </Card>
          </Section>

          <Section title={t('export.title')} detail={t('export.detail')} className="mt-16">
            <ul className="space-y-2.5 text-sm">
              {(
                [
                  ['csv', 'transactions', t('export.transactionsCsv')],
                  ['csv', 'income', t('export.incomeCsv')],
                  ['json', 'income', t('export.incomeJson')],
                ] as const
              ).map(([format, kind, label]) => (
                <li key={`${format}-${kind}-${label}`}>
                  <a
                    className="font-medium text-[color:var(--color-ink)] underline decoration-[color:var(--color-brand)] underline-offset-4 hover:decoration-2"
                    href={`/api/reports/export?format=${format}&kind=${kind}`}
                  >
                    {label}
                  </a>
                </li>
              ))}
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
