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
  Page,
  PageHeader,
  Readout,
  Rule,
  Section,
  Status,
} from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AppNav } from '@/components/app-nav';
import { Link } from '@/i18n/navigation';
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

  const householdName =
    session.households.find((household) => household.id === session.activeHouseholdId)?.name ?? '';

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
      <AppNav locale={locale} householdName={householdName} />

      <PageHeader title={t('title')} detail={t('detail')} />

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
          <section aria-labelledby="safe-heading">
            <h2 id="safe-heading" className="sr-only">
              {t('safeToSpend.title')}
            </h2>

            <Readout
              value={view.safeToSpend.safeToSpend}
              label={t('safeToSpend.label')}
              detail={t('basis', { incoming: money(view.plan.incoming) })}
              locale={moneyLocale}
            />

            {view.safeToSpend.isShortfall && (
              <p className="mt-4 text-sm text-[color:var(--color-ink-secondary)]">
                {t('safeToSpend.shortfall', { amount: money(view.safeToSpend.shortfall) })}
              </p>
            )}
          </section>

          <Section
            title={t('safeToSpend.title')}
            detail={t('safeToSpend.detail')}
            className="mt-16"
          >
            {claimed.length === 0 ? (
              <EmptyState title={t('safeToSpend.emptyTitle')} body={t('safeToSpend.emptyBody')} />
            ) : (
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
            )}
          </Section>

          <Section title={t('lines.title')} detail={t('lines.detail')} className="mt-16">
            {view.plan.lines.length === 0 ? (
              <EmptyState title={t('lines.emptyTitle')} body={t('lines.emptyBody')} />
            ) : (
              <>
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

                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-sm text-[color:var(--color-ink-secondary)]">
                    {t('lines.unallocated')}
                  </span>
                  <Amount value={view.plan.unallocated} locale={moneyLocale} tone="plain" />
                </div>
              </>
            )}
          </Section>

          {narrative.state === 'answered' && (
            <Section title={t('copilot.title')} detail={t('copilot.detail')} className="mt-16">
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
            </Section>
          )}

          {narrative.state === 'declined' && (
            <p className="mt-16 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              {t(`copilot.declined.${narrative.reason}`)}
            </p>
          )}

          {view.debtOrder.length > 0 && (
            <Section title={t('debtOrder.title')} detail={t('debtOrder.detail')} className="mt-16">
              <ol className="space-y-2">
                {view.debtOrder.map((entry, index) => (
                  <li key={entry.id} className="flex gap-4 text-sm">
                    <span className="gradation-label tabular">{index + 1}</span>
                    <span>{entry.name}</span>
                  </li>
                ))}
              </ol>
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
