import { getCurrency, type CurrencyCode } from '@app/domain';
import { householdSettings } from '@app/database/schema';
import { eq } from 'drizzle-orm';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { AuthScreen } from '@/components/auth-screen';
import { HouseholdForm } from '@/components/household-form';
import { SetupQuestionnaire } from '@/components/setup-questionnaire';
import { SkipSetupButton } from '@/components/skip-setup-button';
import { queryAsUser, requireSession } from '@/server/session';

/**
 * First run, in two halves.
 *
 * The first is the household: a name and a currency, because nothing can be
 * created before something owns it. The second is the questionnaire, which is
 * the half that was missing. Every engine in this system reads obligations,
 * debts, goals and a household size, and none of those could be created — so a
 * new household arrived at a plan screen that correctly reported that nothing
 * claimed their money, which is true and useless.
 *
 * Asking is not a delay before the product starts. It is the only way the first
 * screen a person sees can be about their money rather than about ours.
 */
export default async function WelcomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireSession(locale);

  if (!session.activeHouseholdId) {
    return <HouseholdStep locale={locale} />;
  }

  const householdId = session.activeHouseholdId;
  const [settings] = await queryAsUser(session, (tx) =>
    tx
      .select({ completedAt: householdSettings.onboardingCompletedAt })
      .from(householdSettings)
      .where(eq(householdSettings.householdId, householdId))
      .limit(1),
  );

  // Answered, or deliberately skipped. Either way it is asked once.
  if (settings?.completedAt) {
    redirect(`/${locale}/overview`);
  }

  const household = session.households.find((entry) => entry.id === householdId);
  const currency = (household?.baseCurrency.trim() ?? 'USD') as CurrencyCode;
  const t = await getTranslations('setup');

  return (
    <AuthScreen title={t('title')} detail={t('detail')} wide>
      <SetupQuestionnaire
        locale={locale}
        currencySymbol={getCurrency(currency).symbol}
        t={labels(rawOf(t))}
      />

      <div className="mt-10 border-t border-[color:var(--color-rule)] pt-6">
        <SkipSetupButton locale={locale} label={t('skipAll')} hint={t('skipAllHint')} />
      </div>
    </AuthScreen>
  );
}

async function HouseholdStep({ locale }: { locale: string }) {
  const t = await getTranslations('onboarding');

  return (
    <AuthScreen title={t('title')} detail={t('detail')}>
      <HouseholdForm
        locale={locale}
        labels={{
          name: t('fields.name'),
          nameHint: t('fields.nameHint'),
          currency: t('fields.currency'),
          submit: t('submit'),
          errorTitle: t('errors.title'),
          errors: {
            householdNameRequired: t('errors.nameRequired'),
            householdCreateFailed: t('errors.createFailed'),
            signInRequired: t('errors.signInRequired'),
            generic: t('errors.createFailed'),
          },
        }}
      />
    </AuthScreen>
  );
}

/**
 * The questionnaire is a client component and cannot reach the catalogue, so
 * every string it needs is resolved here and handed over flat.
 */
function labels(read: (key: string) => string): Record<string, string> {
  const keys = [
    'progress',
    'next',
    'back',
    'skipStep',
    'finish',
    'remove',
    'amount',
    'errorTitle',
    'error.invalid',
    'error.saveFailed',
    'error.signInRequired',
    'error.dependentsExceedMembers',
    'error.generic',
    'household.title',
    'household.detail',
    'household.name',
    'household.nameHint',
    'household.namePlaceholder',
    'household.relationship',
    'household.dependent',
    'household.add',
    'household.relationships.self',
    'household.relationships.partner',
    'household.relationships.child',
    'household.relationships.parent',
    'household.relationships.sibling',
    'household.relationships.other',
    'household.next',
    'income.title',
    'income.detail',
    'income.name',
    'income.namePlaceholder',
    'income.frequency',
    'income.approximate',
    'income.approximateHint',
    'income.add',
    'income.next',
    'savings.title',
    'savings.detail',
    'savings.name',
    'savings.namePlaceholder',
    'savings.type',
    'savings.balance',
    'savings.add',
    'savings.next',
    'commitments.title',
    'commitments.detail',
    'commitments.name',
    'commitments.namePlaceholder',
    'commitments.dueDay',
    'commitments.dueDayHint',
    'commitments.essential',
    'commitments.essentialHint',
    'commitments.add',
    'commitments.next',
    'debts.title',
    'debts.detail',
    'debts.name',
    'debts.namePlaceholder',
    'debts.balance',
    'debts.apr',
    'debts.aprHint',
    'debts.minimum',
    'debts.minimumHint',
    'debts.add',
    'debts.next',
    'goals.title',
    'goals.detail',
    'goals.name',
    'goals.namePlaceholder',
    'goals.target',
    'goals.date',
    'goals.dateHint',
    'goals.add',
    'goals.buffer',
    'goals.bufferHint',
    'frequency.weekly',
    'frequency.biweekly',
    'frequency.semimonthly',
    'frequency.monthly',
    'frequency.quarterly',
    'frequency.annual',
    'accountType.checking',
    'accountType.savings',
    'accountType.cash',
    'accountType.digital_wallet',
  ];

  return Object.fromEntries(keys.map((key) => [key, read(key)]));
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
