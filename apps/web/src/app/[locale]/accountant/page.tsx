import {
  EmptyState,
  Ledger,
  LedgerBody,
  LedgerCell,
  LedgerColumn,
  LedgerHead,
  LedgerRow,
  Page,
  PageHeader,
  Rule,
  Status,
} from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SignOutButton } from '@/components/sign-out-button';
import { Link } from '@/i18n/navigation';
import { listClients } from '@/server/repositories/accountant';
import { requireSession } from '@/server/session';

/**
 * The accountant's client list.
 *
 * Everything on it comes from grants the households made. A person with no
 * grants sees an empty state explaining that a household has to invite them —
 * not an error, and not a request to contact sales. Having no clients is a
 * perfectly ordinary state for an accountant who has just signed up.
 */
export default async function AccountantPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireSession(locale);
  const clients = await listClients(session);

  const t = await getTranslations('accountant');
  const common = await getTranslations('common');

  return (
    <Page>
      <header className="mb-14 flex items-baseline justify-between gap-6">
        <div className="flex items-baseline gap-3">
          <span className="gradation-label uppercase">{common('appName')}</span>
          <span className="text-sm text-[color:var(--color-ink-secondary)]">{t('title')}</span>
        </div>
        <SignOutButton locale={locale} label={t('signOut')} />
      </header>

      <PageHeader title={t('clients.title')} detail={t('clients.detail')} />

      {clients.length === 0 ? (
        <EmptyState title={t('clients.empty.title')} body={t('clients.empty.body')} />
      ) : (
        <Ledger caption={t('clients.title')}>
          <LedgerHead>
            <LedgerColumn>{t('clients.columns.household')}</LedgerColumn>
            <LedgerColumn>{t('clients.columns.scope')}</LedgerColumn>
            <LedgerColumn align="end">{t('clients.columns.uncategorized')}</LedgerColumn>
            <LedgerColumn align="end">{t('clients.columns.requests')}</LedgerColumn>
            <LedgerColumn align="end">{t('clients.columns.lastClose')}</LedgerColumn>
          </LedgerHead>
          <LedgerBody>
            {clients.map((client) => (
              <LedgerRow key={client.householdId}>
                <LedgerCell>
                  <Link
                    href={`/accountant/${client.householdId}`}
                    className="underline underline-offset-4"
                  >
                    {client.name}
                  </Link>
                </LedgerCell>
                <LedgerCell secondary>{t(`scopes.${client.scope}`)}</LedgerCell>
                <LedgerCell align="end">
                  {client.uncategorized > 0 ? (
                    <Status tone="caution">{client.uncategorized}</Status>
                  ) : (
                    client.uncategorized
                  )}
                </LedgerCell>
                <LedgerCell align="end">{client.openRequests}</LedgerCell>
                <LedgerCell align="end" secondary>
                  {client.lastClosedPeriod ?? t('clients.neverClosed')}
                </LedgerCell>
              </LedgerRow>
            ))}
          </LedgerBody>
        </Ledger>
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
