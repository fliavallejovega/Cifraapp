import { Page } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { HouseholdForm } from '@/components/household-form';
import { requireSession } from '@/server/session';

/**
 * First run. A signed-in user with no household lands here rather than on an
 * empty dashboard, because an interface with nothing in it cannot explain
 * itself and a person who just signed up deserves one clear next step.
 */
export default async function WelcomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireSession(locale);

  // Already set up. Sending them back to onboarding would be a dead end.
  if (session.activeHouseholdId) {
    redirect(`/${locale}/overview`);
  }

  const t = await getTranslations('onboarding');

  return (
    <Page className="max-w-md">
      <header className="mb-10">
        <h1
          className="text-3xl font-medium text-balance"
          style={{ letterSpacing: 'var(--tracking-display)', lineHeight: 1.1 }}
        >
          {t('title')}
        </h1>
        <p className="mt-3 text-pretty text-[color:var(--color-ink-secondary)]">{t('detail')}</p>
      </header>

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
    </Page>
  );
}
