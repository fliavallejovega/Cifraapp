import { formatMoney, Money } from '@app/domain';
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
  Stat,
  Status,
} from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { formatPlainDate, trimRate } from '@/lib/format';
import { loadHouseholdContext } from '@/server/household-context';
import { loadSettings } from '@/server/repositories/administration';
import { loadReservePosition, loadTaxProfile } from '@/server/repositories/tax-profile';
import { estimateTaxReserve } from '@/server/repositories/tax';
import { requireHousehold } from '@/server/session';

/**
 * The part of what you were paid that was never yours.
 *
 * The engine can compute a reserve from a published rule set, and there is no
 * published rule set — so the screen falls back to the household's own rate and
 * says exactly which one it is using. That distinction is the whole point: «we
 * calculated 27% under Panamanian law» and «you told us 25%» are different
 * claims, and only one of them is currently available.
 *
 * What is held is read from actual reserve accounts, not from a notional
 * figure. A number in a column somebody can spend is not a reserve; it is an
 * intention.
 */
export default async function TaxReservePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const householdId = session.activeHouseholdId;
  const context = loadHouseholdContext(session, householdId, locale);

  const [profile, settings] = await Promise.all([
    loadTaxProfile(session, householdId),
    loadSettings(session, householdId, context.currency),
  ]);

  const t = await getTranslations('taxReserve');

  if (!profile) {
    return (
      <Page>
        <PageHeader title={t('title')} detail={t('detail')} />
        <Card>
          <EmptyState
            title={t('noProfile.title')}
            body={t('noProfile.body')}
            action={
              <Link
                href="/tax"
                className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
              >
                {t('noProfile.action')}
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  // `MM-DD` for this calendar year. A household whose fiscal year has not begun
  // yet is still inside the previous one.
  const year = Number(context.today.slice(0, 4));
  const candidate = `${String(year)}-${profile.fiscalYearStart}`;
  const fiscalYearStart = (
    candidate <= context.today ? candidate : `${String(year - 1)}-${profile.fiscalYearStart}`
  ) as typeof context.today;

  const position = await loadReservePosition(
    session,
    householdId,
    context.currency,
    fiscalYearStart,
  );

  // Asked, and expected to be null: no rule set is published. The screen says
  // so rather than leaving a blank where a figure should be.
  const computed = await estimateTaxReserve(session, householdId, {
    on: context.today,
    projectedAnnualIncome: position.incomeToDate,
    incomeToDate: position.incomeToDate,
    reservedToDate: position.held,
  });

  const rate = settings.taxReserveRate;
  const target = rate
    ? position.incomeToDate.percentage(trimRate(rate))
    : Money.zero(context.currency);
  const difference = target.subtract(position.held);

  return (
    <Page>
      <div className="mb-6">
        <Link
          href="/tax"
          className="text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)] hover:decoration-[color:var(--color-brand)]"
        >
          {t('back')}
        </Link>
      </div>

      <PageHeader title={t('title')} detail={t('detail')} />

      {computed === null && (
        <div className="mb-8">
          <Problem title={t('notPublished.title')} body={t('notPublished.body')} />
        </div>
      )}

      <Section title={t('own.title')} detail={t('own.detail')}>
        {rate === null ? (
          <Card>
            <EmptyState
              title={t('own.noRate')}
              action={
                <Link
                  href="/settings"
                  className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
                >
                  {t('own.setRate')}
                </Link>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <Stat label={t('own.rate')}>{trimRate(rate)}%</Stat>
            </Card>
            <Card>
              <Stat label={t('own.onIncome')}>
                {formatMoney(position.incomeToDate, { locale: context.moneyLocale })}
              </Stat>
            </Card>
            <Card>
              <Stat label={t('own.shouldHold')}>
                {formatMoney(target, { locale: context.moneyLocale })}
              </Stat>
            </Card>
            <Card>
              <Stat label={t('own.held')}>
                {formatMoney(position.held, { locale: context.moneyLocale })}
              </Stat>
            </Card>
          </div>
        )}

        {rate !== null && (
          <p className="mt-6">
            {difference.isPositive() ? (
              <Status tone="caution">
                {t('own.missing')} {formatMoney(difference, { locale: context.moneyLocale })}
              </Status>
            ) : (
              <Status tone="positive">
                {t('own.surplus')} {formatMoney(difference.abs(), { locale: context.moneyLocale })}
              </Status>
            )}
          </p>
        )}

        {computed === null && (
          <p className="mt-6 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {t('notPublished.meanwhile')}
          </p>
        )}
      </Section>

      {/*
        La cifra fiscal que sí se puede enseñar, cobro a cobro.

        No sale de las reglas de Panamá —siguen sin publicar, y el aviso de
        arriba lo dice— sino de la tasa que esta casa declaró, aplicada a un
        cobro concreto en una fecha concreta y congelada ahí. Eso la hace
        verificable línea por línea, que es exactamente lo que una cifra sacada
        de un borrador sin revisar nunca podría ser.
      */}
      <Section
        title={t('reserved.title')}
        detail={t('reserved.detail')}
        className="mt-12"
      >
        {position.receipts.length === 0 ? (
          <Card>
            <EmptyState
              title={t('reserved.emptyTitle')}
              body={t('reserved.emptyBody')}
              action={
                <Link
                  href="/income"
                  className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
                >
                  {t('reserved.action')}
                </Link>
              }
            />
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <Stat label={t('reserved.live')} detail={t('reserved.liveDetail')}>
                  {formatMoney(position.reservedLive, { locale: context.moneyLocale })}
                </Stat>
              </Card>
              <Card>
                <Stat label={t('reserved.released')} detail={t('reserved.releasedDetail')}>
                  {formatMoney(position.reservedReleased, { locale: context.moneyLocale })}
                </Stat>
              </Card>
            </div>

            <Card padding="none" className="mt-4 overflow-hidden px-5 sm:px-6">
              <Ledger caption={t('reserved.title')}>
                <LedgerHead>
                  <LedgerColumn>{t('reserved.columns.receipt')}</LedgerColumn>
                  <LedgerColumn align="end">{t('reserved.columns.collected')}</LedgerColumn>
                  <LedgerColumn align="end">{t('reserved.columns.reserved')}</LedgerColumn>
                </LedgerHead>
                <LedgerBody>
                  {position.receipts.map((receipt) => (
                    <LedgerRow key={receipt.id} muted={receipt.isReleased}>
                      <LedgerCell>
                        <span className="font-medium">{receipt.name}</span>
                        <span className="mt-1 block text-xs text-[color:var(--color-ink-secondary)]">
                          {formatPlainDate(receipt.receivedOn, locale)}
                          {receipt.rate ? ` · ${trimRate(receipt.rate)}%` : ''}
                          {receipt.isReleased ? ` · ${t('reserved.paid')}` : ''}
                        </span>
                      </LedgerCell>
                      <LedgerCell align="end">
                        <Amount value={receipt.amount} locale={context.moneyLocale} size="sm" tone="plain" />
                      </LedgerCell>
                      <LedgerCell align="end">
                        <Amount value={receipt.reserved} locale={context.moneyLocale} size="sm" tone="plain" />
                      </LedgerCell>
                    </LedgerRow>
                  ))}
                </LedgerBody>
              </Ledger>
            </Card>
          </>
        )}
      </Section>

      <Section title={t('accounts.title')} detail={t('accounts.detail')} className="mt-12">
        <Card>
          {position.accounts.length === 0 ? (
            <EmptyState
              title={t('accounts.empty')}
              action={
                <Link
                  href="/accounts"
                  className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
                >
                  {t('accounts.create')}
                </Link>
              }
            />
          ) : (
            <ul className="flex flex-col">
              {position.accounts.map((account) => (
                <li
                  key={account.id}
                  className="flex items-baseline justify-between gap-3 border-b border-[color:var(--color-rule)] py-3 last:border-b-0"
                >
                  <span className="text-sm text-[color:var(--color-ink)]">{account.name}</span>
                  <span className="readout text-sm text-[color:var(--color-ink)] tabular-nums">
                    {formatMoney(account.balance, { locale: context.moneyLocale })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
    </Page>
  );
}
