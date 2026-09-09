import type { LineExplanation } from '@app/allocation-engine';
import { formatMoney } from '@app/domain';
import {
  Amount,
  Button,
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

import { formatPlainDate } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { PeriodStrip } from '@/components/period-strip';
import { explainPlan } from '@/server/repositories/copilot';
import { loadPlan } from '@/server/repositories/plan';
import { requireHousehold } from '@/server/session';

/**
 * The allocation plan, on the household's own rows.
 *
 * This is the screen the whole system exists to produce: not a report of what
 * happened, but an instruction for what should happen next, with every line
 * answerable. Nothing here is synthetic — a household with no data gets an empty
 * state that teaches rather than a demonstration implying money it does not have.
 */
export default async function PlanPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const view = await loadPlan(session, session.activeHouseholdId);

  // Additive by construction: the plan below renders identically whether or not
  // this returns anything.
  const narrative = await explainPlan(
    session,
    session.activeHouseholdId,
    view,
    locale === 'en' ? 'en' : 'es',
  );

  const t = await getTranslations('plan');
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';

  // Two claims are synthetic: the household never named them, the repository
  // invented them from a setting. They arrived with English placeholder labels
  // and rendered "Buffer" in the middle of a Spanish plan. Every other line is
  // named by the person who created the obligation, debt or goal, so only these
  // two need translating.
  const SYNTHETIC_LABELS: Record<string, string> = {
    buffer: t('safeToSpend.kinds.buffer'),
    'tax-reserve': t('safeToSpend.kinds.tax_reserve'),
  };
  const lineLabel = (line: { claimId: string; label: string }): string =>
    SYNTHETIC_LABELS[line.claimId] ?? line.label;

  const SYNTHETIC_LABEL_BY_ENGLISH: Record<string, string> = {
    Buffer: t('safeToSpend.kinds.buffer'),
    'Tax reserve': t('safeToSpend.kinds.tax_reserve'),
  };

  // A deduction of zero is not a claim on this money, and listing it would pad
  // the ladder with lines that mean nothing.
  const claimed = view.safeToSpend.deductions.filter((deduction) => deduction.claimed.isPositive());
  const money = (value: Parameters<typeof formatMoney>[0]) =>
    formatMoney(value, { locale: moneyLocale });

  /** Renders an engine explanation through the catalogue. The engine has no language. */
  const explain = (explanation: LineExplanation): string => {
    // The reason interpolates the same label the row shows, so a synthetic
    // claim would otherwise read "Asigna 500.00 a Buffer porque…" in Spanish.
    const label = explanation.values['label'];
    const values =
      typeof label === 'string' && label in SYNTHETIC_LABEL_BY_ENGLISH
        ? { ...explanation.values, label: SYNTHETIC_LABEL_BY_ENGLISH[label] ?? label }
        : explanation.values;
    const sentence = t(`reason.${explanation.key}`, values);
    return explanation.partialOf
      ? `${sentence} ${t('reason.partial', { requested: explanation.partialOf })}`
      : sentence;
  };

  return (
    <Page>
      <PageHeader
        title={t('title')}
        detail={t('detail')}
        actions={
          /* The plan is a suggestion until somebody decides on it. This is the
             door to that decision, and to the record of the ones already made. */
          <Link
            href="/plan/history"
            className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
          >
            {t('historyLink')}
          </Link>
        }
      />

      {view.isEmpty ? (
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
          {view.periods.length > 0 && (
            <PeriodStrip periods={view.periods} locale={locale} moneyLocale={moneyLocale} t={t} />
          )}

          <section aria-labelledby="safe-heading">
            <h2 id="safe-heading" className="sr-only">
              {t('safeToSpend.title')}
            </h2>

            <Card tone="panel" padding="lg">
              <p className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-panel-ink-secondary)] uppercase">
                {t('safeToSpend.label')}
              </p>
              <p className="mt-2" style={{ color: 'var(--color-brand)' }}>
                <Amount
                  value={view.safeToSpend.safeToSpend}
                  locale={moneyLocale}
                  tone="plain"
                  size="readout"
                />
              </p>
              <p className="mt-3 text-sm text-[color:var(--color-panel-ink-secondary)]">
                {t('basis', { incoming: money(view.plan.incoming) })}
              </p>

              {view.safeToSpend.isShortfall && (
                <p className="mt-4 text-sm text-[color:var(--color-caution)]">
                  {t('safeToSpend.shortfall', { amount: money(view.safeToSpend.shortfall) })}
                </p>
              )}
            </Card>
          </section>

          <Section
            title={t('safeToSpend.title')}
            detail={t('safeToSpend.detail')}
            className="mt-16"
          >
            {claimed.length === 0 ? (
              <EmptyState title={t('safeToSpend.emptyTitle')} body={t('safeToSpend.emptyBody')} />
            ) : (
              <Card padding="none" className="overflow-hidden px-5 sm:px-6">
                <Ledger caption={t('safeToSpend.title')}>
                  <LedgerHead>
                    <LedgerColumn>{t('safeToSpend.columns.claim')}</LedgerColumn>
                    <LedgerColumn align="end">{t('safeToSpend.columns.claimed')}</LedgerColumn>
                    <LedgerColumn align="end">{t('safeToSpend.columns.covered')}</LedgerColumn>
                  </LedgerHead>
                  <LedgerBody>
                    {claimed.map((deduction) => (
                      <LedgerRow key={deduction.kind}>
                        <LedgerCell>{t(`safeToSpend.kinds.${deduction.kind}`)}</LedgerCell>
                        <LedgerCell align="end">
                          <Amount
                            value={deduction.claimed.negate()}
                            locale={moneyLocale}
                            size="sm"
                            tone="plain"
                          />
                        </LedgerCell>
                        <LedgerCell align="end">
                          {deduction.uncovered.isPositive() ? (
                            <Status tone="caution">{money(deduction.covered)}</Status>
                          ) : (
                            <Amount
                              value={deduction.covered.negate()}
                              locale={moneyLocale}
                              size="sm"
                              tone="plain"
                            />
                          )}
                        </LedgerCell>
                      </LedgerRow>
                    ))}
                  </LedgerBody>
                </Ledger>
              </Card>
            )}
          </Section>

          {/*
            La cobertura, compromiso por compromiso.

            Va justo debajo de la escalera de deducciones porque responde a la
            pregunta que esa escalera deja abierta: no «cuánto queda» sino «cuál
            de estos pagos tiene dinero detrás». La frase de arriba es la que se
            puede leer en voz alta y actuar: hasta qué día llega lo que hay, qué
            falta, y para cuándo.
          */}
          {view.coverage.commitments.length > 0 && (
            <Section
              title={t('coverage.title')}
              detail={t('coverage.detail')}
              className="mt-16"
            >
              <Card>
                <p className="max-w-[68ch] text-pretty">
                  {view.coverage.coveredThrough
                    ? t('coverage.summaryCovered', {
                        total: money(view.coverage.totalCommitted),
                        through: formatPlainDate(view.coverage.coveredThrough, locale),
                      })
                    : t('coverage.summaryNone', {
                        total: money(view.coverage.totalCommitted),
                      })}{' '}
                  {view.coverage.mustArrive.isPositive() && view.coverage.mustArriveBy
                    ? t('coverage.summaryNeeds', {
                        amount: money(view.coverage.mustArrive),
                        by: formatPlainDate(view.coverage.mustArriveBy, locale),
                      })
                    : t('coverage.summaryEnough')}{' '}
                  {view.coverage.expectedInHorizon.isPositive() &&
                    t('coverage.summaryExpected', {
                      expected: money(view.coverage.expectedInHorizon),
                      confirmed: money(view.coverage.confirmedInHorizon),
                    })}
                </p>
              </Card>

              <Card padding="none" className="mt-4 overflow-hidden px-5 sm:px-6">
                <Ledger caption={t('coverage.title')}>
                  <LedgerHead>
                    <LedgerColumn>{t('coverage.columns.commitment')}</LedgerColumn>
                    <LedgerColumn align="end">{t('coverage.columns.amount')}</LedgerColumn>
                    <LedgerColumn>{t('coverage.columns.verdict')}</LedgerColumn>
                  </LedgerHead>
                  <LedgerBody>
                    {view.coverage.commitments.map((line) => (
                      <LedgerRow key={line.id}>
                        <LedgerCell>
                          <span className="font-medium">{line.label}</span>
                          <span className="mt-1 block text-xs text-[color:var(--color-ink-secondary)]">
                            {formatPlainDate(line.due, locale)}
                            {line.dependsOn.length > 0 &&
                              ` · ${t('coverage.dependsOn', {
                                names: line.dependsOn.map((one) => one.label).join(', '),
                              })}`}
                          </span>
                        </LedgerCell>
                        <LedgerCell align="end">
                          <Amount value={line.amount} locale={moneyLocale} size="sm" tone="plain" />
                        </LedgerCell>
                        <LedgerCell>
                          <Status
                            tone={
                              line.verdict === 'covered'
                                ? 'positive'
                                : line.verdict === 'conditional'
                                  ? 'caution'
                                  : 'negative'
                            }
                          >
                            {line.verdict === 'uncovered'
                              ? t('coverage.verdicts.uncovered', {
                                  amount: money(line.shortfall),
                                })
                              : t(`coverage.verdicts.${line.verdict}`)}
                          </Status>
                        </LedgerCell>
                      </LedgerRow>
                    ))}
                  </LedgerBody>
                </Ledger>
              </Card>
            </Section>
          )}

          {/*
            Lo que viene, al lado y nunca dentro.

            Va después del plan a propósito: primero lo que hay para repartir,
            después lo que todavía no llegó. Enseñarlo antes invitaría a leer las
            dos cifras como una sola, que es exactamente el error que esta
            sección existe para no cometer.
          */}
          {view.expected.length > 0 && (
            <Section title={t('expected.title')} detail={t('expected.detail')} className="mt-16">
              <Card padding="none" className="overflow-hidden">
                <div className="px-5 sm:px-6">
                  <Ledger caption={t('expected.title')}>
                    <LedgerHead>
                      <LedgerColumn>{t('expected.columns.what')}</LedgerColumn>
                      <LedgerColumn>{t('expected.columns.from')}</LedgerColumn>
                      <LedgerColumn>{t('expected.columns.when')}</LedgerColumn>
                      <LedgerColumn align="end">{t('expected.columns.amount')}</LedgerColumn>
                    </LedgerHead>
                    <LedgerBody>
                      {view.expected.map((entry) => (
                        <LedgerRow key={entry.id}>
                          <LedgerCell>{entry.name}</LedgerCell>
                          <LedgerCell>{entry.source ?? '—'}</LedgerCell>
                          <LedgerCell>
                            {entry.expectedOn ?? t('expected.unknownDate')}
                            {!entry.isConfirmed && ` · ${t('expected.estimated')}`}
                          </LedgerCell>
                          <LedgerCell align="end">{money(entry.amount)}</LedgerCell>
                        </LedgerRow>
                      ))}
                    </LedgerBody>
                  </Ledger>
                </div>
              </Card>
              {/*
                Y a qué meta le sirve cada cobro.

                El préstamo que devuelven el 10 de diciembre le sirve al viaje
                del 20 y no al carro de marzo: llega a tiempo para el primero, y
                para cuando llegue marzo ese dinero ya se gastó. Se dice al lado
                y nunca sumado al saldo de la meta — el plan de arriba se hace
                con lo que entró.
              */}
              {view.expectedByGoal.length > 0 && (
                <div className="mt-6 flex flex-col gap-2">
                  <h3 className="text-sm font-medium text-[color:var(--color-ink)]">
                    {t('expected.towardGoals')}
                  </h3>
                  {view.expectedByGoal.map((entry) => (
                    <div
                      key={entry.goalId}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-(--radius-md) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-4 py-3 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium text-[color:var(--color-ink)]">
                        {entry.name}
                      </span>
                      <span className="text-[color:var(--color-ink-secondary)]">
                        {entry.receipts.map((one) => one.name).join(' · ')}
                      </span>
                      <span className="tabular shrink-0 text-[color:var(--color-ink)]">
                        {money(entry.total)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <p className="mt-3 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
                {t('expected.note')}
              </p>
            </Section>
          )}

          <Section title={t('lines.title')} detail={t('lines.detail')} className="mt-16">
            {view.plan.lines.length === 0 ? (
              <EmptyState title={t('lines.emptyTitle')} body={t('lines.emptyBody')} />
            ) : (
              <Card padding="none" className="overflow-hidden">
                <div className="px-5 sm:px-6">
                  <Ledger caption={t('lines.title')}>
                    <LedgerHead>
                      <LedgerColumn>{t('lines.columns.item')}</LedgerColumn>
                      <LedgerColumn>{t('lines.columns.reason')}</LedgerColumn>
                      <LedgerColumn align="end">{t('lines.columns.requested')}</LedgerColumn>
                      <LedgerColumn align="end">{t('lines.columns.allocated')}</LedgerColumn>
                    </LedgerHead>
                    <LedgerBody>
                      {view.plan.lines.map((line) => (
                        <LedgerRow key={line.claimId}>
                          <LedgerCell>{lineLabel(line)}</LedgerCell>
                          <LedgerCell secondary>{explain(line.explanation)}</LedgerCell>
                          <LedgerCell align="end">
                            <Amount
                              value={line.requested}
                              locale={moneyLocale}
                              size="sm"
                              tone="plain"
                            />
                          </LedgerCell>
                          <LedgerCell align="end">
                            <Amount
                              value={line.allocated}
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
                    {t('lines.unallocated')}
                  </span>
                  <Amount value={view.plan.unallocated} locale={moneyLocale} tone="plain" />
                </div>
              </Card>
            )}
          </Section>

          {narrative.state === 'answered' && (
            <Section title={t('copilot.title')} detail={t('copilot.detail')} className="mt-16">
              <Card tone="sunk">
                <p className="max-w-[62ch] text-pretty">{narrative.summary}</p>

                {narrative.cautions.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {narrative.cautions.map((caution) => (
                      <li
                        key={caution}
                        className="max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]"
                      >
                        {caution}
                      </li>
                    ))}
                  </ul>
                )}

                <p className="mt-6 max-w-[62ch] text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
                  {t('copilot.disclaimer')}
                </p>
              </Card>
            </Section>
          )}

          {narrative.state === 'declined' && (
            <p className="mt-16 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              {t(`copilot.declined.${narrative.reason}`)}
            </p>
          )}

          {view.debtOrder.length > 0 && (
            <Section title={t('debtOrder.title')} detail={t('debtOrder.detail')} className="mt-16">
              <Card padding="none">
                <ol>
                  {view.debtOrder.map((entry, index) => (
                    <li
                      key={entry.id}
                      className="flex items-center gap-4 border-b border-[color:var(--color-rule)] px-5 py-3.5 text-sm last:border-b-0 sm:px-6"
                    >
                      <span className="readout flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-brand-sunk)] text-xs text-[color:var(--color-brand-strong)]">
                        {index + 1}
                      </span>
                      <span className="font-medium">{entry.name}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            </Section>
          )}

          <Section title={t('rules.title')} className="mt-16">
            {view.ruleNotes.length === 0 && view.skippedRules.length === 0 ? (
              <p className="text-sm text-[color:var(--color-ink-secondary)]">{t('rules.empty')}</p>
            ) : (
              <>
                <ul className="space-y-2">
                  {view.ruleNotes.map((note, index) => (
                    <li key={`${note.key}-${String(index)}`} className="text-sm">
                      {t(`rules.notes.${note.key}`, note.values)}
                    </li>
                  ))}
                </ul>

                {view.skippedRules.length > 0 && (
                  <div className="mt-6">
                    <p className="gradation-label uppercase">{t('rules.skippedTitle')}</p>
                    <ul className="mt-2 space-y-1">
                      {view.skippedRules.map((rule) => (
                        <li
                          key={rule.name}
                          className="text-sm text-[color:var(--color-ink-secondary)]"
                        >
                          {t('rules.skipped', { name: rule.name, reason: rule.reason })}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
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
