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

import { SignOutButton } from '@/components/sign-out-button';
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

  const t = await getTranslations('plan');
  const common = await getTranslations('common');
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';
  const money = (value: Parameters<typeof formatMoney>[0]) =>
    formatMoney(value, { locale: moneyLocale });

  const householdName =
    session.households.find((household) => household.id === session.activeHouseholdId)?.name ?? '';

  /** Renders an engine explanation through the catalogue. The engine has no language. */
  const explain = (explanation: LineExplanation): string => {
    const sentence = t(`reason.${explanation.key}`, explanation.values);
    return explanation.partialOf
      ? `${sentence} ${t('reason.partial', { requested: explanation.partialOf })}`
      : sentence;
  };

  return (
    <Page>
      <header className="mb-14 flex items-baseline justify-between gap-6">
        <div className="flex items-baseline gap-3">
          <span className="gradation-label uppercase">{common('appName')}</span>
          <span className="text-sm text-[color:var(--color-ink-secondary)]">{householdName}</span>
        </div>
        <SignOutButton locale={locale} label={t('signOut')} />
      </header>

      <PageHeader title={t('title')} detail={t('detail')} />

      {view.isEmpty ? (
        <EmptyState
          title={t('empty.title')}
          body={t('empty.body')}
          action={<Button size="lg">{t('empty.action')}</Button>}
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
            <Ledger caption={t('safeToSpend.title')}>
              <LedgerHead>
                <LedgerColumn>{t('safeToSpend.columns.claim')}</LedgerColumn>
                <LedgerColumn align="end">{t('safeToSpend.columns.claimed')}</LedgerColumn>
                <LedgerColumn align="end">{t('safeToSpend.columns.covered')}</LedgerColumn>
              </LedgerHead>
              <LedgerBody>
                {view.safeToSpend.deductions
                  .filter((deduction) => deduction.claimed.isPositive())
                  .map((deduction) => (
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
                        <LedgerCell>{line.label}</LedgerCell>
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
