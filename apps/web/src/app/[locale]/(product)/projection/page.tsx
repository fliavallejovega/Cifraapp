import { formatMoney } from '@app/domain';
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
  Section,
  Stat,
  Status,
} from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { formatPlainDate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadBaseline } from '@/server/repositories/baseline';
import { projectBaseline } from '@/server/repositories/projection';
import { requireHousehold } from '@/server/session';

/**
 * The months ahead, if nothing changes.
 *
 * Deterministic and boring on purpose. It says what follows from these
 * assumptions, and the assumptions are printed at the bottom rather than
 * implied — «no new purchases, no inflation, no salary changes» is what turns
 * this from a forecast nobody should trust into arithmetic anybody can check.
 *
 * «You do not run out of money» is stated with its caveat attached, because
 * inside a twelve-month horizon it can simply mean the horizon is shorter than
 * the problem.
 */

const HORIZONS = [12, 24, 60] as const;

export default async function ProjectionPage({
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

  const { baseline, hasData } = await loadBaseline(
    session,
    session.activeHouseholdId,
    context.currency,
    context.today,
  );

  const t = await getTranslations('projection');

  if (!hasData) {
    return (
      <Page>
        <PageHeader title={t('title')} detail={t('detail')} />
        <Card>
          <EmptyState
            title={t('empty.title')}
            body={t('empty.body')}
            action={
              <Link
                href="/income"
                className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
              >
                {t('empty.action')}
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  const requested = Number(single(query['months']));
  const horizon = HORIZONS.includes(requested as (typeof HORIZONS)[number]) ? requested : 24;

  const projection = projectBaseline(baseline, horizon);

  return (
    <Page>
      <PageHeader
        title={t('title')}
        detail={t('detail')}
        actions={
          <nav aria-label={t('horizon.label')} className="flex flex-wrap gap-3">
            {HORIZONS.map((months) => (
              <a
                key={months}
                href={`/${locale}/projection?months=${String(months)}`}
                aria-current={months === horizon ? 'page' : undefined}
                className={[
                  'text-sm underline decoration-[color:var(--color-rule-strong)] underline-offset-4',
                  months === horizon
                    ? 'font-semibold text-[color:var(--color-brand-ink)] decoration-[color:var(--color-brand)]'
                    : 'text-[color:var(--color-ink-secondary)] hover:text-[color:var(--color-ink)]',
                ].join(' ')}
              >
                {t(`horizon.${months}`)}
              </a>
            ))}
          </nav>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label={t('stats.endingLiquid')}>
            {formatMoney(projection.endingLiquid, { locale: context.moneyLocale })}
          </Stat>
        </Card>
        <Card>
          <Stat label={t('stats.endingDebt')}>
            {formatMoney(projection.endingDebt, { locale: context.moneyLocale })}
          </Stat>
        </Card>
        <Card>
          <Stat label={t('stats.endingNetWorth')}>
            {formatMoney(projection.endingNetWorth, { locale: context.moneyLocale })}
          </Stat>
        </Card>
        <Card>
          <Stat label={t('stats.totalInterest')}>
            {formatMoney(projection.totalInterest, { locale: context.moneyLocale })}
          </Stat>
        </Card>
      </div>

      <Section title={t('runway.title')} className="mt-12">
        <Card>
          <div className="flex flex-col gap-3">
            {projection.runwayMonths === null ? (
              <Status tone="positive">{t('runway.safe')}</Status>
            ) : (
              <Status tone="negative">
                {t('runway.months', { count: projection.runwayMonths })}
                {projection.firstShortfallMonth &&
                  ` · ${formatPlainDate(projection.firstShortfallMonth, locale)}`}
              </Status>
            )}
            <p className="max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              {t('runway.note')}
            </p>
          </div>
        </Card>
      </Section>

      <Section title={t('table.title')} className="mt-12">
        <Card padding="none">
          <div className="overflow-x-auto">
            <Ledger caption={t('table.title')}>
              <LedgerHead>
                <LedgerColumn>{t('table.month')}</LedgerColumn>
                <LedgerColumn align="end">{t('table.income')}</LedgerColumn>
                <LedgerColumn align="end">{t('table.expenses')}</LedgerColumn>
                <LedgerColumn align="end">{t('table.debt')}</LedgerColumn>
                <LedgerColumn align="end">{t('table.net')}</LedgerColumn>
                <LedgerColumn align="end">{t('table.liquid')}</LedgerColumn>
              </LedgerHead>
              <LedgerBody>
                {projection.months.map((month) => (
                  <LedgerRow key={month.month} muted={month.liquid.isNegative()}>
                    <LedgerCell>
                      <span className="readout text-xs whitespace-nowrap">
                        {formatPlainDate(month.month, locale)}
                      </span>
                    </LedgerCell>
                    <LedgerCell align="end">
                      <Amount
                        value={month.income}
                        locale={context.moneyLocale}
                        size="sm"
                        tone="plain"
                      />
                    </LedgerCell>
                    <LedgerCell align="end">
                      <Amount
                        value={month.expenses}
                        locale={context.moneyLocale}
                        size="sm"
                        tone="plain"
                      />
                    </LedgerCell>
                    <LedgerCell align="end">
                      <Amount
                        value={month.debtPayments}
                        locale={context.moneyLocale}
                        size="sm"
                        tone="plain"
                      />
                    </LedgerCell>
                    <LedgerCell align="end">
                      <Amount value={month.netCashFlow} locale={context.moneyLocale} size="sm" />
                    </LedgerCell>
                    <LedgerCell align="end">
                      <Amount value={month.liquid} locale={context.moneyLocale} size="sm" />
                    </LedgerCell>
                  </LedgerRow>
                ))}
              </LedgerBody>
            </Ledger>
          </div>
        </Card>
      </Section>

      <Section title={t('assumptions.title')} className="mt-12">
        <Card tone="sunk">
          <ul className="flex flex-col gap-2 text-sm text-[color:var(--color-ink-secondary)]">
            <li>
              {t('assumptions.income', {
                amount: formatMoney(baseline.monthlyIncome, { locale: context.moneyLocale }),
              })}
            </li>
            <li>
              {t('assumptions.expenses', {
                amount: formatMoney(baseline.monthlyExpenses, { locale: context.moneyLocale }),
              })}
            </li>
            <li>{t('assumptions.debts', { count: baseline.debts.length })}</li>
          </ul>
          <p className="mt-4 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {t('assumptions.note')}
          </p>
        </Card>
      </Section>
    </Page>
  );
}

function single(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
