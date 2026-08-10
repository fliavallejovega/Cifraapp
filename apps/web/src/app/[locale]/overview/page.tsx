import {
  Amount,
  Button,
  EmptyState,
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
import { formatMoney, Money } from '@app/domain';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { SignOutButton } from '@/components/sign-out-button';
import { Link } from '@/i18n/navigation';
import { loadPosition } from '@/server/repositories/position';
import { requireHousehold } from '@/server/session';

/**
 * The first viewport, on real data.
 *
 * Per DESIGN.md: the available level against a marked scale with a named
 * threshold, the figure as a read-out beneath it, then the claims against it
 * itemized. Nothing here is synthetic — an empty household gets an empty state
 * that teaches, not a demonstration that would imply data the user does not
 * have.
 */
export default async function OverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const position = await loadPosition(session, session.activeHouseholdId);

  const t = await getTranslations('overview');
  const common = await getTranslations('common');
  const format = await getFormatter();
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';

  const householdName =
    session.households.find((household) => household.id === session.activeHouseholdId)?.name ?? '';

  const thresholds: GaugeThreshold[] = position.bufferMinimum.isZero()
    ? []
    : [{ at: position.bufferMinimum, label: t('gauge.buffer'), kind: 'buffer' }];

  // A gauge needs a real ceiling. With no liquid balance there is nothing to
  // measure against, and drawing an empty instrument would be theatre.
  const showGauge = !position.isEmpty && position.liquid.isPositive();

  return (
    <Page>
      <header className="mb-14 flex items-baseline justify-between gap-6">
        <div className="flex items-baseline gap-3">
          <span className="gradation-label uppercase">{common('appName')}</span>
          <span className="text-sm text-[color:var(--color-ink-secondary)]">{householdName}</span>
        </div>
        <SignOutButton locale={locale} label={t('signOut')} />
      </header>

      <section aria-labelledby="level-heading">
        <h1 id="level-heading" className="sr-only">
          {t('title')}
        </h1>

        {position.isEmpty ? (
          <EmptyState
            title={t('empty.title')}
            body={t('empty.body')}
            action={<Button size="lg">{t('empty.action')}</Button>}
          />
        ) : (
          <>
            {showGauge && (
              <Gauge
                value={position.available}
                max={position.liquid}
                label={t('gauge.label')}
                thresholds={thresholds}
                locale={moneyLocale}
                tone={position.available.isNegative() ? 'negative' : 'neutral'}
              />
            )}

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
                  <dt className="gradation-label uppercase">{t('stats.liquid')}</dt>
                  <dd className="mt-1">
                    <Amount value={position.liquid} locale={moneyLocale} size="lg" tone="plain" />
                  </dd>
                </div>
                <div>
                  <dt className="gradation-label uppercase">{t('stats.committed')}</dt>
                  <dd className="mt-1">
                    <Amount
                      value={position.committed}
                      locale={moneyLocale}
                      size="lg"
                      tone="plain"
                    />
                  </dd>
                </div>
              </dl>
            </div>

            <p className="mt-6 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              {t('gauge.explanation')}
            </p>
          </>
        )}
      </section>

      {!position.isEmpty && (
        <Section title={t('claims.title')} detail={t('claims.detail')} className="mt-16">
          {position.claims.length === 0 ? (
            <EmptyState title={t('claims.emptyTitle')} body={t('claims.emptyBody')} />
          ) : (
            <>
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
                      <LedgerCell>{claim.name}</LedgerCell>
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

              <div className="mt-4 flex items-baseline justify-between">
                <span className="text-sm text-[color:var(--color-ink-secondary)]">
                  {t('claims.total')}
                </span>
                <Amount value={position.committed.negate()} locale={moneyLocale} tone="plain" />
              </div>
            </>
          )}
        </Section>
      )}

      {!position.isEmpty && (
        <Section title="" className="mt-16">
          <Link href="/plan" className="text-sm underline underline-offset-4 hover:no-underline">
            {t('planLink')}
          </Link>
        </Section>
      )}

      <Rule className="mt-16" />
      <footer className="mt-6">
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

void Money;
