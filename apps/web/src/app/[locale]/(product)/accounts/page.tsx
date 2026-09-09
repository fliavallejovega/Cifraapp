import { formatMoney, getCurrency, type CurrencyCode } from '@app/domain';
import { Card, Page, PageHeader, Section, Stat } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AccountsManager, type AccountRowView } from '@/components/accounts-manager';
import { ACCOUNT_TYPE_GROUPS, ACCOUNT_TYPES, loadAccounts } from '@/server/repositories/accounts';
import { loadPeople } from '@/server/repositories/administration';
import { requireHousehold } from '@/server/session';

/**
 * Where money gets a place to live.
 *
 * This screen is the entry point the product went without: no account meant no
 * import, no plan and no statement, and the button that claimed to add one did
 * nothing. Everything downstream reads rows that begin here.
 *
 * The two figures at the top are the only summary worth showing — what is
 * liquid and what is owed — because those are the two numbers every other
 * screen is built on, and seeing them here is how a person checks that what
 * they typed is what the product understood.
 */
export default async function AccountsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const household = session.households.find((entry) => entry.id === session.activeHouseholdId);
  const currency = (household?.baseCurrency.trim() ?? 'USD') as CurrencyCode;

  const [view, people] = await Promise.all([
    loadAccounts(session, session.activeHouseholdId, currency),
    loadPeople(session, session.activeHouseholdId),
  ]);
  const personNames = new Map(people.map((person) => [person.id, person.displayName]));

  const t = await getTranslations('accounts');
  const raw = rawOf(t);
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';

  const rows: AccountRowView[] = view.accounts.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    maskedNumber: account.maskedNumber,
    personId: account.personId,
    personName: account.personId ? (personNames.get(account.personId) ?? null) : null,
    balance: formatMoney(account.balance, { locale: moneyLocale }),
    rawBalance: account.balance.toDecimalString(),
    status: account.status,
    transactionCount: account.transactionCount,
  }));

  const typeLabels = Object.fromEntries(
    ACCOUNT_TYPES.map((type) => [type, t(`types.${type}`)]),
  ) as Record<string, string>;

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {/* Only once there is something to summarize. Two zeroes above an empty
          list would be a measurement of nothing. */}
      {!view.isEmpty && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <Stat label={t('summary.liquid')} detail={t('summary.liquidDetail')}>
              {formatMoney(view.liquid, { locale: moneyLocale })}
            </Stat>
          </Card>
          {!view.liabilities.isZero() && (
            <Card>
              <Stat label={t('summary.owed')} detail={t('summary.owedDetail')}>
                {formatMoney(view.liabilities, { locale: moneyLocale })}
              </Stat>
            </Card>
          )}
        </div>
      )}

      <Section title={t('list.title')} detail={t('list.detail')} className="mt-12">
        <Card>
          <AccountsManager
            people={people.map((person) => ({ id: person.id, name: person.displayName }))}
            locale={locale}
            currencySymbol={getCurrency(currency).symbol}
            accounts={rows}
            groups={ACCOUNT_TYPE_GROUPS.map((group) => ({ key: group.key, types: group.types }))}
            labels={{
              form: {
                name: t('form.name'),
                nameHint: t('form.nameHint'),
                type: t('form.type'),
                balance: t('form.balance'),
                balanceHintAsset: t('form.balanceHintAsset'),
                balanceHintDebt: t('form.balanceHintDebt'),
                mask: t('form.mask'),
                person: t('form.person'),
                personHint: t('form.personHint'),
                personHousehold: t('form.personHousehold'),
                maskHint: t('form.maskHint'),
                submitCreate: t('form.submitCreate'),
                submitUpdate: t('form.submitUpdate'),
                cancel: t('form.cancel'),
                errorTitle: t('errors.title'),
                errors: errorLabels(t),
                types: typeLabels,
                groups: {
                  liquid: t('groups.liquid'),
                  debt: t('groups.debt'),
                  other: t('groups.other'),
                },
              },
              addAction: t('list.add'),
              addTitle: t('list.addTitle'),
              edit: t('list.edit'),
              archive: t('list.archive'),
              restore: t('list.restore'),
              archiveConfirm: t('list.archiveConfirm'),
              archiveConfirmYes: t('list.archiveConfirmYes'),
              cancel: t('form.cancel'),
              archivedBadge: t('list.archivedBadge'),
              movements: raw('list.movements'),
              noMovements: t('list.noMovements'),
              maskPrefix: t('list.maskPrefix'),
              emptyTitle: t('empty.title'),
              emptyBody: t('empty.body'),
              errorTitle: t('errors.title'),
              errors: errorLabels(t),
              types: typeLabels,
            }}
          />
        </Card>
      </Section>

      <p className="mt-12 max-w-[62ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {t('scopeNote')}
      </p>
    </Page>
  );
}

function errorLabels(t: (key: string) => string): Record<string, string> {
  return {
    nameRequired: t('errors.nameRequired'),
    balanceInvalid: t('errors.balanceInvalid'),
    maskInvalid: t('errors.maskInvalid'),
    typeInvalid: t('errors.typeInvalid'),
    createFailed: t('errors.createFailed'),
    notFound: t('errors.notFound'),
    signInRequired: t('errors.signInRequired'),
    generic: t('errors.generic'),
  };
}

/**
 * A message that carries placeholders filled in the browser, where the value is
 * client state the server never had — a selection count, a running total.
 * `t()` would try to resolve them here and throw; the template has to travel
 * whole.
 */
function rawOf(t: { raw: (key: string) => unknown }): (key: string) => string {
  return (key) => {
    const value = t.raw(key);
    return typeof value === 'string' ? value : '';
  };
}
